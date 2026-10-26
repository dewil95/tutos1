import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";
import { funderSeedsFromCsv, parseCsv } from "./funderCsv";
import {
  asList,
  getPrisma,
  merchantIdsByName,
  purgeTenant,
  seedTenant,
  type PrismaClient,
} from "./index";
import { migrationFiles, splitSql, useTestDatabase } from "./testing";
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
    // A lender on a free mailbox is matched by its exact address, never by gmail.com.
    expect(seeds.find((s) => s.name === "Fund Me Fast")!.emailDomains).toEqual([
      "fundmefastllc@gmail.com",
    ]);
    // Addresses a lender only replies from (portals) are recognised too.
    expect(seeds.find((s) => s.name.startsWith("Lendini"))!.emailDomains).toContain(
      "fundingmetrics.com",
    );
    expect(seeds.find((s) => s.name === "Zlur")!.emailDomains).toEqual(["zlur.com", "zlur.net"]);
    expect(seeds.filter((s) => s.isActive).length).toBeGreaterThanOrEqual(22);
  });
});

describe("retryDelayMs", () => {
  it("backs off exponentially and caps at an hour", () => {
    expect(retryDelayMs(1)).toBe(60_000);
    expect(retryDelayMs(3)).toBe(240_000);
    expect(retryDelayMs(20)).toBe(3_600_000);
  });
});

// Integration tests run on a temporary SQLite file (the same engine as the server).
await useTestDatabase();

describe("migrations", () => {
  it("split into statements, triggers kept whole", () => {
    const rules = migrationFiles().find((m) => m.name.startsWith("0002"))!;
    const stmts = splitSql(rules.sql);
    expect(stmts.filter((x) => x.startsWith("CREATE TRIGGER"))).toHaveLength(6);
    expect(stmts.every((x) => !x.startsWith("--"))).toBe(true);
  });

  it("together build exactly the Prisma schema", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { default: Database } = await import("better-sqlite3");
    const dir = mkdtempSync(join(tmpdir(), "mca-migrations-"));
    try {
      const file = join(dir, "migrated.db");
      const db = new Database(file);
      for (const m of migrationFiles()) for (const stmt of splitSql(m.sql)) db.exec(stmt);
      db.close();
      const left = execFileSync(
        "node",
        [join(here, "../scripts/schema-sql.mjs"), "--from-db", file],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      );
      // Only comments ("-- This is an empty migration.") may remain.
      expect(left.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("seed", () => {
  it("bundles the same roster as the CSV", async () => {
    const { FUNDER_ROSTER_CSV } = await import("./funderRoster");
    expect(FUNDER_ROSTER_CSV).toBe(
      readFileSync(join(here, "../../../docs/funder-appetite-matrix.csv"), "utf8"),
    );
  });

  it("creates the tenant, team and lenders once, and is safe to repeat", async () => {
    const prisma = getPrisma();
    const slug = `seed-${Date.now()}`;
    const first = await seedTenant(prisma, { slug });
    const again = await seedTenant(prisma, { slug });
    expect(again.tenant.id).toBe(first.tenant.id);
    expect(await prisma.user.count({ where: { tenantId: first.tenant.id } })).toBe(3);
    const lenders = await prisma.funder.findMany({
      where: { tenantId: first.tenant.id },
      include: { programs: true },
    });
    expect(lenders.length).toBe(first.lenders);
    expect(lenders.every((l) => l.programs.length === 1)).toBe(true);
    const mazal = lenders.find((l) => l.name === "Mazal Funders")!;
    expect(asList(mazal.submissionCc)).toEqual(["iso@mazalfunders.com", "nate@mazalfunders.com"]);
    await purgeTenant(prisma, first.tenant.id);
  }, 60_000);
});

describe("job queue (SQLite)", () => {
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
    // The trigger aborts the write (the SQLite driver reports it as a constraint error).
    await expect(
      prisma.dealEvent.update({ where: { id: ev.id }, data: { type: "edited" } }),
    ).rejects.toThrow();
    await expect(prisma.dealEvent.delete({ where: { id: ev.id } })).rejects.toThrow();
    expect(await prisma.dealEvent.findUniqueOrThrow({ where: { id: ev.id } })).toMatchObject({
      type: "note",
    });
  });

  it("purges a tenant with its history, and switches the purge back off", async () => {
    const t = await prisma.tenant.create({ data: { name: "Purge", slug: `purge-${Date.now()}` } });
    const m = await prisma.merchant.create({ data: { tenantId: t.id, legalName: "Gone LLC" } });
    const d = await prisma.deal.create({ data: { tenantId: t.id, merchantId: m.id } });
    await prisma.dealEvent.create({ data: { dealId: d.id, type: "note", actorType: "user" } });
    await purgeTenant(prisma, t.id);
    expect(await prisma.dealEvent.count({ where: { dealId: d.id } })).toBe(0);
    expect((await prisma.purgeFlag.findUniqueOrThrow({ where: { id: 1 } })).on).toBe(false);
  });

  it("stores lists as JSON and matches merchant names without case", async () => {
    const t = await prisma.tenant.update({
      where: { id: tenantId },
      data: { teamCc: ["a@x.test", "b@x.test"] },
    });
    expect(asList(t.teamCc)).toEqual(["a@x.test", "b@x.test"]);
    expect(asList(null)).toEqual([]);
    const m = await prisma.merchant.create({
      data: { tenantId, legalName: "Joe's Pizza LLC", dba: "Joe Pizza" },
    });
    expect(await merchantIdsByName(prisma, tenantId, "JOE'S PIZZA llc")).toEqual([m.id]);
    expect(await merchantIdsByName(prisma, tenantId, "joe pizza")).toEqual([]);
    expect(await merchantIdsByName(prisma, tenantId, "joe pizza", { includeDba: true })).toEqual([
      m.id,
    ]);
  });

  it("keeps dates exact to the millisecond and compares them correctly", async () => {
    const at = new Date("2026-10-13T12:34:56.789Z");
    const id = await enqueueJob(prisma, { tenantId, type: "INBOX_SYNC", payload: {}, runAt: at });
    expect((await prisma.job.findUniqueOrThrow({ where: { id } })).runAt.toISOString()).toBe(
      at.toISOString(),
    );
    expect(
      await claimJobs(prisma, { limit: 1, ids: [id], now: new Date(at.getTime() - 1) }),
    ).toEqual([]);
    expect(await claimJobs(prisma, { limit: 1, ids: [id], now: at })).toHaveLength(1);
  });
});
