import { z } from "zod";

/** Evidence pointer so the verify screen can show where a number came from. */
export const EvidenceSchema = z
  .object({
    documentIndex: z.number().int().min(0).describe("0-based index of the document in the request"),
    page: z.number().int().min(1).describe("1-based page number within that document"),
    snippet: z.string().max(200).describe("Short verbatim text supporting the value"),
  })
  .strict();

export const RecurringDebitSchema = z
  .object({
    descriptor: z.string().describe("ACH/withdrawal descriptor exactly as printed"),
    amount: z.number().describe("Typical amount per occurrence"),
    frequency: z.enum(["daily", "weekly", "biweekly", "monthly", "irregular"]),
    occurrences: z.number().int().min(1),
    firstDate: z.string().describe("YYYY-MM-DD"),
    lastDate: z.string().describe("YYYY-MM-DD"),
    looksLikeFinancing: z
      .boolean()
      .describe("True if this looks like an MCA/loan payment (lender-like payee, fixed cadence)"),
  })
  .strict();

export const MonthlyRowSchema = z
  .object({
    month: z.string().regex(/^\d{4}-\d{2}$/, "YYYY-MM"),
    bankName: z.string().nullable(),
    accountLast4: z.string().nullable(),
    beginningBalance: z.number(),
    endingBalance: z.number(),
    totalDeposits: z.number().min(0),
    depositCount: z.number().int().min(0),
    totalWithdrawals: z.number().min(0),
    nonRevenueDeposits: z
      .number()
      .min(0)
      .describe(
        "Deposits that are not sales revenue: transfers in, loan/MCA proceeds, owner injections, refunds",
      ),
    nonRevenueDepositNotes: z
      .array(z.string())
      .describe("One line per excluded deposit, with amount"),
    averageDailyBalance: z.number(),
    nsfCount: z.number().int().min(0).describe("Returned-item / insufficient-funds events"),
    overdraftFeeCount: z.number().int().min(0),
    negativeDays: z.number().int().min(0),
    minDailyBalance: z.number(),
    isComplete: z
      .boolean()
      .describe("False if pages are missing or the statement does not cover the full month"),
    recurringDebits: z.array(RecurringDebitSchema),
    evidence: z.array(EvidenceSchema).max(10),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const DocumentClassificationSchema = z
  .object({
    documentIndex: z.number().int().min(0),
    type: z.enum([
      "BANK_STATEMENT",
      "APPLICATION",
      "VOIDED_CHECK",
      "DRIVERS_LICENSE",
      "TAX_RETURN",
      "PROFIT_AND_LOSS",
      "AR_AGING",
      "PROCESSING_STATEMENT",
      "MTD_STATEMENT",
      "OTHER",
    ]),
    pageCount: z.number().int().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

/** Output of AI job A1. */
export const StatementExtractionSchema = z
  .object({
    documents: z.array(DocumentClassificationSchema),
    months: z.array(MonthlyRowSchema),
    warnings: z
      .array(z.string())
      .describe(
        "Anything a processor must look at: gaps between months, mixed accounts, unreadable pages",
      ),
  })
  .strict();

export type MonthlyRow = z.infer<typeof MonthlyRowSchema>;
export type StatementExtraction = z.infer<typeof StatementExtractionSchema>;
export type RecurringDebit = z.infer<typeof RecurringDebitSchema>;
