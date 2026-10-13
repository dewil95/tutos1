import type { InboundEmail } from "@mca/connectors";
import { getPrisma, purgeTenant, type PrismaClient } from "@mca/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { databaseReady } from "./testDb";

// Synthetic mailbox only: made-up merchants, lenders and addresses.
const replies = vi.hoisted(() => new Map<string, unknown>());
vi.mock("@mca/ai", async (orig) => ({
  ...(await orig<typeof import("@mca/ai")>()),
  runFunderReplyParsing: vi.fn(async (_c: unknown, input: { subject: string; from: string }) => ({
    data: replies.get(`${input.from}|${input.subject}`),
    record: {},
  })),
}));
vi.mock("./ai", () => ({ llmClient: () => ({ provider: "gemini", structured: vi.fn() }) }));

const inbox = vi.hoisted(() => ({ messages: [] as InboundEmail[], searched: [] as string[] }));
vi.mock("./google", async (orig) => ({
  ...(await orig<typeof import("./google")>()),
  mailboxFor: (connection: unknown) => ({
    connection,
    gmail: {
      // Gmail lists newest first.
      searchAll: async (q: string) => {
        inbox.searched.push(q);
        return [...inbox.messages]
          .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())
          .map((m) => m.messageId);
      },
      getMessage: async (id: string) => inbox.messages.find((m) => m.messageId === id)!,
      getAttachment: async () => {
        throw new Error("history imports never download attachments");
      },
      sync: async () => ({ messages: inbox.messages, nextCursor: "h-2" }),
    },
    drive: {
      ensureFolderPath: async () => {
        throw new Error("history imports never touch Drive");
      },
    },
  }),
}));

const { positionsFromSubmissionBody } = await import("./submissions");
const { handleHistoryImport, historyQuery } = await import("./jobs/historyImport");
const { handleInboxSync } = await import("./jobs/inboxSync");
const { handleParseReply } = await import("./jobs/parseReply");
const { lenderHistory } = await import("./lenders");
const { lenderPlaybook, loadPlaybook, median, shoppingHabits } = await import("./playbook");

const BODY = `Hello,

Please see the attached deal for submission.

Sample Capital: $12,500
Other Advance $8k

Revenue dipped in August (closed for renovation). Monthly revenue: $45,000

Thank you.

Pat Broker
Phone: 305-555-0100

Confidentiality Notice
This message ...`;

describe("positions from a submission email", () => {
  it("reads the positions block and nothing else", () => {
    expect(positionsFromSubmissionBody(BODY)).toEqual([
      { funder: "Sample Capital", balance: 12500 },
      { funder: "Other Advance", balance: 8000 },
    ]);
    expect(
      positionsFromSubmissionBody("Hello,\n\nPlease see the attached deal.\n\nThanks"),
    ).toEqual([]);
  });
});

describe("playbook math", () => {
  const row = (over: Partial<Parameters<typeof lenderPlaybook>[0][number]>) => ({
    funderId: "f1",
    funderName: "Lender One",
    dealId: "d1",
    status: "SENT",
    declineReason: null,
    sentAt: new Date("2026-09-01T12:00:00Z"),
    log: [],
    paperGrade: null,
    state: null,
    positions: 0,
    ...over,
  });

  it("counts answers, reasons, offers and reply speed per lender", () => {
    const subs = [
      row({
        status: "APPROVED",
        paperGrade: "C",
        state: "FL",
        positions: 2,
        log: [{ at: "2026-09-01T18:00:00Z", intent: "APPROVED", activityId: "a1" }],
      }),
      row({ dealId: "d2", status: "DECLINED", declineReason: "Low revenue; too many positions" }),
      row({ dealId: "d3", status: "DECLINED", declineReason: "low revenue." }),
      row({ dealId: "d4", funderId: "f2", funderName: "Lender Two" }),
    ];
    const [one, two] = lenderPlaybook(
      subs,
      new Map([
        [
          "a1",
          {
            offers: [
              { advanceAmount: 20000, factorRate: 1.45, termDays: 100, commissionPoints: 10 },
            ],
          },
        ],
      ]) as never,
    );
    expect(one).toMatchObject({
      name: "Lender One",
      sent: 3,
      approved: 1,
      declined: 2,
      approvalRate: 1 / 3,
      medianReplyHours: 6,
      approvedGrades: ["C"],
      maxPositionsApproved: 2,
      typicalOffer: { offers: 1, amount: 20000, factor: 1.45, termDays: 100, points: 10 },
    });
    expect(one!.declineReasons).toEqual([
      { reason: "Low revenue", count: 2 },
      { reason: "too many positions", count: 1 },
    ]);
    expect(two).toMatchObject({ sent: 1, pending: 1, approvalRate: null });

    const habits = shoppingHabits(subs);
    expect(habits).toMatchObject({ dealsShopped: 4, medianLendersPerDeal: 1 });
    expect(habits.byPositions.find((b) => b.positions === "2")).toEqual({
      positions: "2",
      sent: 1,
      approved: 1,
      declined: 0,
    });
    expect(median([3, 1, 2, 10])).toBe(2.5);
  });
});

describe.runIf(await databaseReady())("learn from a past mailbox", () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let historyId: string;
  let sendId: string;
  const funderIds: Record<string, string> = {};

  const at = (d: string) => new Date(`2026-09-${d}Z`);
  const mail = (over: Partial<InboundEmail> & Pick<InboundEmail, "messageId">): InboundEmail => ({
    threadId: `t-${over.messageId}`,
    rfcMessageId: `<${over.messageId}@mail.test>`,
    labelIds: ["INBOX"],
    from: "funding@ascendfund.test",
    to: [],
    cc: [],
    subject: "",
    text: "",
    receivedAt: at("01T12:00:00"),
    attachments: [],
    ...over,
  });

  beforeAll(async () => {
    prisma = getPrisma();
    const t = await prisma.tenant.create({
      data: { name: "History Test", slug: `history-${Date.now()}` },
    });
    tenantId = t.id;
    for (const [name, domain] of [
      ["Lender One", "lenderone.test"],
      ["Lender Two", "lendertwo.test"],
    ] as const) {
      const f = await prisma.funder.create({
        data: { tenantId, name, emailDomains: [domain], submissionTo: `subs@${domain}` },
      });
      funderIds[name] = f.id;
    }
    const conn = (email: string, purpose: string) =>
      prisma.mailboxConnection.create({
        data: { tenantId, email, encryptedRefreshToken: "x", purpose },
      });
    historyId = (await conn("jonas@ascendfund.test", "history")).id;
    sendId = (await conn("funding@ascendfund.test", "send")).id;

    inbox.messages = [
      mail({
        messageId: "sub-1",
        to: ["subs@lenderone.test"],
        cc: ["subs@lendertwo.test", "jonas@ascendfund.test"],
        subject: "New Deal Submission - Sample Diner LLC",
        text: BODY,
        receivedAt: at("01T12:00:00"),
        attachments: [
          { attachmentId: "att", fileName: "app.pdf", mimeType: "application/pdf", sizeBytes: 9 },
        ],
      }),
      mail({
        messageId: "re-1",
        threadId: "t-sub-1",
        from: "uw@lenderone.test",
        subject: "RE: New Deal Submission - Sample Diner LLC",
        receivedAt: at("01T18:00:00"),
      }),
      // A new thread from the second lender, matched by the merchant name.
      mail({
        messageId: "re-2",
        from: "deals@lendertwo.test",
        subject: "Sample Diner - declined",
        receivedAt: at("02T09:00:00"),
      }),
      // Team chatter and merchant mail are not part of the history.
      mail({ messageId: "chat", from: "david@ascendfund.test", subject: "RE: Sample Diner" }),
      mail({ messageId: "merchant", from: "owner@samplediner.test", subject: "statements" }),
    ];
    replies.set("uw@lenderone.test|RE: New Deal Submission - Sample Diner LLC", {
      intent: "APPROVED",
      offers: [{ advanceAmount: 20000, factorRate: 1.45, termDays: 100, commissionPoints: 10 }],
      declineReasons: [],
      declineCategory: null,
      stips: ["Voided check"],
      funded: {
        amount: null,
        commissionAmount: null,
        clawbackDays: null,
        requiresConfirmationReply: false,
      },
      summary: "Approved $20,000 at 1.45.",
    });
    replies.set("deals@lendertwo.test|Sample Diner - declined", {
      intent: "STIP_REQUEST",
      offers: [],
      declineReasons: [],
      declineCategory: null,
      stips: ["Bank login"],
      funded: {
        amount: null,
        commissionAmount: null,
        clawbackDays: null,
        requiresConfirmationReply: false,
      },
      summary: "Needs bank login.",
    });
  });

  afterAll(async () => {
    await purgeTenant(prisma, tenantId);
  });

  const job = (mailboxId: string, type: "HISTORY_IMPORT" | "INBOX_SYNC" = "HISTORY_IMPORT") => ({
    id: "j",
    tenantId,
    type,
    payload: { mailboxId },
    attempts: 1,
    maxAttempts: 5,
  });

  it("searches submissions and lender mail, resumes, and imports deals without files", async () => {
    await handleHistoryImport(prisma, job(historyId), { runMs: 0 });
    let conn = await prisma.mailboxConnection.findUniqueOrThrow({ where: { id: historyId } });
    expect(conn.importState).toMatchObject({ total: 5, done: 0 });
    expect(inbox.searched[0]).toBe(historyQuery(["lenderone.test", "lendertwo.test"]));

    await handleHistoryImport(prisma, job(historyId));
    conn = await prisma.mailboxConnection.findUniqueOrThrow({ where: { id: historyId } });
    expect(conn.importState).toMatchObject({
      total: 5,
      done: 5,
      imported: { submissions: 2, replies: 2, positions: 1 },
    });
    expect((conn.importState as { finishedAt?: string }).finishedAt).toBeTruthy();

    const deal = await prisma.deal.findFirstOrThrow({
      where: { tenantId },
      include: { submissions: true, documents: true, merchant: true },
    });
    expect(deal).toMatchObject({ source: "email_history", stage: "SUBMITTED" });
    expect(deal.merchant.legalName).toBe("Sample Diner LLC");
    expect(deal.submissionPositions).toEqual([
      { funder: "Sample Capital", balance: 12500 },
      { funder: "Other Advance", balance: 8000 },
    ]);
    expect(deal.documents).toEqual([]);
    expect(deal.submissions).toHaveLength(2);
    // Old threads from another mailbox: nothing can ever be sent into them.
    expect(deal.submissions.every((s) => s.gmailThreadId === null)).toBe(true);

    const jobs = await prisma.job.findMany({ where: { tenantId, type: "PARSE_REPLY" } });
    expect(jobs).toHaveLength(2);
    expect(jobs.every((j) => (j.payload as { history?: boolean }).history === true)).toBe(true);
    expect(await prisma.activity.count({ where: { tenantId } })).toBe(3);
  });

  it("never stores the same email twice, from a re-read or from the funding inbox", async () => {
    await prisma.mailboxConnection.update({
      where: { id: historyId },
      data: { importState: { reset: true } },
    });
    await handleHistoryImport(prisma, job(historyId));
    // The funding inbox has its own Gmail ids for the same emails.
    inbox.messages = inbox.messages.map((m) => ({ ...m, messageId: `funding-${m.messageId}` }));
    await handleInboxSync(prisma, job(sendId, "INBOX_SYNC"));
    expect(await prisma.activity.count({ where: { tenantId } })).toBe(3);
    expect(await prisma.submission.count({ where: { deal: { tenantId } } })).toBe(2);
  });

  it("learns lender answers with the email's own dates, without opening stip chases", async () => {
    for (const j of await prisma.job.findMany({ where: { tenantId, type: "PARSE_REPLY" } })) {
      await handleParseReply(prisma, { ...j, type: "PARSE_REPLY" } as never);
    }
    const subs = await prisma.submission.findMany({
      where: { deal: { tenantId } },
      include: { funder: true },
    });
    const one = subs.find((s) => s.funder.name === "Lender One")!;
    expect(one.status).toBe("APPROVED");
    expect((one.rawStatusLog as { at: string }[]).at(-1)!.at).toBe("2026-09-01T18:00:00.000Z");
    expect(await prisma.stipulation.count({ where: { deal: { tenantId } } })).toBe(0);

    const { lenders, habits } = await loadPlaybook(prisma, tenantId);
    expect(lenders.find((l) => l.name === "Lender One")).toMatchObject({
      approved: 1,
      medianReplyHours: 6,
      maxPositionsApproved: 2,
      typicalOffer: { amount: 20000, factor: 1.45 },
    });
    expect(habits).toMatchObject({ dealsShopped: 1, medianLendersPerDeal: 2 });
    expect(habits.sentTogether).toEqual([{ a: "Lender One", b: "Lender Two", count: 1 }]);

    const history = await lenderHistory(prisma, tenantId, null);
    expect(history[funderIds["Lender One"]!]).toMatchObject({
      approved: 1,
      maxPositionsApproved: 2,
    });
  });
});
