import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { formatSignedAt, renderApplicationPdf } from "./application";
import { imagesToPdf } from "./images";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const sections = [
  {
    heading: "Business",
    fields: [
      ["Legal name", "Panadería Muñoz LLC"],
      ["DBA", null],
      ["Address", "12 Main St, Miami, FL 33101"],
    ] as [string, string | null][],
  },
];

describe("renderApplicationPdf", () => {
  it("renders an unsigned preview and a signed copy with Spanish characters", async () => {
    const preview = await renderApplicationPdf({
      brand: "Ascend Fund",
      title: "Business Funding Application",
      sections,
      consentText: "By signing I authorize… “Ascend Fund” to obtain credit reports.",
      note: "Preview - not signed yet",
    });
    const signed = await renderApplicationPdf({
      brand: "Ascend Fund",
      title: "Business Funding Application",
      sections: Array.from({ length: 8 }, () => sections[0]!),
      consentText: "Consent ".repeat(200),
      signature: {
        name: "José Muñoz",
        signedAt: new Date("2026-10-08T19:14:00Z"),
        via: "WhatsApp +1 ••• ••• 0123",
        ref: "sig_1",
      },
    });
    expect((await PDFDocument.load(preview)).getTitle()).toBe(
      "Ascend Fund - Business Funding Application",
    );
    expect((await PDFDocument.load(signed)).getPageCount()).toBeGreaterThan(1);
    expect(signed.equals(preview)).toBe(false);
  });

  it("formats the signing time in New York time", () => {
    expect(formatSignedAt(new Date("2026-10-08T19:14:00Z"))).toBe("Oct 8, 2026, 3:14 PM ET");
  });
});

describe("imagesToPdf", () => {
  it("makes one page per photo", async () => {
    const pdf = await imagesToPdf([
      { mimeType: "image/png", data: PNG },
      { mimeType: "image/png", data: PNG },
    ]);
    expect((await PDFDocument.load(pdf)).getPageCount()).toBe(2);
    await expect(imagesToPdf([])).rejects.toThrow();
  });
});
