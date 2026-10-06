import { z } from "zod";

/**
 * Output of AI job A5: read a merchant cash advance application (Ascend's own form or another
 * broker's) into CRM fields. Every field is nullable: missing or illegible means null, never a
 * guess. SSN and DOB are extracted only so the server can encrypt them; logs get a masked copy.
 */
const str = () => z.string().nullable();

export const ApplicationOwnerSchema = z
  .object({
    firstName: str(),
    lastName: str(),
    ownershipPct: z.number().min(0).max(100).nullable(),
    ssn: str().describe("9 digits as written, e.g. 123-45-6789"),
    dob: str().describe("YYYY-MM-DD"),
    email: str(),
    phone: str(),
    addressLine1: str(),
    city: str(),
    state: str().describe("2-letter code"),
    postalCode: str(),
    creditScoreStated: z.number().int().min(300).max(850).nullable(),
  })
  .strict();

export const ApplicationReadingSchema = z
  .object({
    isApplication: z
      .boolean()
      .describe("False if the document is not a funding application (e.g. a bank statement)"),
    business: z
      .object({
        legalName: str(),
        dba: str(),
        entityType: z
          .enum(["LLC", "CORP", "S_CORP", "SOLE_PROP", "PARTNERSHIP", "NONPROFIT", "OTHER"])
          .nullable(),
        ein: str().describe("As written, e.g. 12-3456789"),
        startDate: str().describe("Business start date YYYY-MM-DD (YYYY-MM-01 if only month)"),
        industry: str().describe("Plain words, e.g. 'Restaurant', 'Trucking'"),
        naics: str(),
        phone: str(),
        email: str(),
        website: str(),
        addressLine1: str(),
        city: str(),
        state: str().describe("2-letter code"),
        postalCode: str(),
      })
      .strict(),
    request: z
      .object({
        requestedAmount: z.number().min(0).nullable(),
        useOfFunds: str(),
        statedMonthlyRevenue: z.number().min(0).nullable(),
        existingAdvances: z
          .array(z.object({ lender: z.string(), balance: z.number().nullable() }).strict())
          .describe("Open advances/loans the merchant listed"),
      })
      .strict(),
    owners: z.array(ApplicationOwnerSchema).max(4),
    signed: z.boolean().describe("A signature is present on the signature line"),
    signatureDate: str().describe("YYYY-MM-DD"),
    lowConfidenceFields: z
      .array(z.string())
      .describe("Dotted paths of fields that were hard to read, e.g. owners.0.ssn"),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type ApplicationReading = z.infer<typeof ApplicationReadingSchema>;
export type ApplicationOwner = z.infer<typeof ApplicationOwnerSchema>;

const last4 = (v: string | null) => {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length >= 4 ? d.slice(-4) : null;
};

/** Copy safe for logs and the deal page: SSN → last 4, DOB → year only, EIN → last 4. */
export function maskApplication(a: ApplicationReading): ApplicationReading {
  return {
    ...a,
    business: {
      ...a.business,
      ein: a.business.ein ? `**-***${last4(a.business.ein) ?? ""}` : null,
    },
    owners: a.owners.map((o) => ({
      ...o,
      ssn: o.ssn ? `***-**-${last4(o.ssn) ?? "????"}` : null,
      dob: o.dob ? `${o.dob.slice(0, 4)}-**-**` : null,
    })),
  };
}
