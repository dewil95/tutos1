import { z } from "zod";

export const DetectedPositionSchema = z
  .object({
    descriptor: z.string(),
    funderGuess: z
      .string()
      .nullable()
      .describe(
        "Funder name if the descriptor matches the dictionary or is otherwise recognisable",
      ),
    frequency: z.enum(["daily", "weekly", "biweekly", "monthly"]),
    paymentAmount: z.number().min(0),
    firstSeen: z.string().describe("YYYY-MM-DD"),
    lastSeen: z.string().describe("YYYY-MM-DD"),
    isActive: z.boolean().describe("Still debiting in the most recent month"),
    estimatedRemainingBalance: z.number().min(0).nullable(),
    estimateRationale: z.string(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

/** Output of AI job A2. */
export const PositionDetectionSchema = z
  .object({
    positions: z.array(DetectedPositionSchema),
    activePositionCount: z.number().int().min(0),
    totalDailyEquivalentPayment: z
      .number()
      .min(0)
      .describe("Sum of active payments normalised to a per-business-day figure"),
    notes: z.array(z.string()),
  })
  .strict();

export type PositionDetection = z.infer<typeof PositionDetectionSchema>;
export type DetectedPosition = z.infer<typeof DetectedPositionSchema>;
