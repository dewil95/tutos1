import { textBlock, type LlmClient, type StructuredCallResult } from "../llm";
import { ChatAnswerSchema, type ChatAnswer } from "../schemas/chatAnswer";

export const CHAT_ANSWER_PROMPT_VERSION = "wa.v1";

export const CHAT_ANSWER_SYSTEM = `A merchant is filling in a business funding application by chatting on WhatsApp, in English or Spanish. You get the question the bot asked, the kind of value expected, and the merchant's reply. Return that value in the matching slot of the schema.

Rules:
- Copy names and words as written; fix only obvious capitalisation.
- Money: plain numbers ("40k" = 40000, "1.2 million" = 1200000, "$35,000" = 35000).
- Dates: YYYY-MM-DD; "March 2019" = 2019-03-01; "since 2018" = 2018-01-01.
- Address: split into line1, city, 2-letter state, ZIP.
- Advances: one entry per lender named with its balance if given; "none" / "no" / "ninguno" = empty list.
- Never invent a value. If the reply is a question, off-topic or unclear, set understood=false.`;

export type ChatAnswerKind = "text" | "number" | "date" | "address" | "advances";

export async function runChatAnswer(
  client: LlmClient,
  input: {
    question: string;
    kind: ChatAnswerKind;
    reply: string;
    tenantId?: string;
    dealId?: string;
  },
): Promise<StructuredCallResult<ChatAnswer>> {
  return client.structured({
    job: "WHATSAPP_ANSWER",
    promptVersion: CHAT_ANSWER_PROMPT_VERSION,
    system: CHAT_ANSWER_SYSTEM,
    user: [
      textBlock(
        `Question: ${input.question}\nExpected kind: ${input.kind}\nMerchant's reply: ${input.reply}`,
      ),
    ],
    schema: ChatAnswerSchema,
    tier: "fast",
    effort: "low",
    maxTokens: 1_000,
    tenantId: input.tenantId,
    dealId: input.dealId,
  });
}
