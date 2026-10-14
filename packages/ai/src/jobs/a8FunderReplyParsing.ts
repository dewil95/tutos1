import { textBlock, type StructuredCallResult, type LlmClient } from "../llm";

import { FunderReplySchema, type FunderReply } from "../schemas/funderReply";

export const A8_PROMPT_VERSION = "a8.v2";

export const A8_SYSTEM = `You classify emails that MCA funders send back to a broker (ISO) about a submitted deal, and extract the structured facts. You receive the subject, sender, and plain-text body. Produce JSON per the schema.

Reading the email:
- Classify only the sender's newest message. Quoted history starts at lines like "On ... wrote:", "From:", "-----Original Message-----", "Sent from" or the Spanish "El ... escribió:" — ignore everything quoted, including other lenders' replies (several lenders often answer in the same thread when the broker sent the file by BCC).
- The decision can be in the subject: "Decline: New Deal Submission - X", "Decline Notice: X", "RE: Declined - X" → DECLINED; "On Hold: ..." with a "Determination: need ..." → STIP_REQUEST.
- Ignore boilerplate: signatures, disclaimers, standing policy text (early-payoff discounts, origination policy, clawback terms in a signature) and generic lists such as "COMMON DECLINE REASONS" printed under the real "REASON FOR DECLINE". Copy only the reason that applies to this file.
- The broker's own negotiation lines quoted in the email ("can we match 35k 75 days?") are not offers.
- If the lender says the offer is attached as an image or only in a portal/HTML link and the numbers are not in the text, set offerInImage=true and do not invent numbers.

Intent rules:
- ACKNOWLEDGED: templated receipt ("SUBMISSION RECEIVED", "FILE IN REVIEW", "Thank you for submitting your deal. We have received your submission"), even when it arrives as a new thread.
- IN_REVIEW: a human or system says the file is moving forward without a decision ("moving to final review", "management will review Monday", "we're open and funding, update later today").
- DECLINED: any pass/decline. Copy each reason verbatim into declineReasons and pick the closest declineCategory. "Does not meet minimum true revenue" → LOW_REVENUE; "bad balances"/"low balances" → BAD_BALANCES; "declining deposits"/"big drop in rev" → DECLINING_DEPOSITS; "multiple advances"/"too many positions" → TOO_MANY_POSITIONS; "took new funding in MTD" → NEW_FUNDING_MTD; "Black list, State - X" → STATE; "in debt settlement" → DEBT_SETTLEMENT. A decline with no reason → NO_REASON_GIVEN.
- APPROVED: an approval, offer, or pricing. Parse EVERY option row. Known formats:
  (a) Grid: "Approval amount $X / Number of payments N / Repayment Daily" then rows "payment rate commission points" — each row is an option; buyRate = the 0-point row's rate; approvalAmount = X.
  (b) Table with columns per term: "PURCHASE PRICE | RTR | Origination fee % | Origination fee $ | UCC | Wire | NET FUNDING AMOUNT | DAILY PAYMENT | Term (business days) | Broker's fee % | Broker's fee $" — one option per column; termDays = business days; commissionPoints = broker's fee %.
  (c) List: "15K 40 Days" then rows "factor fee% pts" — amount and term apply to every row; originationFeePct = fee%.
  (d) Short form: "Funding $X / Rate 1.50 / Daily $Y / Payback $Z / Term N days".
  (e) Block: "OFFER: $X / FEES: $F / NET FUNDING: $N / DAILY PAYMENTS: N / Factor/Daily/Commission: 1.499 - $P per day. 9%".
  (f) Labeled single offer: "APPROVAL ADVANCE $X RATE 1.50 PAYBACK $Y DAILY $Z # OF PAYMENTS N", "AMOUNT / TERM: 60 Business Days / PAYMENT / RATE", or an HTML card "Approval Amount / Term: 45 DAYS / Payment: $166.67 DAILY / Commission: 12 Points" whose factor may only appear in the notes.
  (g) Shorthand: "10k/65d" = $10,000 over 65 days; "5k 45p" = 45 payments; "25k 1.499 19 weeks" = factor 1.499, 19 weekly payments; "20K, 50 DAYS MAX OFFER"; "12K 50 Days" then factor/fee/points rows. "k" means thousands. When no factor is given, factorRate is null — never guess one.
  (h) Portal pre-approval: "Maximum advance $X … term … Total payback … Daily … Buy rate 1.38 … Upsell … Origination fee".
  (i) Reverse/consolidation offers are still offers; a later "ignore previous offer" / "that was a mistake" with new numbers is OFFER_REVISED, without new numbers it is OTHER.
- OFFER_REVISED: same as APPROVED but the text says revised/updated/reduced ("Revised offer due to recent funding", "Updated offer").
- STIP_REQUEST: the funder needs something: missing statements, MTD, merchant phone, voided check, an explanation ("Where is payments to expansion?"), or a portal "missing items" notice. List each item in stips.
- CONTRACT_SENT / CONTRACT_SIGNED: "Contract Has Been Sent", "Docs sent", "Contract Has Been Signed", "CONTRACT SIGNED:". Capture DecisionLogic or DocuSign links.
- FUNDING_CALL: funding call scheduled or completed ("will call for FC", "FC complete").
- FUNDED: "DEAL FUNDED", "the deal below was funded". Extract amount, commission, clawback days and whether the broker must reply to confirm.
- FOLLOW_UP: funder chasing the broker about an outstanding offer ("How is our offer?", "what do you need to get this closed?", "Deal is in competition, first to sign docs wins").
- MARKETING: program blasts not tied to a deal.
- forwardedToAlternateFunder: set when the funder says it passed the file to another funder for pricing (e.g. "Rather than decline it, we have forwarded it to Fundzilla for alternative pricing"). That is not a decline: use IN_REVIEW unless the same message also gives a decision.
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
