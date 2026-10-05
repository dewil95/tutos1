/**
 * Eval runner: `pnpm --filter @mca/ai eval -- <job|all>`.
 * Reads evals/data/<job>/cases.json, runs the job, compares to `expected`, prints accuracy and
 * cost, exits non-zero when below evals/thresholds.json. Requires ANTHROPIC_API_KEY.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ClaudeClient, type AiRunRecord } from "../src/client";
import { runPositionDetection } from "../src/jobs/a2PositionDetection";
import { runFunderReplyParsing } from "../src/jobs/a8FunderReplyParsing";
import type { FunderReply } from "../src/schemas/funderReply";
import type { MonthlyRow } from "../src/schemas/statement";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "data");
const resultsDir = join(here, "results");

interface Thresholds {
  [job: string]: { minCases: number; recall?: number; precision?: number; [k: string]: unknown };
}

interface A2Case {
  id: string;
  input: {
    funderDescriptors: Record<string, string[]>;
    months: Array<Pick<MonthlyRow, "month" | "recurringDebits">>;
  };
  expected: {
    activePositionCount: number;
    positions: Array<{
      descriptor: string;
      funderGuess: string | null;
      frequency: string;
      isActive: boolean;
    }>;
  };
}

const thresholds = JSON.parse(readFileSync(join(here, "thresholds.json"), "utf8")) as Thresholds;

async function evalA2(client: ClaudeClient): Promise<{ pass: boolean; summary: string }> {
  const file = join(dataDir, "a2-position-detection", "cases.json");
  const cases = JSON.parse(readFileSync(file, "utf8")) as A2Case[];
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let cost = 0;
  const perCase: unknown[] = [];

  for (const c of cases) {
    const months = c.input.months.map((m) => ({ ...emptyRow(m.month), ...m })) as MonthlyRow[];
    const res = await runPositionDetection(client, {
      months,
      funderDescriptors: c.input.funderDescriptors,
    });
    cost += res.record.costUsd;
    const got = res.data.positions;
    const matched = new Set<number>();
    for (const exp of c.expected.positions) {
      const idx = got.findIndex(
        (g, i) =>
          !matched.has(i) &&
          g.descriptor.toLowerCase().includes(exp.descriptor.toLowerCase().slice(0, 8)) &&
          g.frequency === exp.frequency &&
          g.isActive === exp.isActive,
      );
      if (idx >= 0) {
        tp++;
        matched.add(idx);
      } else fn++;
    }
    fp += got.length - matched.size;
    perCase.push({ id: c.id, got, expected: c.expected, costUsd: res.record.costUsd });
  }

  const recall = tp + fn ? tp / (tp + fn) : 1;
  const precision = tp + fp ? tp / (tp + fp) : 1;
  const t = thresholds["a2-position-detection"]!;
  const enough = cases.length >= t.minCases;
  const pass = recall >= (t.recall ?? 0) && precision >= (t.precision ?? 0);
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    join(resultsDir, "a2-position-detection.json"),
    JSON.stringify({ recall, precision, cost, perCase }, null, 2),
  );
  return {
    pass,
    summary: `a2: cases=${cases.length}${enough ? "" : ` (below minCases ${t.minCases}, advisory)`} recall=${recall.toFixed(3)} precision=${precision.toFixed(3)} cost=$${cost.toFixed(4)}`,
  };
}

function emptyRow(month: string): MonthlyRow {
  return {
    month,
    bankName: null,
    accountLast4: null,
    beginningBalance: 0,
    endingBalance: 0,
    totalDeposits: 0,
    depositCount: 0,
    totalWithdrawals: 0,
    nonRevenueDeposits: 0,
    nonRevenueDepositNotes: [],
    averageDailyBalance: 0,
    nsfCount: 0,
    overdraftFeeCount: 0,
    negativeDays: 0,
    minDailyBalance: 0,
    isComplete: true,
    recurringDebits: [],
    evidence: [],
    confidence: 1,
  };
}

interface A8Case {
  id: string;
  input: { from: string; subject: string; body: string };
  expected: {
    intent: FunderReply["intent"];
    isAutomated?: boolean;
    declineCategory?: FunderReply["declineCategory"];
    declineReasonCount?: number;
    offerCount?: number;
    approvalAmount?: number;
    numberOfPayments?: number;
    buyRate?: number;
    maxPoints?: number;
    paymentFrequency?: string;
    firstOffer?: Partial<FunderReply["offers"][number]>;
    stipCount?: number;
    linkCount?: number;
    forwardedToAlternateFunder?: string;
    funded?: Partial<FunderReply["funded"]>;
  };
}

const near = (a: number | null | undefined, b: number) =>
  a !== null && a !== undefined && Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.005);

/** Returns the list of expectation names that did not hold for one case. */
function checkA8(got: FunderReply, exp: A8Case["expected"]): string[] {
  const miss: string[] = [];
  if (got.intent !== exp.intent) miss.push(`intent ${got.intent}≠${exp.intent}`);
  if (exp.isAutomated !== undefined && got.isAutomated !== exp.isAutomated)
    miss.push("isAutomated");
  if (exp.declineCategory !== undefined && got.declineCategory !== exp.declineCategory)
    miss.push(`declineCategory ${got.declineCategory}`);
  if (exp.declineReasonCount !== undefined && got.declineReasons.length !== exp.declineReasonCount)
    miss.push("declineReasonCount");
  if (exp.offerCount !== undefined && got.offers.length !== exp.offerCount)
    miss.push(`offerCount ${got.offers.length}≠${exp.offerCount}`);
  if (
    exp.approvalAmount !== undefined &&
    !near(got.offerBaseline.approvalAmount, exp.approvalAmount)
  )
    miss.push("approvalAmount");
  if (
    exp.numberOfPayments !== undefined &&
    got.offerBaseline.numberOfPayments !== exp.numberOfPayments
  )
    miss.push("numberOfPayments");
  if (exp.buyRate !== undefined && !near(got.offerBaseline.buyRate, exp.buyRate))
    miss.push("buyRate");
  if (
    exp.paymentFrequency !== undefined &&
    got.offerBaseline.paymentFrequency !== exp.paymentFrequency
  )
    miss.push("paymentFrequency");
  if (exp.maxPoints !== undefined) {
    const max = Math.max(...got.offers.map((o) => o.commissionPoints ?? 0));
    if (!near(max, exp.maxPoints)) miss.push("maxPoints");
  }
  if (exp.firstOffer) {
    const first = got.offers[0];
    if (!first) miss.push("firstOffer missing");
    else
      for (const [k, v] of Object.entries(exp.firstOffer)) {
        const g = (first as Record<string, unknown>)[k];
        const ok = typeof v === "number" ? near(g as number, v) : g === v;
        if (!ok) miss.push(`firstOffer.${k}`);
      }
  }
  if (exp.stipCount !== undefined && got.stips.length !== exp.stipCount) miss.push("stipCount");
  if (exp.linkCount !== undefined && got.links.length !== exp.linkCount) miss.push("linkCount");
  if (
    exp.forwardedToAlternateFunder !== undefined &&
    !(got.forwardedToAlternateFunder ?? "")
      .toLowerCase()
      .includes(exp.forwardedToAlternateFunder.toLowerCase())
  )
    miss.push("forwardedToAlternateFunder");
  if (exp.funded)
    for (const [k, v] of Object.entries(exp.funded)) {
      const g = (got.funded as Record<string, unknown>)[k];
      const ok = typeof v === "number" ? near(g as number, v) : g === v;
      if (!ok) miss.push(`funded.${k}`);
    }
  return miss;
}

async function evalA8(client: ClaudeClient): Promise<{ pass: boolean; summary: string }> {
  const file = join(dataDir, "a8-reply-parsing", "cases.json");
  const cases = JSON.parse(readFileSync(file, "utf8")) as A8Case[];
  let intentHits = 0;
  let fullHits = 0;
  let cost = 0;
  const perCase: unknown[] = [];
  for (const c of cases) {
    const res = await runFunderReplyParsing(client, c.input);
    cost += res.record.costUsd;
    const misses = checkA8(res.data, c.expected);
    if (res.data.intent === c.expected.intent) intentHits++;
    if (misses.length === 0) fullHits++;
    perCase.push({ id: c.id, misses, got: res.data, costUsd: res.record.costUsd });
  }
  const intentAccuracy = cases.length ? intentHits / cases.length : 1;
  const fieldAccuracy = cases.length ? fullHits / cases.length : 1;
  const t = thresholds["a8-reply-parsing"]!;
  const enough = cases.length >= t.minCases;
  const pass = intentAccuracy >= ((t.intentAccuracy as number | undefined) ?? 0);
  mkdirSync(resultsDir, { recursive: true });
  writeFileSync(
    join(resultsDir, "a8-reply-parsing.json"),
    JSON.stringify({ intentAccuracy, fieldAccuracy, cost, perCase }, null, 2),
  );
  return {
    pass,
    summary: `a8: cases=${cases.length}${enough ? "" : ` (below minCases ${t.minCases}, advisory)`} intent=${intentAccuracy.toFixed(3)} allFields=${fieldAccuracy.toFixed(3)} cost=$${cost.toFixed(4)}`,
  };
}

const EVALS: Record<string, (c: ClaudeClient) => Promise<{ pass: boolean; summary: string }>> = {
  "a2-position-detection": evalA2,
  "a8-reply-parsing": evalA8,
  // a1 / a3 runners are added as their golden sets land (docs/ai-evals.md)
};

async function main() {
  const target = process.argv[2] ?? "all";
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("ANTHROPIC_API_KEY is required to run evals");
    process.exit(2);
  }
  const runs: AiRunRecord[] = [];
  const client = new ClaudeClient({ sink: (r) => void runs.push(r) });
  const jobs = target === "all" ? Object.keys(EVALS) : [target];
  let failed = false;
  for (const job of jobs) {
    const fn = EVALS[job];
    if (!fn) {
      console.error(`unknown eval "${job}"; known: ${Object.keys(EVALS).join(", ")}`);
      process.exit(2);
    }
    if (!existsSync(join(dataDir, job, "cases.json"))) {
      console.log(`${job}: no cases.json, skipping`);
      continue;
    }
    const { pass, summary } = await fn(client);
    console.log(`${pass ? "PASS" : "FAIL"} ${summary}`);
    failed ||= !pass;
  }
  const totalCost = runs.reduce((a, r) => a + r.costUsd, 0);
  console.log(`total Claude calls=${runs.length} cost=$${totalCost.toFixed(4)}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
