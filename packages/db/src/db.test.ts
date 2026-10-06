import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";
import { funderSeedsFromCsv, parseCsv } from "./funderCsv";
import { getPrisma, purgeTenant, type PrismaClient } from "./index";
import { claimJobs, completeJob, enqueueJob, failJob, retryDelayMs } from "./jobs";

const here = dirname(fileURLToPath(import.meta.url));

describe("crypto", () => {
  const key = Buffer.alloc(32, 7).toString("base64");
  it("round-trips and detects tampering", () => {
    const enc = encryptSecret("1//refresh-token", key);
    expect(enc.startsWith("v1.")).toBe(true);
    expect(decryptSecret(enc, key)).toBe("1//refresh-token");
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), key)).toThrow();
  });
  it("rejects wrong-size keys", () => {
    expect(() => encryptSecret("x", Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("funder CSV", () => {
  it("parses quoted fields with commas and doubled quotes", () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([{ a: "x, y", b: 'he said "hi"' }]);
  });

  it("seeds the real lender roster with To + CC addresses", () => {
    const seeds = funderSeedsFromCsv(
      readFileSync(join(here, "../../../docs/funder-appetite-matrix.csv"), "utf8"),
    );
    expect(seeds.length).toBeGreaterThanOrEqual(14);
    const mazal = seeds.find((s) => s.name === "Mazal Funders")!;
    expect(mazal.submissionTo).toBe("subs@mazalfunders.com");
    expect(mazal.submissionCc).toEqual(["iso@mazalfunders.com", "nate@mazalfunders.com"]);
    expect(mazal.emailDomains).toEqual(["mazalfunders.com"]);
    const fundzilla = seeds.find((s) => s.name.startsWith("Fundzilla"))!;
    expect(fundzilla.isActive).toBe(false);
    const loan23 = seeds.find((s) => s.name === "Loan23")!;
    expect(loan23.program.excludedStates).toEqual(["TX"]);
    const cashable = seeds.find((s) => s.name === "Cashable Funding")!;
    expect(cashable.program.minMonthlyRevenue).toBe(30000);
    for (const s of seeds.filter((x) => x.isActive)) expect(s.submissionTo).toMatch(/@/);
  });
});

describe("retryDelayMs", () => {
  it("backs off exponentially and caps at an hour", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(240_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });
});

// Integration tests need Postgres (local cluster or the CI service). Skipped when unavailable.
const url = process.env.DATABASE_URL;
let reachable = false;
if (url) {
  const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 1500 });
  try {
    await c.connect();
    const r = await c.query(`select to_regclass('public."Job"') as t`);
    reachable = Boolean(r.rows[0]?.t);
  } catch {
    reachable = false;
  } finally {
    await c.end().catch(() => undefined);
  }
}

describe.runIf(reachable)("job queue (Postgres)", () => {
  let prisma: PrismaClient;
  let tenantId: string;

  beforeAll(async () => {
    prisma = getPrisma();
    const t = await prisma.tenant.create({
      data: { name: "Queue Test", slug: `queue-test-${Date.now()}` },
    });
    tenantId = t.id;
  });

  afterAll(async () => {
    await purgeTenant(prisma, tenantId);
    await prisma.$disconnect();
  });

  it("never hands the same job to two concurrent claimers", async () => {
    const ids = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        enqueueJob(prisma, { tenantId, type: "SEND_SUBMISSION", payload: { i } }),
      ),
    );
    const [a, b, c] = await Promise.all([
      claimJobs(prisma, { limit: 6, ids }),
      claimJobs(prisma, { limit: 6, ids }),
      claimJobs(prisma, { limit: 6, ids }),
    ]);
    const claimed = [...a, ...b, ...c].map((j) => j.id);
    expect(new Set(claimed).size).toBe(claimed.length);
    expect(claimed.length).toBe(12);
    for (const j of [...a, ...b, ...c]) expect(j.attempts).toBe(1);
  });

  it("dedupes live jobs by key and requeues finished ones", async () => {
    const k = `send:test-${Date.now()}`;
    const first = await enqueueJob(prisma, {
      tenantId,
      type: "SEND_SUBMISSION",
      payload: {},
      dedupeKey: k,
    });
    const again = await enqueueJob(prisma, {
      tenantId,
      type: "SEND_SUBMISSION",
      payload: {},
      dedupeKey: k,
    });
    expect(again).toBe(first);
    const [job] = await claimJobs(prisma, { limit: 1, ids: [first] });
    await completeJob(prisma, job!.id);
    const requeued = await enqueueJob(prisma, {
      tenantId,
      type: "SEND_SUBMISSION",
      payload: { r: 1 },
      dedupeKey: k,
    });
    expect(requeued).toBe(first);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: first } })).status).toBe("QUEUED");
  });

  it("retries with backoff then fails after maxAttempts", async () => {
    const id = await enqueueJob(prisma, {
      tenantId,
      type: "INBOX_SYNC",
      payload: {},
      maxAttempts: 2,
    });
    const [j1] = await claimJobs(prisma, { limit: 1, ids: [id] });
    expect(await failJob(prisma, j1!, "boom")).toBe("retry");
    const queued = await prisma.job.findUniqueOrThrow({ where: { id } });
    expect(queued.status).toBe("QUEUED");
    expect(queued.runAt.getTime()).toBeGreaterThan(Date.now());
    expect(await claimJobs(prisma, { limit: 1, ids: [id] })).toEqual([]); // not due yet
    await prisma.job.update({ where: { id }, data: { runAt: new Date(0) } });
    const [j2] = await claimJobs(prisma, { limit: 1, ids: [id] });
    expect(j2!.attempts).toBe(2);
    expect(await failJob(prisma, j2!, "boom again")).toBe("failed");
    expect((await prisma.job.findUniqueOrThrow({ where: { id } })).status).toBe("FAILED");
  });

  it("reclaims jobs stuck in RUNNING after the stale timeout", async () => {
    const id = await enqueueJob(prisma, { tenantId, type: "INBOX_SYNC", payload: {} });
    await claimJobs(prisma, { limit: 1, ids: [id] });
    expect(await claimJobs(prisma, { limit: 1, ids: [id] })).toEqual([]);
    await prisma.job.update({
      where: { id },
      data: { lockedAt: new Date(Date.now() - 11 * 60_000) },
    });
    const [again] = await claimJobs(prisma, { limit: 1, ids: [id] });
    expect(again!.attempts).toBe(2);
  });

  it("keeps the deal timeline append-only unless a purge opts in", async () => {
    const merchant = await prisma.merchant.create({ data: { tenantId, legalName: "Audit Co" } });
    const deal = await prisma.deal.create({ data: { tenantId, merchantId: merchant.id } });
    const ev = await prisma.dealEvent.create({
      data: { dealId: deal.id, type: "note", actorType: "user" },
    });
    await expect(
      prisma.dealEvent.update({ where: { id: ev.id }, data: { type: "edited" } }),
    ).rejects.toThrow(/append-only/);
    await expect(prisma.dealEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
  });
});
