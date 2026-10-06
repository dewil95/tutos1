import { pdfBlock, textBlock, type LlmClient, type StructuredCallResult } from "../llm";
import { DocumentQaSchema, type DocumentQa } from "../schemas/documentQa";

export const A4_PROMPT_VERSION = "a4.v1";

export const A4_SYSTEM = `You check business bank statements for signs of editing before a broker sends them to funders. Look at the document as an image and as text. Report only concrete observations:
- FONT_MISMATCH: digits or words in a different font, size, weight or colour from neighbouring figures.
- MISALIGNED_COLUMNS: amounts shifted out of their column or baseline.
- MATH_ERROR: running balances that do not follow from the transactions, or summary totals that do not match the transactions.
- MISSING_PAGES: "page X of Y" gaps or cut-off transaction lists.
- INCONSISTENT_DATES: transactions outside the statement period, or out-of-order dates.
- EDIT_ARTIFACTS: white boxes, blurred patches, pasted blocks, different background.
- NOT_A_BANK_STATEMENT: the file is something else.
Quote the figures involved in evidence. If nothing looks wrong, return no findings and looksAuthentic=true. Never accuse; you are flagging items for a person to check against the original.`;

export async function runDocumentQa(
  client: LlmClient,
  input: { file: { data: Buffer; fileName: string }; tenantId?: string; dealId?: string },
): Promise<StructuredCallResult<DocumentQa>> {
  return client.structured({
    job: "A4_DOCUMENT_QA",
    promptVersion: A4_PROMPT_VERSION,
    system: A4_SYSTEM,
    user: [pdfBlock(input.file.data, input.file.fileName), textBlock("Check this statement.")],
    schema: DocumentQaSchema,
    tier: "fast",
    effort: "low",
    maxTokens: 4_000,
    tenantId: input.tenantId,
    dealId: input.dealId,
  });
}
