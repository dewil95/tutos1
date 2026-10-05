import type { BankMetrics, GradeResult } from "@mca/domain";
import { ClaudeClient, textBlock, type StructuredCallResult } from "../client";
import { MODELS } from "../models";
import type { PositionDetection } from "../schemas/positions";
import { PreUnderwritingSchema, type PreUnderwriting } from "../schemas/preUnderwriting";

export const A3_PROMPT_VERSION = "a3.v1";

export const A3_SYSTEM = `You are an experienced MCA broker-side underwriter. You receive computed bank metrics, a deterministic rule-based paper grade with its reasons, detected positions, and the merchant's application facts. Produce the JSON per the schema.

How funders think (use this, do not restate it):
- Paper grades: A = clean statements, <2 NSFs/90 days, ADB ≥ 5% of deposits, 12+ months in business, $30K+/mo true revenue. B = 2-5 NSFs, 6-12 months, $15-30K. C = 5-10 NSFs, thin balances, $5-15K. D = heavy stacking, defaults, declining revenue.
- First-position sizing ≈ 0.75-1.5× average monthly true revenue, capped at roughly 10-25% of annual revenue; each extra position shrinks the advance and adds ~0.05-0.15 to the factor.
- Factor 1.15-1.49 typical, 3-18 month terms, daily or weekly ACH.
- Common decline reasons: too many positions, low ADB, excessive NSFs/negative days, restricted industry, insufficient time in business, altered documents, revenue dominated by transfers.

Rules:
- Start from the rule grade. Disagree only with a concrete reason tied to the data (set agreesWithRuleGrade accordingly).
- Red flags must cite a number from the input in evidence.
- maxAdvanceEstimate must respect the sizing heuristics above and the active positions.
- processorSummary is written for a funder's ISO rep: 4-6 sentences, factual, no selling language, no merchant PII beyond business name.
- Never make a credit decision; you are preparing a human processor.`;

export interface A3Input {
  businessName: string;
  industry: string | null;
  naics: string | null;
  state: string | null;
  timeInBusinessMonths: number | null;
  requestedAmount: number | null;
  useOfFunds: string | null;
  ficoEstimate: number | null;
  metrics: BankMetrics;
  ruleGrade: GradeResult;
  positions: PositionDetection;
  tenantId?: string;
  dealId?: string;
}

export async function runPreUnderwriting(
  client: ClaudeClient,
  input: A3Input,
): Promise<StructuredCallResult<PreUnderwriting>> {
  const { tenantId, dealId, ...facts } = input;
  return client.structured({
    job: "A3_PRE_UNDERWRITING",
    promptVersion: A3_PROMPT_VERSION,
    system: A3_SYSTEM,
    user: [textBlock(`Deal facts:\n${JSON.stringify(facts, null, 2)}`)],
    schema: PreUnderwritingSchema,
    model: MODELS.primary,
    effort: "high",
    tenantId,
    dealId,
  });
}
