import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { newWatermarkTag, readWatermarkTag, watermarkAttachment, watermarkText } from "./watermark";

async function samplePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++)
    doc.addPage([612, 792]).drawText(`Statement page ${i + 1}`, { x: 50, y: 700 });
  return Buffer.from(await doc.save());
}

// 1x1 transparent PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const info = {
  brokerName: "Ascend Fund",
  lenderName: "Mazal Funders",
  tag: "K7QH3MZP",
  date: new Date("2026-10-06"),
};

describe("watermark", () => {
  it("makes short tags without look-alike characters", () => {
    const t = newWatermarkTag();
    expect(t).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
    expect(newWatermarkTag()).not.toBe(t);
  });

  it("stamps every page and records the tag in the metadata", async () => {
    const r = await watermarkAttachment(
      { fileName: "Chase June.pdf", mimeType: "application/pdf", data: await samplePdf(3) },
      info,
    );
    expect(r.stamped).toBe(true);
    const out = await PDFDocument.load(r.attachment.data);
    expect(out.getPageCount()).toBe(3);
    expect(await readWatermarkTag(r.attachment.data)).toBe("K7QH3MZP");
    expect(out.getSubject()).toBe("Ascend Fund submission to Mazal Funders");
    // Each page's content stream grew by the footer.
    const original = await PDFDocument.load(await samplePdf(3));
    expect(out.getPage(2).node.Contents()).not.toEqual(original.getPage(2).node.Contents());
  });

  it("gives two lenders two different tags for the same file", async () => {
    const data = await samplePdf(1);
    const a = await watermarkAttachment(
      { fileName: "app.pdf", mimeType: "application/pdf", data },
      info,
    );
    const b = await watermarkAttachment(
      { fileName: "app.pdf", mimeType: "application/pdf", data },
      { ...info, lenderName: "Zlur", tag: "ZZZZ2222" },
    );
    expect(await readWatermarkTag(a.attachment.data)).toBe("K7QH3MZP");
    expect(await readWatermarkTag(b.attachment.data)).toBe("ZZZZ2222");
  });

  it("wraps photos (DL, voided check) into a stamped one-page PDF", async () => {
    const r = await watermarkAttachment(
      { fileName: "voided check.png", mimeType: "image/png", data: PNG },
      info,
    );
    expect(r.stamped).toBe(true);
    expect(r.attachment.fileName).toBe("voided check.pdf");
    expect(r.attachment.mimeType).toBe("application/pdf");
    expect((await PDFDocument.load(r.attachment.data)).getPageCount()).toBe(1);
  });

  it("passes through files it cannot stamp", async () => {
    const docx = {
      fileName: "MTD.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      data: Buffer.from("x"),
    };
    expect(await watermarkAttachment(docx, info)).toMatchObject({
      stamped: false,
      attachment: docx,
    });
    const broken = {
      fileName: "bad.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("not a pdf"),
    };
    expect(await watermarkAttachment(broken, info)).toMatchObject({
      stamped: false,
      skippedReason: "unreadable PDF",
    });
  });

  it("keeps footer text printable with standard fonts", () => {
    expect(watermarkText({ ...info, lenderName: "Fundación Ñ" })).toContain("Fundaci?n ?");
  });
});
