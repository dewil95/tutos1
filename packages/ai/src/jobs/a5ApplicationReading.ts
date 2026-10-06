import { pdfBlock, textBlock, type LlmClient, type StructuredCallResult } from "../llm";
import {
  ApplicationReadingSchema,
  maskApplication,
  type ApplicationReading,
} from "../schemas/application";

export const A5_PROMPT_VERSION = "a5.v1";

export const A5_SYSTEM = `You read merchant cash advance (MCA) funding applications for a broker and copy their fields into JSON per the schema. The application may be the broker's own web form exported to PDF, a scanned paper form, or a photo.

Rules:
- Copy values exactly as written; normalise only formats: dates to YYYY-MM-DD, states to 2-letter codes, money to plain numbers (strip $ and commas; "35k" = 35000).
- A field that is blank, illegible or not on the form is null. Never infer an SSN, EIN, date of birth or address from anything else.
- Owners: one entry per owner/guarantor listed, in the order shown. ownershipPct as a number (e.g. 51).
- existingAdvances: only open advances/loans the applicant listed on the form.
- signed = true only if a signature mark is visible on a signature line.
- List the dotted paths of anything you were unsure about in lowConfidenceFields.
- If the document is not an application at all, set isApplication=false and leave the rest null/empty.`;

export interface A5Input {
  file: { data: Buffer; fileName: string };
  tenantId?: string;
  dealId?: string;
}

export async function runApplicationReading(
  client: LlmClient,
  input: A5Input,
): Promise<StructuredCallResult<ApplicationReading>> {
  return client.structured({
    job: "A5_APPLICATION_OCR",
    promptVersion: A5_PROMPT_VERSION,
    system: A5_SYSTEM,
    user: [pdfBlock(input.file.data, input.file.fileName), textBlock("Read this application.")],
    schema: ApplicationReadingSchema,
    tier: "primary",
    effort: "medium",
    maxTokens: 8_000,
    tenantId: input.tenantId,
    dealId: input.dealId,
    // SSN / DOB / EIN never reach the AiRun table in clear text.
    redactForLog: maskApplication,
  });
}
