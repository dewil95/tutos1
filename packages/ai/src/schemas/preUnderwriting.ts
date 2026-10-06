import { z } from "zod";

/** Output of AI job A3. The deterministic grade from @mca/domain is an input; Claude may disagree. */
export const PreUnderwritingSchema = z
  .object({
    suggestedGrade: z.enum(["A", "B", "C", "D"]),
    agreesWithRuleGrade: z.boolean(),
    gradeRationale: z.string().max(800),
    redFlags: z.array(
      z
        .object({
          flag: z.string(),
          severity: z.enum(["info", "warning", "critical"]),
          evidence: z.string().max(200),
        })
        .strict(),
    ),
    strengths: z.array(z.string()).max(8),
    maxAdvanceEstimate: z
      .object({ low: z.number().min(0), high: z.number().min(0), rationale: z.string().max(300) })
      .strict(),
    likelyOfferTerms: z
      .object({
        factorLow: z.number().min(1),
        factorHigh: z.number().min(1),
        termMonthsLow: z.number().min(1),
        termMonthsHigh: z.number().min(1),
        frequency: z.enum(["DAILY", "WEEKLY"]),
      })
      .strict(),
    recommendedNextSteps: z.array(z.string()).max(6),
    questionsForMerchant: z.array(z.string()).max(6),
    processorSummary: z
      .string()
      .max(1200)
      .describe("Plain-English summary a processor can paste into the submission email"),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type PreUnderwriting = z.infer<typeof PreUnderwritingSchema>;
