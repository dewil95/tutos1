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

  it("puts the drawn signature in the signature box", async () => {
    const base = {
      brand: "Ascend Fund",
      tagline: "Business Capital",
      title: "Funding Application",
      intro: "Thank you for placing your trust in Ascend Fund Business Capital.",
      sections: [sections[0]!, { ...sections[0]!, heading: "Owner" }],
      consentText: "I authorize Ascend Fund to obtain credit reports.",
      contact: "786-565-0570 | www.ascendfund.co",
    };
    const sig = {
      name: "José Muñoz",
      signedAt: new Date("2026-10-08T19:14:00Z"),
      via: "online application, IP 192.0.2.1",
      ref: "sig_2",
    };
    const typed = await renderApplicationPdf({ ...base, signature: sig });
    const drawn = await renderApplicationPdf({ ...base, signature: { ...sig, image: PNG } });
    expect((await PDFDocument.load(drawn)).getPageCount()).toBe(1);
    // The drawn signature is embedded as an image; the typed one is not.
    expect(drawn.includes(Buffer.from("/Subtype /Image"))).toBe(true);
    expect(typed.includes(Buffer.from("/Subtype /Image"))).toBe(false);
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
