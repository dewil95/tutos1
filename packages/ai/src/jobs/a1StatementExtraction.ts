import { pdfBlock, textBlock, type StructuredCallResult, type LlmClient } from "../llm";
import type { Effort } from "../models";

import { StatementExtractionSchema, type StatementExtraction } from "../schemas/statement";

export const A1_PROMPT_VERSION = "a1.v1";

export const A1_SYSTEM = `You are a senior merchant-cash-advance processor extracting data from business bank statements for pre-underwriting. You will receive one or more PDF documents. Produce the JSON described by the schema, nothing else.

Rules:
- First classify every document. Only BANK_STATEMENT documents feed the monthly rows.
- Produce exactly one row per calendar month per account. If two accounts are present, keep them separate (different accountLast4) and say so in warnings.
- totalDeposits is the gross credits total as printed by the bank. depositCount is the number of credit transactions.
- nonRevenueDeposits: sum every credit that is NOT sales revenue — transfers from another account of the same business, loan or MCA funding wires, owner contributions, refunds/reversals, tax refunds. List each in nonRevenueDepositNotes with its amount. Zelle/Cash App/Venmo credits ARE revenue unless clearly a transfer.
- nsfCount counts returned items, NSF/insufficient-funds events and "unpaid item" entries, including the fee lines when the bank only shows fees. overdraftFeeCount counts OD fees separately.
- negativeDays is the number of days the ending balance was below zero. If the statement has a daily balance table, use it; if not, infer from running balances and lower confidence.
- averageDailyBalance: use the bank's printed figure when present; otherwise compute from the daily balance table; otherwise estimate from beginning/ending and mark confidence below 0.6.
- recurringDebits: list every debit that repeats 3 or more times with a fixed amount or fixed cadence. Set looksLikeFinancing=true for lender-like payees (names containing CAPITAL, FUNDING, ADVANCE, FINANCIAL, LENDING, MCA, or known funders) and for any daily or weekly equal-amount ACH debit. Payroll, rent, utilities, merchant-processor fees and loan payments to banks are not MCA financing.
- isComplete=false when pages are missing (page X of Y gaps), the period is partial, or totals do not reconcile (beginning + deposits - withdrawals should equal ending within $1).
- Every number must be supported; include up to 10 evidence snippets per month pointing to the page.
- Never invent a month that is not in the documents. Never round.`;

export interface A1Input {
  files: { data: Buffer; fileName: string }[];
  /** Default "high". The per-file bank scrub uses "medium" to stay inside serverless time limits. */
  effort?: Effort;
  tenantId?: string;
  dealId?: string;
}

export async function runStatementExtraction(
  client: LlmClient,
  input: A1Input,
): Promise<StructuredCallResult<StatementExtraction>> {
  if (input.files.length === 0) throw new Error("at least one file is required");
  const user = [
    ...input.files.map((f, i) => pdfBlock(f.data, `Document ${i}: ${f.fileName}`)),
    textBlock(
      `There are ${input.files.length} document(s), indexed 0..${input.files.length - 1} in the order given. Extract per the schema.`,
    ),
  ];
  return client.structured({
    job: "A1_STATEMENT_EXTRACTION",
    promptVersion: A1_PROMPT_VERSION,
    system: A1_SYSTEM,
    user,
    schema: StatementExtractionSchema,
    tier: "primary",
    effort: input.effort ?? "high",
    maxTokens: 32_000,
    tenantId: input.tenantId,
    dealId: input.dealId,
  });
}
