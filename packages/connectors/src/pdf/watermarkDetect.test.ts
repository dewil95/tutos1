import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { detectWatermark } from "./watermarkDetect";

/** A plain statement-like PDF, optionally stamped. Synthetic content only. */
async function statement(
  pages: number,
  stamp?: { kind: "overlay" | "tilted" | "logo-first-page" },
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let p = 0; p < pages; p++) {
    const page = doc.addPage([612, 792]);
    for (let i = 0; i < 20; i++) {
      page.drawText(`10/${String(i + 1).padStart(2, "0")}  DEPOSIT  $1,000.00`, {
        x: 50,
        y: 700 - i * 20,
        size: 9,
        font,
      });
    }
    if (stamp?.kind === "overlay") {
      // A converter's mark: shapes drawn at 15% opacity over the whole page.
      for (let i = 0; i < 8; i++) {
        page.drawRectangle({
          x: 60 + i * 60,
          y: 300,
          width: 40,
          height: 40,
          color: rgb(0.5, 0.5, 0.5),
          opacity: 0.15,
        });
      }
    }
    if (stamp?.kind === "tilted") {
      page.drawText("COPY", { x: 150, y: 300, size: 72, font, rotate: degrees(45) });
    }
    if (stamp?.kind === "logo-first-page" && p === 0) {
      for (let i = 0; i < 6; i++) {
        page.drawCircle({ x: 500 + i, y: 750, size: 10, color: rgb(0, 0, 1), opacity: 0.4 });
      }
    }
  }
  return doc.save();
}

describe("detectWatermark", () => {
  it("passes a clean statement", async () => {
    expect(await detectWatermark(await statement(3))).toEqual({ watermarked: false, reason: null });
  });

  it("finds a see-through stamp drawn over every page", async () => {
    const r = await detectWatermark(await statement(3, { kind: "overlay" }));
    expect(r.watermarked).toBe(true);
    expect(r.reason).toMatch(/see-through/);
  });

  it("finds large tilted text stamped across the pages", async () => {
    const r = await detectWatermark(await statement(2, { kind: "tilted" }));
    expect(r.watermarked).toBe(true);
    expect(r.reason).toMatch(/tilted/);
  });

  it("does not flag a transparent logo on the first page only", async () => {
    expect(
      (await detectWatermark(await statement(4, { kind: "logo-first-page" }))).watermarked,
    ).toBe(false);
  });

  it("does not throw on a file that is not a PDF", async () => {
    expect(await detectWatermark(new Uint8Array([1, 2, 3]))).toEqual({
      watermarked: false,
      reason: null,
    });
  });
});
