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

describe("positions in every style the team writes them", () => {
  const body = (block: string) =>
    `Hello,\n\nPlease see the attached deal for submission. RESTAURANT\n\n${block}\n\nThank you.\n\nConfidentiality Notice\nThis message …`;

  it.each([
    [
      "dream advances-8,000\nriver capital-45,660",
      [
        ["dream advances", 8000],
        ["river capital", 45660],
      ],
    ],
    ["cfg merchant solutions-$4,200", [["cfg merchant solutions", 4200]]],
    [
      "Kash 35427 Biz Capital 20264 iLEND 116000 Newbury 4300",
      [
        ["Kash", 35427],
        ["Biz Capital", 20264],
        ["iLEND", 116000],
        ["Newbury", 4300],
      ],
    ],
    [
      "Kapitus: $161,216; KIF Funding: $55,180;",
      [
        ["Kapitus", 161216],
        ["KIF Funding", 55180],
      ],
    ],
    ["QM Advance $4900 24weeks", [["QM Advance", 4900]]],
    ["Giggle Finance: $6,000", [["Giggle Finance", 6000]]],
    ["BITTY PIF FUNZILLA PIF\nexpansion capital-$20,200", [["expansion capital", 20200]]],
  ] as [string, [string, number][]][])("%s", (block, expected) => {
    expect(positionsFromSubmissionBody(body(block))).toEqual(
      expected.map(([funder, balance]) => ({ funder, balance })),
    );
  });

  it("leaves notes, competing offers and paid-off lines out", () => {
    const text = body(
      [
        "We are competing 50k 1.5 44 weeks",
        "dip funding-45,733",
        "NOTE: Seamless and Steddy will be paid off this week.",
        "Bitty Pay off, CFG Payoff",
        "The revenue drop in AUG is because the merchant is changing the CCP system because the fee was really high.",
        "Looking for 5k or 7k to close tomorrow team!",
      ].join("\n"),
    );
    expect(positionsFromSubmissionBody(text)).toEqual([{ funder: "dip funding", balance: 45733 }]);
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

describe.runIf(await databaseReady())("BCC blasts and forwarded re-shops", () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let historyId: string;
  const at = (d: string) => new Date(`2026-10-${d}Z`);
  const mail = (over: Partial<InboundEmail> & Pick<InboundEmail, "messageId">): InboundEmail => ({
    threadId: `t-${over.messageId}`,
    rfcMessageId: `<${over.messageId}@bcc.test>`,
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
    tenantId = (
      await prisma.tenant.create({ data: { name: "BCC Test", slug: `bcc-${Date.now()}` } })
    ).id;
    for (const [name, keys] of [
      ["Blast Lender", ["blastlender.test"]],
      ["Gmail Lender", ["quickfunds@gmail.com"]],
      ["Forward Lender", ["forwardlender.test"]],
      ["Status Lender", ["statuslender.test"]],
    ] as const) {
      await prisma.funder.create({
        data: { tenantId, name, emailDomains: [...keys], submissionTo: `uw@${name}.test` },
      });
    }
    historyId = (
      await prisma.mailboxConnection.create({
        data: {
          tenantId,
          email: "jonas@ascendfund.test",
          encryptedRefreshToken: "x",
          purpose: "history",
        },
      })
    ).id;
    inbox.searched = [];
    inbox.messages = [
      // BCC blast: only the team is visible.
      mail({
        messageId: "blast",
        threadId: "t-blast",
        to: ["david@ascendfund.test", "jonas@ascendfund.test"],
        subject: "New Deal Submission - Sample Tacos LLC",
        text: "Hello,\n\nPlease see the attached deal for submission.\n\nThank you.",
      }),
      // Two BCC'd lenders answer in the same thread.
      mail({
        messageId: "blast-r1",
        threadId: "t-blast",
        from: "deals@blastlender.test",
        subject: "RE: New Deal Submission - Sample Tacos LLC",
        receivedAt: at("01T15:00:00"),
      }),
      mail({
        messageId: "blast-r2",
        threadId: "t-blast",
        from: "quickfunds@gmail.com",
        subject: "RE: New Deal Submission - Sample Tacos LLC",
        receivedAt: at("01T16:00:00"),
      }),
      // A stranger on gmail.com is not a lender.
      mail({
        messageId: "stranger",
        threadId: "t-blast",
        from: "someone@gmail.com",
        subject: "RE: New Deal Submission - Sample Tacos LLC",
        receivedAt: at("01T16:30:00"),
      }),
      // Re-shop: the original forwarded to one more lender a day later.
      mail({
        messageId: "fwd",
        from: "jonas@ascendfund.test",
        to: ["uw@forwardlender.test"],
        subject: "Fwd: New Deal Submission - Sample Tacos LLC",
        receivedAt: at("02T10:00:00"),
      }),
      // A lender that answers in a new thread with its status in the subject.
      mail({
        messageId: "status",
        from: "uw@statuslender.test",
        subject: "Decline: New Deal Submission - Sample Tacos LLC",
        receivedAt: at("02T12:00:00"),
      }),
    ];
    for (const m of inbox.messages.filter((x) => x.from !== "funding@ascendfund.test")) {
      replies.set(`${m.from}|${m.subject}`, {
        intent: "ACKNOWLEDGED",
        offers: [],
        declineReasons: [],
        declineCategory: null,
        stips: [],
        funded: {
          amount: null,
          commissionAmount: null,
          clawbackDays: null,
          requiresConfirmationReply: false,
        },
        summary: "ok",
      });
    }
  });

  afterAll(async () => {
    await purgeTenant(prisma, tenantId);
  });

  it("gives every lender that got the file its own row, including BCC'd ones", async () => {
    await handleHistoryImport(prisma, {
      id: "j",
      tenantId,
      type: "HISTORY_IMPORT",
      payload: { mailboxId: historyId },
      attempts: 1,
      maxAttempts: 5,
    });
    const deal = await prisma.deal.findFirstOrThrow({
      where: { tenantId },
      include: { submissions: { include: { funder: true } } },
    });
    const rows = new Map(deal.submissions.map((s) => [s.funder.name, s]));
    expect([...rows.keys()].sort()).toEqual([
      "Blast Lender",
      "Forward Lender",
      "Gmail Lender",
      "Status Lender",
    ]);
    // A BCC'd lender's row dates from the blast, not from its reply.
    expect(rows.get("Blast Lender")!.sentAt!.toISOString()).toBe("2026-10-01T12:00:00.000Z");
    expect(rows.get("Forward Lender")!.sentAt!.toISOString()).toBe("2026-10-02T10:00:00.000Z");
    expect(await prisma.deal.count({ where: { tenantId } })).toBe(1);
  });
});
