import { getDocumentProxy } from "unpdf";

/** A run of text on a PDF page: position (PDF points, origin bottom-left) and width. */
export interface PdfTextItem {
  page: number;
  x: number;
  y: number;
  width: number;
  text: string;
}

/**
 * The text of a digital PDF with where each piece sits, for reading forms by their labels.
 * A scanned PDF (only images) returns no items.
 */
export async function pdfTextItems(data: Uint8Array, maxPages = 6): Promise<PdfTextItem[]> {
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const out: PdfTextItem[] = [];
  try {
    for (let p = 1; p <= Math.min(pdf.numPages, maxPages); p++) {
      const page = await pdf.getPage(p);
      const { items } = await page.getTextContent();
      for (const it of items) {
        if (!("str" in it) || !it.str.trim()) continue;
        out.push({
          page: p,
          x: it.transform[4] as number,
          y: it.transform[5] as number,
          width: it.width,
          text: it.str.replace(/\s+/g, " ").trim(),
        });
      }
    }
  } finally {
    await pdf.cleanup();
  }
  return out;
}
