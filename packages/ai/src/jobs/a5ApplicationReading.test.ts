import type { GenerateContentResponse } from "@google/genai";
import { describe, expect, it, vi } from "vitest";
import type { AiRunRecord } from "../llm";
import { GeminiClient, type GeminiSdk } from "../providers/gemini";
import {
  ApplicationReadingSchema,
  maskApplication,
  type ApplicationReading,
} from "../schemas/application";
import { runApplicationReading } from "./a5ApplicationReading";

// Synthetic application (no real person).
const reading: ApplicationReading = {
  isApplication: true,
  business: {
    legalName: "Sample Bistro LLC",
    dba: "Sample Bistro",
    entityType: "LLC",
    ein: "12-3456789",
    startDate: "2021-04-01",
    industry: "Restaurant",
    naics: null,
    phone: "305-555-0100",
    email: "owner@samplebistro.test",
    website: null,
    addressLine1: "1 Main St",
    city: "Miami",
    state: "FL",
    postalCode: "33101",
  },
  request: {
    requestedAmount: 25000,
    useOfFunds: "Inventory",
    statedMonthlyRevenue: 60000,
    existingAdvances: [{ lender: "Sample Capital", balance: 9000 }],
  },
  owners: [
    {
      firstName: "Pat",
      lastName: "Example",
      ownershipPct: 100,
      ssn: "123-45-6789",
      dob: "1980-02-03",
      email: null,
      phone: null,
      addressLine1: null,
      city: null,
      state: "FL",
      postalCode: null,
      creditScoreStated: null,
    },
  ],
  signed: true,
  signatureDate: "2026-10-01",
  lowConfidenceFields: [],
  confidence: 0.92,
};

describe("A5 application reading", () => {
  it("returns full values to the caller but logs only masked SSN, DOB and EIN", async () => {
    const text = JSON.stringify(reading);
    const generate = vi.fn().mockResolvedValue({
      text,
      modelVersion: "gemini-3.1-pro-preview",
      candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
      usageMetadata: { promptTokenCount: 3000, candidatesTokenCount: 400 },
    } as unknown as GenerateContentResponse);
    const records: AiRunRecord[] = [];
    const client = new GeminiClient({
      ai: {
        models: { generateContent: generate },
        files: { upload: vi.fn(), get: vi.fn() },
      } as unknown as GeminiSdk,
      sink: (r) => void records.push(r),
    });

    const res = await runApplicationReading(client, {
      file: { data: Buffer.from("%PDF-1.4"), fileName: "app.pdf" },
    });

    expect(res.data.owners[0]!.ssn).toBe("123-45-6789");
    const logged = JSON.stringify(records[0]!.output);
    expect(logged).not.toContain("123-45-6789");
    expect(logged).not.toContain("1980-02-03");
    expect(logged).not.toContain("12-3456789");
    expect(logged).toContain("***-**-6789");
    // The PDF went to Gemini inline.
    const parts = generate.mock.calls[0]![0].contents[0].parts as {
      inlineData?: { mimeType: string };
    }[];
    expect(parts.some((p) => p.inlineData?.mimeType === "application/pdf")).toBe(true);
  });

  it("masks consistently and keeps the schema valid", () => {
    const m = maskApplication(reading);
    expect(m.owners[0]!.dob).toBe("1980-**-**");
    expect(m.business.ein).toBe("**-***6789");
    expect(ApplicationReadingSchema.safeParse(m).success).toBe(true);
  });
});
