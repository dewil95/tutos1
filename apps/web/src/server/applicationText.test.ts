import { renderApplicationPdf } from "@mca/connectors";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { applicationSections } from "./ascendApplication";
import { isoDate, money, readApplicationText, stateCode } from "./applicationText";

/**
 * Another company's form, laid out like the real ones: two columns of labels with their values
 * right-aligned beside them, a long name wrapped around its label, and a second address block
 * in the owner column. Synthetic data only.
 */
async function otherCompanyForm(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 842]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const at = (s: string, x: number, y: number, size = 9) => page.drawText(s, { x, y, size, font });
  const right = (s: string, xr: number, y: number) => at(s, xr - font.widthOfTextAtSize(s, 9), y);
  at("Sample Funding Co Funding Application", 120, 810, 16);
  at("BUSINESS INFORMATION", 55, 728);
  const biz: [string, string | string[]][] = [
    ["Legal Company Name", ["SAMPLE KIDS DAYCARE", "CENTER INC."]],
    ["Doing Business As", ""],
    ["Company Website", ""],
    ["Tax ID / EIN", "12-3456789"],
    ["Business Start Date", "07/16/2015"],
    ["State of Incorporation", "Puerto Rico"],
    ["Industry", "Educational Services"],
    ["Address", "1 TEST STREET"],
    ["City", "SAN JUAN"],
    ["State", "Puerto Rico"],
    ["Zip", "00926"],
    ["Financing Amount", "$55,000"],
  ];
  let y = 696;
  for (const [label, value] of biz) {
    at(label, 55, y);
    if (Array.isArray(value)) {
      right(value[0]!, 280, y + 6);
      right(value[1]!, 280, y - 5);
    } else if (value) right(value, 280, y);
    y -= 16;
  }
  at("OWNER INFORMATION", 314, 728);
  const owner: [string, string][] = [
    ["Full Name", "TEST SAMPLE"],
    ["Ownership %", "100%"],
    ["Social Security Number", "123-45-6789"],
    ["FICO Score", "620"],
    ["Address Line 1", "2 HOME AVE"],
    ["Address Line 2", ""],
    ["City", "SAN JUAN"],
    ["State", "Puerto Rico"],
    ["Zip", "00927"],
    ["Date Of Birth", "06/30/1977"],
    ["Address Line 1", "1 TEST STREET"],
    ["City", "CAROLINA"],
  ];
  y = 702;
  for (const [label, value] of owner) {
    at(label, 314, y);
    if (value) right(value, 538, y);
    y -= 16;
  }
  at("TERMS OF USE", 55, 400);
  at(
    "By signing below, each of the above listed business and owner authorize the lender.",
    55,
    383,
  );
  return doc.save();
}

describe("reading an application PDF by its labels", () => {
  it("reads another company's two-column form", async () => {
    const r = (await readApplicationText(await otherCompanyForm()))!;
    expect(r).not.toBeNull();
    expect(r.business).toMatchObject({
      legalName: "SAMPLE KIDS DAYCARE CENTER INC.",
      entityType: "CORP",
      ein: "12-3456789",
      startDate: "2015-07-16",
      industry: "Educational Services",
      addressLine1: "1 TEST STREET",
      city: "SAN JUAN",
      state: "PR",
      postalCode: "00926",
    });
    expect(r.request.requestedAmount).toBe(55000);
    expect(r.owners).toHaveLength(1);
    // The first address in the owner column is the home address; the second block is ignored.
    expect(r.owners[0]).toMatchObject({
      firstName: "TEST",
      lastName: "SAMPLE",
      ownershipPct: 100,
      ssn: "123-45-6789",
      dob: "1977-06-30",
      creditScoreStated: 620,
      addressLine1: "2 HOME AVE",
      city: "SAN JUAN",
      state: "PR",
      postalCode: "00927",
    });
  });

  it("reads back Ascend's own application", async () => {
    const draft = {
      business: {
        legalName: "TEST Sample Grill LLC",
        entityType: "LLC" as const,
        ein: "98-7654321",
        startDate: "2019-03-01",
        industry: "Restaurant / Food Service",
        address: { line1: "1 Test St", city: "Miami", state: "FL", postalCode: "33101" },
      },
      request: { amount: 30000, monthlyRevenue: 52000 },
      owners: [
        {
          firstName: "Test",
          lastName: "Sample",
          ownershipPct: 100,
          address: { line1: "2 Home Ave", city: "Miami", state: "FL", postalCode: "33102" },
        },
      ],
    };
    const pdf = await renderApplicationPdf({
      brand: "Ascend Fund",
      title: "Funding Application",
      sections: applicationSections(draft, [{ ssn: "123-45-6789", dob: "1980-01-01" }], {
        masked: false,
      }),
      consentText: "By submitting this application, the above listed business authorizes us.",
    });
    const r = (await readApplicationText(new Uint8Array(pdf)))!;
    expect(r.business).toMatchObject({
      legalName: "TEST Sample Grill LLC",
      entityType: "LLC",
      ein: "98-7654321",
      startDate: "2019-03-01",
      addressLine1: "1 Test St",
      state: "FL",
    });
    expect(r.request).toMatchObject({ requestedAmount: 30000, statedMonthlyRevenue: 52000 });
    expect(r.owners[0]).toMatchObject({
      firstName: "Test",
      lastName: "Sample",
      ssn: "123-45-6789",
      dob: "1980-01-01",
      addressLine1: "2 Home Ave",
      postalCode: "33102",
    });
  });

  it("returns null for a document that is not an application", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage().drawText("Bank statement - Ending balance $1,234.56", { x: 50, y: 700, font });
    expect(await readApplicationText(await doc.save())).toBeNull();
    expect(await readApplicationText(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("normalizes states, dates and amounts", () => {
    expect(stateCode("Puerto Rico")).toBe("PR");
    expect(stateCode("fl")).toBe("FL");
    expect(stateCode("Atlantis")).toBeNull();
    expect(isoDate("7/4/21")).toBe("2021-07-04");
    expect(isoDate("13/01/2020")).toBeNull();
    expect(money("$10,001 - $25,000", "high")).toBe(25000);
    expect(money("$10,001 - $25,000", "low")).toBe(10001);
    expect(money("50k", "high")).toBe(50000);
  });
});
