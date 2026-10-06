import { textBlock, type StructuredCallResult, type LlmClient } from "../llm";

import { PositionDetectionSchema, type PositionDetection } from "../schemas/positions";
import type { MonthlyRow } from "../schemas/statement";

export const A2_PROMPT_VERSION = "a2.v1";

export const A2_SYSTEM = `You identify existing merchant-cash-advance and business-loan positions from recurring bank debits. You receive (a) a dictionary of known funders and their ACH descriptors and (b) the recurring debits already extracted per month. Produce JSON per the schema.

Rules:
- A position is a fixed-amount debit on a daily (business days) or weekly cadence to a lender-like payee. Monthly fixed debits are term loans or leases: include them with frequency "monthly" so the processor can judge, but they are usually not MCA positions.
- Match descriptors to the dictionary case-insensitively and tolerate truncation (banks cut descriptors at ~20 chars). If no match, set funderGuess to null unless the payee name itself is a recognisable funder.
- isActive=true only if the debit appears in the most recent month available.
- estimatedRemainingBalance: if you can see the first debit and a typical MCA term (daily: 100-250 payments, weekly: 20-52), estimate payments remaining × paymentAmount; otherwise null with the rationale.
- Exclude payroll, rent, utilities, insurance, credit-card payments, merchant-processor fees and tax payments.
- totalDailyEquivalentPayment = sum over active positions of (daily amount, weekly/5, biweekly/10, monthly/21).
- Be conservative: a debit seen only once or twice is not a position; mention it in notes instead.`;

export interface A2Input {
  months: MonthlyRow[];
  /** { funderName: ["DESCRIPTOR A", "DESCR B"] } from the Funder table */
  funderDescriptors: Record<string, string[]>;
  tenantId?: string;
  dealId?: string;
}

export async function runPositionDetection(
  client: LlmClient,
  input: A2Input,
): Promise<StructuredCallResult<PositionDetection>> {
  const debits = input.months.map((m) => ({ month: m.month, recurringDebits: m.recurringDebits }));
  const user = [
    textBlock(`Funder descriptor dictionary:\n${JSON.stringify(input.funderDescriptors, null, 2)}`),
    textBlock(`Recurring debits by month (most recent last):\n${JSON.stringify(debits, null, 2)}`),
  ];
  return client.structured({
    job: "A2_POSITION_DETECTION",
    promptVersion: A2_PROMPT_VERSION,
    system: A2_SYSTEM,
    user,
    schema: PositionDetectionSchema,
    tier: "primary",
    effort: "medium",
    tenantId: input.tenantId,
    dealId: input.dealId,
  });
}
