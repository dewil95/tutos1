import { textBlock, type LlmClient, type StructuredCallResult } from "../llm";
import { RiskNarrativeSchema, type RiskNarrative } from "../schemas/riskReport";

export const RISK_PROMPT_VERSION = "risk.v1";

export const RISK_SYSTEM = `You write the internal risk summary an MCA broker's team reads before sending a deal to lenders. You receive facts computed by the CRM: risk score with the deductions that produced it, bank metrics, scrub flags, document integrity hints, existing positions, the merchant's application facts and a ranked list of lenders that fit.

Rules:
- Use only the facts given. Every risk must cite a number or flag from them.
- Do not change or recompute any score, amount or grade; refer to them.
- Integrity hints are things to check, not proof of fraud. Say "check" not "fraud".
- Questions for the merchant must be specific (e.g. "What was the $15,000 deposit from Sample Capital on 08/20?").
- lenderStrategy: name lender types or the ranked lenders given, and the order to approach them; no promises of approval.
- Plain English, short sentences, no selling language. This never goes to a lender or the merchant.`;

export async function runRiskNarrative(
  client: LlmClient,
  input: { facts: unknown; tenantId?: string; dealId?: string },
): Promise<StructuredCallResult<RiskNarrative>> {
  return client.structured({
    job: "RISK_REPORT",
    promptVersion: RISK_PROMPT_VERSION,
    system: RISK_SYSTEM,
    user: [textBlock(`Facts:\n${JSON.stringify(input.facts, null, 2)}`)],
    schema: RiskNarrativeSchema,
    tier: "primary",
    effort: "medium",
    maxTokens: 6_000,
    tenantId: input.tenantId,
    dealId: input.dealId,
  });
}
