import { z } from "zod";

/**
 * Output of the WhatsApp answer reader: one merchant reply turned into the value of the field
 * the bot asked for. Only the slot that matches the field's kind is read; the rest stay null.
 */
export const ChatAnswerSchema = z
  .object({
    understood: z
      .boolean()
      .describe("False if the reply does not answer the question or is ambiguous"),
    text: z.string().nullable().describe("Plain text answer (names, industry, use of funds)"),
    number: z.number().nullable().describe("Money or percent as a plain number; '40k' = 40000"),
    date: z.string().nullable().describe("YYYY-MM-DD; month only → first day of that month"),
    address: z
      .object({
        line1: z.string().nullable(),
        city: z.string().nullable(),
        state: z.string().nullable().describe("2-letter US state code"),
        postalCode: z.string().nullable(),
      })
      .strict()
      .nullable(),
    advances: z
      .array(z.object({ lender: z.string(), balance: z.number().nullable() }).strict())
      .nullable()
      .describe("Open advances/loans listed; empty array when the merchant says none"),
  })
  .strict();

export type ChatAnswer = z.infer<typeof ChatAnswerSchema>;
