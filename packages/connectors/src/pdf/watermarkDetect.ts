import { getDocumentProxy, getResolvedPDFJS } from "unpdf";

/**
 * Finds a watermark stamped onto a PDF (e.g. a bank statement run through an online converter
 * that adds its mark): either a see-through layer drawn over every page, or large tilted text
 * repeated across the pages. A statement straight from the bank has neither.
 */
export interface WatermarkCheck {
  watermarked: boolean;
  reason: string | null;
}

/** Fill or stroke opacity at or below this is a see-through layer. */
const SEE_THROUGH = 0.6;

export async function detectWatermark(data: Uint8Array, maxPages = 10): Promise<WatermarkCheck> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(data));
  } catch {
    return { watermarked: false, reason: null };
  }
  try {
    const { OPS: OP } = await getResolvedPDFJS();
    const DRAW = new Set<number>([
      OP.constructPath,
      OP.showText,
      OP.showSpacedText,
      OP.paintImageXObject,
      OP.paintInlineImageXObject,
      OP.paintImageMaskXObject,
    ]);
    const pages = Math.min(pdf.numPages, maxPages);
    let overlay = 0;
    let tilted = 0;
    for (let p = 1; p <= pages; p++) {
      const page = await pdf.getPage(p);
      const { fnArray, argsArray } = await page.getOperatorList();
      // Opacity in force (graphics state stack), and drawing done while it is see-through.
      const stack: number[] = [];
      let alpha = 1;
      let seeThroughDraws = 0;
      fnArray.forEach((fn, i) => {
        if (fn === OP.save) stack.push(alpha);
        else if (fn === OP.restore) alpha = stack.pop() ?? 1;
        else if (fn === OP.setGState) {
          for (const [key, value] of (argsArray[i]?.[0] ?? []) as [string, unknown][]) {
            if ((key === "ca" || key === "CA") && typeof value === "number") {
              alpha = Math.min(key === "ca" ? value : alpha, value);
            }
          }
        } else if (DRAW.has(fn) && alpha <= SEE_THROUGH) seeThroughDraws++;
      });
      if (seeThroughDraws >= 5) overlay++;

      const { items } = await page.getTextContent();
      const big = items.some((it) => {
        if (!("str" in it) || !it.str.trim()) return false;
        const [a, b] = it.transform as number[];
        const angle = Math.abs((Math.atan2(b!, a!) * 180) / Math.PI);
        const size = Math.hypot(a!, b!);
        return angle >= 15 && angle <= 75 && size >= 18;
      });
      if (big) tilted++;
    }
    // On most pages: a one-off transparent logo is not a watermark.
    const most = Math.max(1, Math.ceil(pages * 0.6));
    if (overlay >= most) {
      return {
        watermarked: true,
        reason: "A see-through stamp is drawn over the pages (watermark).",
      };
    }
    if (tilted >= most) {
      return {
        watermarked: true,
        reason: "Large tilted text is stamped across the pages (watermark).",
      };
    }
    return { watermarked: false, reason: null };
  } catch {
    return { watermarked: false, reason: null };
  } finally {
    await pdf.cleanup();
  }
}
