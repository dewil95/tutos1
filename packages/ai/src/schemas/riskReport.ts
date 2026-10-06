import { z } from "zod";

/**
 * Narrative half of the internal AI Risk Report. Scores, metrics and amounts are computed in code
 * and passed in; the model explains them, names the risks and drafts questions. Never sent to
 * lenders or merchants.
 */
export const RiskNarrativeSchema = z
  .object({
    headline: z.string().max(160).describe("One line a closer can read in 3 seconds"),
    summary: z.string().max(900).describe("4-6 sentences for the team, factual"),
    topRisks: z
      .array(
        z
          .object({
            title: z.string().max(80),
            detail: z.string().max(300).describe("Cite the number from the facts"),
            severity: z.enum(["low", "medium", "high"]),
          })
          .strict(),
      )
      .max(6),
    mitigants: z.array(z.string().max(200)).max(5).describe("Strengths that offset the risks"),
    questionsForMerchant: z.array(z.string().max(200)).max(6),
    lenderStrategy: z
      .string()
      .max(500)
      .describe("Which kind of lenders to send to first and why, using the ranked list given"),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type RiskNarrative = z.infer<typeof RiskNarrativeSchema>;
