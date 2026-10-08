import { PDFDocument } from "pdf-lib";

/**
 * Photos of an application's pages (JPG/PNG, e.g. sent on WhatsApp) → one PDF, one page per
 * photo in the order given, so the PDF readers (A5) can take them in a single call.
 */
export async function imagesToPdf(images: { mimeType: string; data: Buffer }[]): Promise<Buffer> {
  if (images.length === 0) throw new Error("no images");
  const doc = await PDFDocument.create();
  for (const im of images) {
    const img = /png$/i.test(im.mimeType)
      ? await doc.embedPng(im.data)
      : await doc.embedJpg(im.data);
    // Letter width, keep the photo's aspect ratio.
    const w = 612;
    const h = Math.round((img.height / img.width) * w);
    doc.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
  }
  return Buffer.from(await doc.save());
}
