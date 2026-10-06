import { enqueueJob, getPrisma, purgeTenant, type PrismaClient } from "@mca/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { queueScrubWhenReady } from "./jobs/statementExtract";
import { collectRows } from "./jobs/statementScrub";
import { typesThatFit } from "./jobs/runner";
import { databaseReady } from "./testDb";

const month = (m: string, account = "1234", deposits = 50_000) => ({
  month: m,
  accountLast4: account,
  beginningBalance: 0,
  endingBalance: 0,
  totalDeposits: deposits,
  depositCount: 10,
  totalWithdrawals: deposits,
  nonRevenueDeposits: 0,
  averageDailyBalance: 1,
  nsfCount: 0,
  overdraftFeeCount: 0,
  negativeDays: 0,
  minDailyBalance: 0,
  isComplete: true,
});
const doc = (id: string, at: string, months: ReturnType<typeof month>[]) => ({
  id,
  fileName: `${id}.pdf`,
  createdAt: new Date(at),
  extraction: { months, documents: [], warnings: [] },
});

describe("collectRows", () => {
  it("keeps the newest file for a repeated month and only the latest six months", () => {
    const { rows, sourceByMonth } = collectRows([
      doc("old", "2026-09-01", [month("2026-08", "1234", 40_000)]),
      doc("new", "2026-09-10", [month("2026-08", "1234", 45_000)]),
      doc(
        "pack",
        "2026-09-05",
        ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"].map((m) =>
          month(m),
        ),
      ),
    ]);
    expect(rows.map((r) => r.month)).toEqual([
      "2026-08",
      "2026-07",
      "2026-06",
      "2026-05",
      "2026-04",
      "2026-03",
    ]);
    expect(rows[0]!.totalDeposits).toBe(45_000);
    expect(sourceByMonth["2026-08|1234"]).toBe("new");
  });
});

describe("runner time guard", () => {
  it("skips slow AI jobs when little time is left, but still sends emails", () => {
    expect(typesThatFit(50_000)).toBeUndefined();
    const late = typesThatFit(10_000)!;
    expect(late).toContain("SEND_SUBMISSION");
    expect(late).not.toContain("STATEMENT_EXTRACT");
    expect(typesThatFit(10_000, ["RISK_REPORT"])).toEqual(["__none__"]);
  });
});

describe.runIf(await databaseReady())("scrub queueing (Postgres)", () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let dealId: string;
  const docIds: string[] = [];

  beforeAll(async () => {
    prisma = getPrisma();
    tenantId = (
      await prisma.tenant.create({ data: { name: "Scrub Test", slug: `scrub-${Date.now()}` } })
    ).id;
    const merchant = await prisma.merchant.create({ data: { tenantId, legalName: "Sample Co" } });
    dealId = (await prisma.deal.create({ data: { tenantId, merchantId: merchant.id } })).id;
    for (const n of [1, 2]) {
      const d = await prisma.document.create({
        data: {
          tenantId,
          dealId,
          type: "BANK_STATEMENT",
          driveFileId: `scrub-${Date.now()}-${n}`,
          fileName: `s${n}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: 1,
          sha256: `s${n}`,
        },
      });
      docIds.push(d.id);
      await enqueueJob(prisma, {
        tenantId,
        type: "STATEMENT_EXTRACT",
        payload: { documentId: d.id },
        dedupeKey: `extract:${d.id}`,
      });
    }
  });

  afterAll(async () => {
    await purgeTenant(prisma, tenantId);
    await prisma.$disconnect();
  });

  it("waits for the last statement, then queues one scrub", async () => {
    await prisma.document.update({ where: { id: docIds[0] }, data: { extractedAt: new Date() } });
    expect(await queueScrubWhenReady(prisma, tenantId, dealId, docIds[0])).toBeNull();

    await prisma.document.update({ where: { id: docIds[1] }, data: { extractedAt: new Date() } });
    await prisma.job.updateMany({
      where: { dedupeKey: `extract:${docIds[0]}` },
      data: { status: "DONE" },
    });
    const a = await queueScrubWhenReady(prisma, tenantId, dealId, docIds[1]);
    const b = await queueScrubWhenReady(prisma, tenantId, dealId, docIds[1]);
    expect(a).not.toBeNull();
    expect(b).toBe(a); // finishing twice never queues two scrubs
    expect(await prisma.job.count({ where: { dedupeKey: `scrub:${dealId}` } })).toBe(1);
  });
});
