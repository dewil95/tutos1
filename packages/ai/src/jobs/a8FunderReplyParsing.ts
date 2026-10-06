import { textBlock, type StructuredCallResult, type LlmClient } from "../llm";

import { FunderReplySchema, type FunderReply } from "../schemas/funderReply";

export const A8_PROMPT_VERSION = "a8.v1";

export const A8_SYSTEM = `You classify emails that MCA funders send back to a broker (ISO) about a submitted deal, and extract the structured facts. You receive the subject, sender, and plain-text body (quoted history may be included below "On ... wrote:" or "From:" lines — ignore quoted text, classify only the newest message). Produce JSON per the schema.

Intent rules:
- ACKNOWLEDGED: templated receipt ("SUBMISSION RECEIVED", "FILE IN REVIEW", "we have received your submission").
- IN_REVIEW: a human or system says the file is moving forward without a decision ("moving to final review", "management will review Monday", "we're open and funding, update later today").
- DECLINED: any pass/decline. Copy each reason verbatim into declineReasons and pick the closest declineCategory. "Does not meet minimum true revenue" → LOW_REVENUE; "bad balances"/"low balances" → BAD_BALANCES; "declining deposits"/"big drop in rev" → DECLINING_DEPOSITS; "multiple advances"/"too many positions" → TOO_MANY_POSITIONS; "took new funding in MTD" → NEW_FUNDING_MTD; "Black list, State - X" → STATE; "in debt settlement" → DEBT_SETTLEMENT. A decline with no reason → NO_REASON_GIVEN.
- APPROVED: an approval, offer, or pricing. Parse EVERY option row. Known formats:
  (a) Grid: "Approval amount $X / Number of payments N / Repayment Daily" then rows "payment rate commission points" — each row is an option; buyRate = the 0-point row's rate; approvalAmount = X.
  (b) Table with columns per term: "PURCHASE PRICE | RTR | Origination fee % | Origination fee $ | UCC | Wire | NET FUNDING AMOUNT | DAILY PAYMENT | Term (business days) | Broker's fee % | Broker's fee $" — one option per column; termDays = business days; commissionPoints = broker's fee %.
  (c) List: "15K 40 Days" then rows "factor fee% pts" — amount and term apply to every row; originationFeePct = fee%.
  (d) Short form: "Funding $X / Rate 1.50 / Daily $Y / Payback $Z / Term N days".
  (e) Block: "OFFER: $X / FEES: $F / NET FUNDING: $N / DAILY PAYMENTS: N / Factor/Daily/Commission: 1.499 - $P per day. 9%".
- OFFER_REVISED: same as APPROVED but the text says revised/updated/reduced ("Revised offer due to recent funding", "Updated offer").
- STIP_REQUEST: the funder needs something: missing statements, MTD, merchant phone, voided check, an explanation ("Where is payments to expansion?"), or a portal "missing items" notice. List each item in stips.
- CONTRACT_SENT / CONTRACT_SIGNED: "Contract Has Been Sent", "Docs sent", "Contract Has Been Signed", "CONTRACT SIGNED:". Capture DecisionLogic or DocuSign links.
- FUNDING_CALL: funding call scheduled or completed ("will call for FC", "FC complete").
- FUNDED: "DEAL FUNDED", "the deal below was funded". Extract amount, commission, clawback days and whether the broker must reply to confirm.
- FOLLOW_UP: funder chasing the broker about an outstanding offer ("How is our offer?", "what do you need to get this closed?", "Deal is in competition, first to sign docs wins").
- MARKETING: program blasts not tied to a deal.
- forwardedToAlternateFunder: set when the funder says it passed the file to another funder for pricing (e.g. Fundzilla).
Numbers: strip $ and commas; "1.499" is a factor; "9%" after a factor row is commission points. Never invent rows that are not in the text. Set isAutomated=true for templated/portal messages and auto-acks.`;

export interface A8Input {
  subject: string;
  from: string;
  body: string;
  /** Known funder name if the sender domain is already mapped; helps disambiguation. */
  knownFunderName?: string | null;
  tenantId?: string;
  dealId?: string;
}

export async function runFunderReplyParsing(
  client: LlmClient,
  input: A8Input,
): Promise<StructuredCallResult<FunderReply>> {
  const header =
    `From: ${input.from}\nSubject: ${input.subject}` +
    (input.knownFunderName ? `\nKnown funder: ${input.knownFunderName}` : "");
  return client.structured({
    job: "A8_INBOUND_PARSING",
    promptVersion: A8_PROMPT_VERSION,
    system: A8_SYSTEM,
    user: [textBlock(`${header}\n\n--- BODY ---\n${input.body}`)],
    schema: FunderReplySchema,
    // High-volume (every funder email): fast tier. Offers are re-checked by a human on the
    // confirm screen before they become Offer rows, so a cheaper model is acceptable here.
    tier: "fast",
    effort: "low",
    maxTokens: 8_000,
    tenantId: input.tenantId,
    dealId: input.dealId,
  });
}
