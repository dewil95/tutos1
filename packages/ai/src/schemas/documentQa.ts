import { z } from "zod";

/** Output of AI job A4: visual integrity check of one bank statement PDF. */
export const DocumentQaSchema = z
  .object({
    findings: z
      .array(
        z
          .object({
            issue: z.enum([
              "FONT_MISMATCH",
              "MISALIGNED_COLUMNS",
              "MATH_ERROR",
              "MISSING_PAGES",
              "INCONSISTENT_DATES",
              "EDIT_ARTIFACTS",
              "NOT_A_BANK_STATEMENT",
              "OTHER",
            ]),
            severity: z.enum(["info", "warning", "critical"]),
            page: z.number().int().min(1).nullable(),
            evidence: z.string().max(240).describe("What exactly looks wrong, quoting the figures"),
          })
          .strict(),
      )
      .max(10),
    looksAuthentic: z.boolean(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type DocumentQa = z.infer<typeof DocumentQaSchema>;
