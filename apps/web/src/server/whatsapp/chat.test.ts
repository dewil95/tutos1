import { createHash } from "node:crypto";
import { renderReportPdf, type InboundWhatsApp, type WhatsAppClient } from "@mca/connectors";
import { decryptSecret, getPrisma, purgeTenant, type PrismaClient } from "@mca/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseReady } from "../testDb";

// Synthetic merchant only. The "other company" application is read by a mocked A5.
const READING = {
  isApplication: true,
  business: {
    legalName: "Sample Bistro LLC",
    dba: "Sample Bistro",
    entityType: "LLC",
    ein: "12-3456780",
    startDate: "2021-04-01",
    industry: "Restaurant",
    naics: null,
    phone: "305-555-0100",
    email: null, // missing → asked
    website: null,
    addressLine1: "1 Main St",
    city: "Miami",
    state: "FL",
    postalCode: "33101",
  },
  request: {
    requestedAmount: null, // missing → asked
    useOfFunds: "Inventory",
    statedMonthlyRevenue: 60000,
    existingAdvances: [{ lender: "Sample Capital", balance: 9000 }],
  },
  owners: [
    {
      firstName: "Pat",
      lastName: "Example",
      ownershipPct: 100,
      ssn: "123-45-6789",
      dob: "1980-02-03",
      email: "pat@samplebistro.test",
      phone: null,
      addressLine1: "9 Oak Ave",
      city: "Miami",
      state: "FL",
      postalCode: "33102",
      creditScoreStated: 640,
    },
  ],
  signed: true,
  signatureDate: "2026-09-30",
  lowConfidenceFields: ["owners.0.dob"], // unsure → asked again on the private page
  confidence: 0.9,
};

vi.mock("@mca/ai", async (orig) => ({
  ...(await orig<typeof import("@mca/ai")>()),
  runApplicationReading: vi.fn(async (_c: unknown, input: { file: { fileName: string } }) => ({
    data: input.file.fileName.includes("app")
      ? READING
      : { ...READING, isApplication: false, owners: [] },
    record: {},
    raw: null,
  })),
  runChatAnswer: vi.fn(async (_c: unknown, input: { reply: string }) => ({
    data: {
      understood: /25/.test(input.reply),
      text: null,
      number: /25/.test(input.reply) ? 25000 : null,
      date: null,
      address: null,
      advances: null,
    },
    record: {},
    raw: null,
  })),
}));
vi.mock("../ai", () => ({ llmClient: () => ({ provider: "gemini", structured: vi.fn() }) }));

const { addChatEvent, handleWhatsAppNudges, processConversation, receiveWhatsApp } =
  await import("./chat");
const { readCandidates } = await import("./read");
const { submitSecureForm } = await import("./secureForm");
const { defaultPackage } = await import("../documents");
const { queueSubmissions } = await import("../submissions");

const PHONE = "13055550123";
const KEY = Buffer.alloc(32, 7).toString("base64");

const pdf = (title: string) => renderReportPdf({ title, sections: [] });

function fakes() {
  const files = new Map<string, Buffer>();
  const sent: { kind: string; to: string; body: string; buttons?: string[]; file?: string }[] = [];
  const media = new Map<string, { data: Buffer; mimeType: string }>();
  let n = 0;
  const drive = {
    ensureFolderPath: async () => "folder-1",
    upload: async (f: { fileName: string; data: Buffer }) => {
      const id = `drive-${++n}`;
      files.set(id, f.data);
      return {
        id,
        name: f.fileName,
        mimeType: "application/pdf",
        sizeBytes: f.data.length,
        webViewLink: null,
      };
    },
    download: async (id: string) => files.get(id)!,
    rename: vi.fn(async () => undefined),
  };
  const sender: WhatsAppClient = {
    sendText: async (to, body) => (
      sent.push({ kind: "text", to, body }),
      { messageId: `out-${++n}` }
    ),
    sendButtons: async (to, body, buttons) => (
      sent.push({ kind: "buttons", to, body, buttons: buttons.map((b) => b.id) }),
      { messageId: `out-${++n}` }
    ),
    sendDocument: async (to, file, caption) => (
      sent.push({ kind: "document", to, body: caption ?? "", file: file.fileName }),
      files.set(`sent-${file.fileName}-${++n}`, file.data),
      { messageId: `out-${n}` }
    ),
    downloadMedia: async (id) => media.get(id)!,
  };
  return { files, sent, media, drive, sender };
}

describe.runIf(await databaseReady())("WhatsApp application (Postgres)", () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let f: ReturnType<typeof fakes>;
  let deps: Parameters<typeof processConversation>[1];
  let seq = 0;
  const now = () => new Date();

  const inbound = (m: Partial<InboundWhatsApp>): InboundWhatsApp => ({
    phoneNumberId: "123",
    from: PHONE,
    profileName: "Pat",
    messageId: `wamid.${++seq}`,
    timestamp: new Date(Date.now() + seq),
    kind: "text",
    text: null,
    buttonId: null,
    mediaId: null,
    mimeType: null,
    fileName: null,
    ...m,
  });
  const conv = () =>
    prisma.whatsAppConversation.findFirstOrThrow({ where: { tenantId, phone: PHONE } });
  /** Merchant sends something; the chat job runs; returns what the bot sent back. */
  const send = async (m: Partial<InboundWhatsApp>) => {
    const before = f.sent.length;
    await receiveWhatsApp(prisma, tenantId, [inbound(m)]);
    await processConversation(prisma, deps, (await conv()).id);
    return f.sent.slice(before);
  };
  const text = (t: string) => send({ kind: "text", text: t });
  const tap = (id: string) => send({ kind: "button", buttonId: id, text: id });
  const runRead = async () => {
    const c = await conv();
    const job = await prisma.job.findFirstOrThrow({
      where: { tenantId, type: "WHATSAPP_APP_READ", status: "QUEUED" },
    });
    await prisma.job.update({ where: { id: job.id }, data: { status: "DONE" } });
    const before = f.sent.length;
    await readCandidates(prisma, deps, job.payload as never);
    await processConversation(prisma, deps, c.id);
    return f.sent.slice(before);
  };

  beforeAll(async () => {
    process.env.PII_ENCRYPTION_KEY = KEY;
    prisma = getPrisma();
    tenantId = (
      await prisma.tenant.create({
        data: { name: "WA Test", slug: `wa-${Date.now()}`, teamCc: [] },
      })
    ).id;
    f = fakes();
    deps = {
      sender: f.sender,
      media: f.sender,
      mailbox: async () => ({
        connection: {} as never,
        gmail: {} as never,
        drive: f.drive as never,
      }),
      llm: () => ({ provider: "gemini", structured: vi.fn() }) as never,
      appUrl: "https://crm.example.test",
      now,
    };
    f.media.set("m-app", {
      data: await pdf("Other Broker application"),
      mimeType: "application/pdf",
    });
    f.media.set("m-stmt", { data: await pdf("Bank statement"), mimeType: "application/pdf" });
    // 1x1 PNG standing in for a photo of a form page.
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
      "base64",
    );
    f.media.set("m-p1", { data: png, mimeType: "image/png" });
    f.media.set("m-p2", {
      data: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      ),
      mimeType: "image/png",
    });
  });

  afterAll(async () => {
    if (tenantId) await purgeTenant(prisma, tenantId);
  });

  it("turns another company's signed PDF into Ascend's signed application", async () => {
    // 1. Hello → language buttons; English → asks for the application.
    let out = await text("Hi");
    expect(out[0]!.buttons).toEqual(["lang_en", "lang_es"]);
    out = await tap("lang_en");
    expect(out[0]!.body).toMatch(/signed application you already have/);

    // 2. The other company's application, then a statement while it is being read.
    out = await send({
      kind: "document",
      mediaId: "m-app",
      mimeType: "application/pdf",
      fileName: "OtherBroker app.pdf",
    });
    expect(out[0]!.body).toMatch(/reading your application/);
    expect((await conv()).status).toBe("READING");
    out = await send({
      kind: "document",
      mediaId: "m-stmt",
      mimeType: "application/pdf",
      fileName: "Chase statement Aug 2026.pdf",
    });
    expect(out[0]!.body).toMatch(/bank statement/);

    // 3. Read done → only the two missing fields are asked.
    out = await runRead();
    expect(out[0]!.body).toMatch(/I just need 2 more details/);
    expect(out[1]!.body).toMatch(/email/i);
    out = await text("Pat@SampleBistro.test");
    expect(out[0]!.body).toMatch(/How much funding/);
    out = await text("nonsense");
    expect(out[0]!.body).toMatch(/didn't get that/);
    // Free text the plain parser can't read goes to the AI and is read back for a yes/no.
    out = await text("about 25 thousand");
    expect(out[0]!.body).toMatch(/\$25,000/);
    expect(out[0]!.buttons).toEqual(["yes", "change"]);

    // 4. DOB was unsure → private link; nothing sensitive is typed in the chat.
    out = await tap("yes");
    const link = /\/apply\/([\w-]+)/.exec(out[0]!.body);
    expect(link).toBeTruthy();
    expect(
      await submitSecureForm(prisma, link![1]!, { ssn: "123456789", dob: "1980-02-03" }),
    ).toEqual({ ok: true });
    expect(
      await submitSecureForm(prisma, link![1]!, { ssn: "123456789", dob: "1980-02-03" }),
    ).toEqual({
      ok: false,
      error: "expired",
    });
    let before = f.sent.length;
    await processConversation(prisma, deps, (await conv()).id);
    out = f.sent.slice(before);
    // A statement is already on file, so it goes straight to the review.
    expect(out[0]).toMatchObject({
      kind: "document",
      file: "Ascend-Fund-Application-Sample-Bistro-preview.pdf",
    });
    expect(out[1]!.buttons).toEqual(["review_ok", "review_fix"]);

    // 5. Fix one thing from the review, then sign.
    out = await tap("review_fix");
    expect(out[0]!.body).toMatch(/1 Business legal name/);
    out = await text("12"); // Monthly revenue
    expect(out[0]!.body).toMatch(/deposit per month/);
    out = await text("$65,000");
    expect(out[0]!.kind).toBe("document");
    out = await tap("review_ok");
    expect(out[0]!.body).toMatch(/authorization/);
    expect(out[0]!.body).toMatch(/\*Pat Example\*/);
    out = await text("Pat Exampel");
    expect(out[0]!.body).toMatch(/doesn't match/);
    out = await text("pat example");
    expect(out[0]!.buttons).toEqual(["sign", "sign_cancel"]);
    out = await tap("sign");
    expect(out[0]!.body).toMatch(/Signed ✅ Thank you, Pat/);
    expect(out[1]).toMatchObject({
      kind: "document",
      file: "Ascend-Fund-Application-Sample-Bistro.pdf",
    });

    // The deal: real merchant name, owner with encrypted SSN/DOB, request fields.
    const c = await conv();
    expect(c.status).toBe("SIGNED");
    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: c.dealId! },
      include: { merchant: { include: { owners: true } }, documents: true },
    });
    expect(deal).toMatchObject({
      source: "whatsapp",
      externalRef: `wa:${c.id}`,
      stage: "DOCS_RECEIVED",
    });
    expect(Number(deal.requestedAmount)).toBe(25000);
    expect(deal.merchant).toMatchObject({
      legalName: "Sample Bistro LLC",
      email: "pat@samplebistro.test",
    });
    const owner = deal.merchant.owners[0]!;
    expect(decryptSecret(owner.ssnEncrypted!, KEY)).toBe("123-45-6789");
    expect(decryptSecret(owner.dobEncrypted!, KEY)).toBe("1980-02-03");
    expect(owner.phone).toBe("(305) 555-0123");

    // Files: the other company's form is internal; Ascend's signed one goes to lenders.
    const source = deal.documents.find((d) => d.fileName === "OtherBroker app.pdf")!;
    const signed = deal.documents.find(
      (d) => d.fileName === "Ascend-Fund-Application-Sample-Bistro.pdf",
    )!;
    const stmt = deal.documents.find((d) => d.fileName.startsWith("Chase"))!;
    expect(source).toMatchObject({ type: "APPLICATION", internalOnly: true });
    expect(signed).toMatchObject({
      type: "APPLICATION",
      internalOnly: false,
      uploadedVia: "whatsapp",
    });
    expect(stmt.type).toBe("BANK_STATEMENT");
    expect(defaultPackage(deal.documents)).toEqual([signed.id, stmt.id]);
    const funder = await prisma.funder.create({
      data: { tenantId, name: "Sample Lender", submissionTo: "subs@lender.test", submissionCc: [] },
    });
    await expect(
      queueSubmissions(prisma, {
        tenantId,
        dealId: deal.id,
        funderIds: [funder.id],
        documentIds: [source.id],
        userId: null,
      } as never),
    ).rejects.toThrow(/Internal files/);
    expect(
      await prisma.job.count({
        where: {
          tenantId,
          type: "STATEMENT_EXTRACT",
          payload: { equals: { documentId: stmt.id } },
        },
      }),
    ).toBe(1);

    // Signature proof matches the stored PDF and cannot be edited.
    const sig = await prisma.applicationSignature.findFirstOrThrow({ where: { dealId: deal.id } });
    expect(sig).toMatchObject({
      signerName: "pat example",
      ownerName: "Pat Example",
      phone: PHONE,
      documentId: signed.id,
    });
    const stored = f.files.get(signed.driveFileId)!;
    expect(sig.pdfSha256).toBe(createHash("sha256").update(stored).digest("hex"));
    expect(sig.consentSha256).toBe(createHash("sha256").update(sig.consentText).digest("hex"));
    expect(sig.agreeMessageId).toMatch(/^wamid\./);
    await expect(
      prisma.applicationSignature.update({ where: { id: sig.id }, data: { signerName: "x" } }),
    ).rejects.toThrow(/append-only/);
    expect(f.drive.rename).toHaveBeenCalledWith(
      "folder-1",
      expect.stringContaining("Sample Bistro"),
    );

    // Nothing sensitive in the chat log, in either direction.
    const log = await prisma.whatsAppMessage.findMany({ where: { conversationId: c.id } });
    for (const m of log) expect(m.text ?? "").not.toMatch(/123-?45-?6789|1980-02-03/);
    expect(f.sent.every((s) => !/123-?45-?6789/.test(s.body))).toBe(true);
  });

  it("ignores repeated deliveries and hands later messages to the team", async () => {
    const dup = inbound({ kind: "text", text: "hello again" });
    await receiveWhatsApp(prisma, tenantId, [dup]);
    await receiveWhatsApp(prisma, tenantId, [dup]);
    expect(await prisma.whatsAppMessage.count({ where: { waMessageId: dup.messageId } })).toBe(1);
    await processConversation(prisma, deps, (await conv()).id);
    expect((await conv()).status).toBe("HANDOFF");
    expect(await prisma.deal.count({ where: { tenantId } })).toBe(1);
  });

  it("asks every question when the merchant has no PDF (Spanish)", async () => {
    const phone = "13055550999";
    const sendAs = async (m: Partial<InboundWhatsApp>) => {
      const before = f.sent.length;
      await receiveWhatsApp(prisma, tenantId, [inbound({ ...m, from: phone })]);
      const c = await prisma.whatsAppConversation.findFirstOrThrow({ where: { tenantId, phone } });
      await processConversation(prisma, deps, c.id);
      return f.sent.slice(before);
    };
    await sendAs({ text: "Hola" });
    await sendAs({ kind: "button", buttonId: "lang_es" });
    let out = await sendAs({ kind: "button", buttonId: "questions" });
    expect(out[1]!.body).toMatch(/nombre legal del negocio/);
    const answers = [
      "Muñoz Bakery LLC",
      "saltar",
      "1",
      "98-7654321",
      "marzo 2019",
      "Panadería",
      "5 Palm Ave, Hialeah, FL 33010",
      "mismo",
      "info@munozbakery.test",
      "$30,000",
      "Equipo",
      "45k",
      "ninguno",
      "José Muñoz",
      "100",
      "7 Pine St, Hialeah, FL 33012",
      "mismo",
      "saltar",
    ];
    for (const a of answers) {
      out = await sendAs({ text: a });
      expect(out[0]!.body).not.toMatch(/no entendí/);
    }
    expect(out[0]!.body).toMatch(/página privada/);
    const token = /\/apply\/([\w-]+)/.exec(out[0]!.body)![1]!;
    expect(
      (await submitSecureForm(prisma, token, { ssn: "000-00-0000", dob: "1975-05-05" })).ok,
    ).toBe(false);
    await submitSecureForm(prisma, token, { ssn: "234-56-7890", dob: "1975-05-05" });
    const c = await prisma.whatsAppConversation.findFirstOrThrow({ where: { tenantId, phone } });
    let before = f.sent.length;
    await processConversation(prisma, deps, c.id);
    out = f.sent.slice(before);
    expect(out[0]!.buttons).toEqual(["statements_done", "statements_later"]);
    out = await sendAs({ kind: "button", buttonId: "statements_later" });
    expect(out[0]!.kind).toBe("document");
    await sendAs({ kind: "button", buttonId: "review_ok" });
    out = await sendAs({ text: "Jose Munoz" });
    out = await sendAs({ kind: "button", buttonId: "sign" });
    expect(out[0]!.body).toMatch(/Firmado ✅ ¡Gracias, José!/);
    const deal = await prisma.deal.findFirstOrThrow({
      where: { tenantId, externalRef: `wa:${c.id}` },
      include: { merchant: { include: { owners: true } } },
    });
    expect(deal.stage).toBe("DOCS_REQUESTED");
    expect(deal.merchant).toMatchObject({
      legalName: "Muñoz Bakery LLC",
      entityType: "LLC",
      city: "Hialeah",
      email: "info@munozbakery.test",
      phone: "(305) 555-0999",
    });
    expect(deal.merchant.owners[0]).toMatchObject({
      firstName: "José",
      lastName: "Muñoz",
      email: "info@munozbakery.test",
    });
    before = f.sent.length;
  });

  it("sends two reminders within the free 24-hour window, then lets the team follow up", async () => {
    const c = await prisma.whatsAppConversation.create({
      data: {
        tenantId,
        phone: "13055550555",
        language: "en",
        status: "ACTIVE",
        step: "business.email",
        lastInboundAt: new Date(Date.now() - 3 * 3_600_000),
        fieldState: {
          fields: { "business.email": "ask" },
          asked: [],
          candidates: [],
          examined: [],
        },
      },
    });
    const tick = async () => {
      await handleWhatsAppNudges(prisma, { tenantId } as never);
      const before = f.sent.length;
      await processConversation(prisma, deps, c.id);
      return f.sent.slice(before);
    };
    expect((await tick())[0]!.body).toMatch(/almost done/);
    expect(await tick()).toEqual([]); // next one only after 20 h
    await prisma.whatsAppConversation.update({
      where: { id: c.id },
      data: { lastInboundAt: new Date(Date.now() - 21 * 3_600_000) },
    });
    expect(await tick()).toHaveLength(1);
    await prisma.whatsAppConversation.update({
      where: { id: c.id },
      data: { lastInboundAt: new Date(Date.now() - 25 * 3_600_000) },
    });
    expect(await tick()).toEqual([]);
    expect(
      (await prisma.whatsAppConversation.findUniqueOrThrow({ where: { id: c.id } })).status,
    ).toBe("ABANDONED");
  });

  it("reads photos of the form together, and a person can take over and hand back", async () => {
    const phone = "13055550444";
    const sendAs = async (m: Partial<InboundWhatsApp>) => {
      const before = f.sent.length;
      await receiveWhatsApp(prisma, tenantId, [inbound({ ...m, from: phone })]);
      const c = await prisma.whatsAppConversation.findFirstOrThrow({ where: { tenantId, phone } });
      await processConversation(prisma, deps, c.id);
      return f.sent.slice(before);
    };
    await sendAs({ kind: "button", buttonId: "lang_en" });
    await sendAs({ kind: "image", mediaId: "m-p1", mimeType: "image/png" });
    await sendAs({ kind: "image", mediaId: "m-p2", mimeType: "image/png" }); // while queued
    const c = await prisma.whatsAppConversation.findFirstOrThrow({ where: { tenantId, phone } });
    const job = await prisma.job.findFirstOrThrow({
      where: { tenantId, type: "WHATSAPP_APP_READ", status: "QUEUED", dedupeKey: `waread:${c.id}` },
    });
    await readCandidates(prisma, deps, job.payload as never);
    const docs = await prisma.document.findMany({ where: { dealId: c.dealId! } });
    const combined = docs.find((d) => d.fileName.startsWith("Application received on WhatsApp"))!;
    expect(combined).toMatchObject({ type: "APPLICATION", internalOnly: true });
    expect(combined.fileName).toContain("2 photos");
    expect(docs.filter((d) => d.mimeType === "image/png").every((d) => d.internalOnly)).toBe(true);

    // The read result is handled first (it came in first), then the merchant asks for a person.
    let out = await sendAs({ kind: "text", text: "agente" });
    expect(out[0]!.body).toMatch(/I filled in Ascend's application/);
    expect(out.at(-1)!.body).toMatch(/person from our team/);
    expect(
      (await prisma.whatsAppConversation.findUniqueOrThrow({ where: { id: c.id } })).status,
    ).toBe("HANDOFF");
    out = await sendAs({ kind: "text", text: "hello?" });
    expect(out).toEqual([]); // the bot stays quiet while a person has the chat
    await addChatEvent(prisma, c, "resume");
    const before = f.sent.length;
    await processConversation(prisma, deps, c.id);
    out = f.sent.slice(before);
    // The bot continues with the first missing field.
    expect(out[0]!.body).toMatch(/email/i);
  });
});
