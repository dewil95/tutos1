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

const EVALS: Record<string, (c: ClaudeClient) => Promise<{ pass: boolean; summary: string }>> = {
  "a2-position-detection": evalA2,
  // a1 / a3 / a8 runners are added as their golden sets land (docs/ai-evals.md)
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
