import { z } from "zod";

/**
 * Output of AI job A8: classify one inbound funder email and extract what the CRM needs.
 * Intents mirror the SubmissionStatus / Offer / Contract / Funding tables in @mca/db and the
 * reply styles observed in the Ascend Fund inbox (docs/PLAN.md §0).
 */
export const FunderReplyIntentSchema = z.enum([
  "ACKNOWLEDGED", // "SUBMISSION RECEIVED / FILE IN REVIEW"
  "IN_REVIEW", // "moving to final review", "will have an update later today"
  "DECLINED",
  "APPROVED", // offer / approval grid / table
  "OFFER_REVISED", // "Updated offer", "Revised offer due to recent funding"
  "STIP_REQUEST", // missing docs, questions about statements, MTD, phone number
  "CONTRACT_SENT",
  "CONTRACT_SIGNED",
  "FUNDING_CALL", // "will call for FC", "FC complete"
  "FUNDED",
  "FOLLOW_UP", // funder chasing broker: "how is our offer?", "what do you need to close?"
  "MARKETING", // program blasts, "we are open and funding"
  "OTHER",
]);

export const OfferOptionSchema = z
  .object({
    advanceAmount: z.number().min(0).describe("Funded / purchase price amount"),
    factorRate: z.number().min(1).describe("Sell rate shown for this row, e.g. 1.49"),
    paybackAmount: z.number().min(0).nullable(),
    paymentAmount: z.number().min(0).nullable(),
    paymentFrequency: z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"]).nullable(),
    numberOfPayments: z.number().int().min(1).nullable(),
    termDays: z.number().int().min(1).nullable().describe("Business days when stated as days"),
    commissionPoints: z.number().min(0).nullable(),
    commissionAmount: z.number().min(0).nullable(),
    originationFeePct: z.number().min(0).nullable(),
    originationFeeAmount: z.number().min(0).nullable(),
    otherFees: z
      .array(z.object({ name: z.string(), amount: z.number() }).strict())
      .describe("UCC, wire, etc."),
    netFundingAmount: z.number().min(0).nullable(),
  })
  .strict();

export const FunderReplySchema = z
  .object({
    intent: FunderReplyIntentSchema,
    isAutomated: z.boolean().describe("Template / portal / auto-responder rather than a human"),
    merchantName: z.string().nullable().describe("As written in subject or body"),
    funderName: z.string().nullable(),
    declineReasons: z
      .array(z.string())
      .describe("Verbatim reasons, one per item; empty unless DECLINED"),
    declineCategory: z
      .enum([
        "LOW_REVENUE",
        "BAD_BALANCES",
        "DECLINING_DEPOSITS",
        "TOO_MANY_POSITIONS",
        "NEW_FUNDING_MTD",
        "INDUSTRY",
        "STATE",
        "DEBT_SETTLEMENT",
        "TIME_IN_BUSINESS",
        "NO_REASON_GIVEN",
        "OTHER",
      ])
      .nullable(),
    offers: z
      .array(OfferOptionSchema)
      .describe(
        "One row per option when a grid/table is given; empty unless APPROVED or OFFER_REVISED",
      ),
    offerBaseline: z
      .object({
        approvalAmount: z.number().min(0).nullable(),
        numberOfPayments: z.number().int().nullable(),
        paymentFrequency: z.enum(["DAILY", "WEEKLY", "BIWEEKLY", "MONTHLY"]).nullable(),
        buyRate: z
          .number()
          .min(1)
          .nullable()
          .describe("Lowest factor row, i.e. zero-commission rate"),
      })
      .strict(),
    stips: z.array(z.string()).describe("Documents or answers the funder is asking for"),
    questionsForBroker: z.array(z.string()),
    links: z.array(z.string()).describe("DecisionLogic, portal, DocuSign or stip links"),
    funded: z
      .object({
        amount: z.number().min(0).nullable(),
        commissionAmount: z.number().min(0).nullable(),
        clawbackDays: z.number().int().nullable(),
        requiresConfirmationReply: z.boolean(),
      })
      .strict(),
    forwardedToAlternateFunder: z
      .string()
      .nullable()
      .describe("e.g. Fundzilla when Mazal passes the file on"),
    summary: z.string().max(300).describe("One sentence for the deal timeline"),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type FunderReply = z.infer<typeof FunderReplySchema>;
export type FunderReplyIntent = z.infer<typeof FunderReplyIntentSchema>;
export type OfferOption = z.infer<typeof OfferOptionSchema>;
