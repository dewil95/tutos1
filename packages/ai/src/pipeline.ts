import { computeBankMetrics, gradePaper, type BankMetrics, type GradeResult } from "@mca/domain";
import type { LlmClient } from "./llm";
import { runStatementExtraction, type A1Input } from "./jobs/a1StatementExtraction";
import { runPositionDetection } from "./jobs/a2PositionDetection";
import { runPreUnderwriting, type A3Input } from "./jobs/a3PreUnderwriting";
import type { PositionDetection } from "./schemas/positions";
import type { PreUnderwriting } from "./schemas/preUnderwriting";
import type { StatementExtraction } from "./schemas/statement";

export interface StatementAnalysisInput {
  files: A1Input["files"];
  funderDescriptors: Record<string, string[]>;
  merchant: Omit<A3Input, "metrics" | "ruleGrade" | "positions" | "tenantId" | "dealId">;
  tenantId?: string;
  dealId?: string;
}

export interface StatementAnalysisResult {
  extraction: StatementExtraction;
  metrics: BankMetrics;
  ruleGrade: GradeResult;
  positions: PositionDetection;
  preUnderwriting: PreUnderwriting;
  totalCostUsd: number;
  aiRunIds: string[]; // populated by the caller's sink if it returns ids
}

/**
 * A1 → metrics/grade (deterministic) → A2 → A3. This is what the worker's
 * `statement-analysis` job runs. Each stage records its own AiRun through the client sink.
 */
export async function analyseStatements(
  client: LlmClient,
  input: StatementAnalysisInput,
): Promise<StatementAnalysisResult> {
  const ctx = { tenantId: input.tenantId, dealId: input.dealId };

  const a1 = await runStatementExtraction(client, { files: input.files, ...ctx });
  if (a1.data.months.length === 0) {
    throw new Error("no bank statement months were extracted; check document classification");
  }

  const metrics = computeBankMetrics(a1.data.months);

  const a2 = await runPositionDetection(client, {
    months: a1.data.months,
    funderDescriptors: input.funderDescriptors,
    ...ctx,
  });

  const ruleGrade = gradePaper({
    metrics,
    ficoEstimate: input.merchant.ficoEstimate,
    timeInBusinessMonths: input.merchant.timeInBusinessMonths,
    existingPositions: a2.data.activePositionCount,
  });

  const a3 = await runPreUnderwriting(client, {
    ...input.merchant,
    metrics,
    ruleGrade,
    positions: a2.data,
    ...ctx,
  });

  return {
    extraction: a1.data,
    metrics,
    ruleGrade,
    positions: a2.data,
    preUnderwriting: a3.data,
    totalCostUsd: a1.record.costUsd + a2.record.costUsd + a3.record.costUsd,
    aiRunIds: [],
  };
}
