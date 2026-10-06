import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** Minimal text report → PDF (letter size), used for the internal Risk Report saved to Drive. */
export interface ReportSection {
  heading: string;
  /** Paragraphs and bullet lines ("- " prefix renders as a bullet). */
  lines?: string[];
  /** Simple table: first row is the header. */
  table?: string[][];
}

export interface ReportInput {
  title: string;
  subtitle?: string;
  /** Printed on every page, e.g. "INTERNAL - do not send to lenders". */
  footer?: string;
  sections: ReportSection[];
}

const ascii = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[→]/g, "->")
    .replace(/[≈]/g, "~")
    .replace(/[^\x20-\x7E]/g, "?");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of ascii(text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

export async function renderReportPdf(input: ReportInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(ascii(input.title));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 50;
  const ink = rgb(0.1, 0.12, 0.16);
  const muted = rgb(0.4, 0.42, 0.46);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const newPage = () => {
    page = doc.addPage([W, H]);
    y = H - M;
  };
  const need = (h: number) => {
    if (y - h < M + 20) newPage();
  };
  const text = (
    s: string,
    opts: { size?: number; f?: PDFFont; color?: typeof ink; x?: number; width?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    const f = opts.f ?? font;
    const x = opts.x ?? M;
    for (const l of wrap(s, f, size, opts.width ?? W - M - x)) {
      need(size + 4);
      page.drawText(l, { x, y: y - size, size, font: f, color: opts.color ?? ink });
      y -= size + 4;
    }
  };

  text(input.title, { size: 18, f: bold });
  if (input.subtitle) text(input.subtitle, { size: 10, color: muted });
  y -= 8;

  for (const s of input.sections) {
    need(40);
    y -= 6;
    text(s.heading, { size: 12, f: bold });
    y -= 2;
    for (const l of s.lines ?? []) {
      if (l.startsWith("- ")) {
        need(14);
        page.drawText("-", { x: M + 4, y: y - 10, size: 10, font, color: ink });
        text(l.slice(2), { x: M + 16 });
      } else text(l);
    }
    if (s.table?.length) {
      const cols = s.table[0]!.length;
      const colW = (W - 2 * M) / cols;
      s.table.forEach((row, i) => {
        need(14);
        row.forEach((cell, c) => {
          const f = i === 0 ? bold : font;
          let v = ascii(cell);
          while (v.length > 1 && f.widthOfTextAtSize(v, 9) > colW - 6) v = v.slice(0, -2) + "~";
          page.drawText(v, {
            x: M + c * colW,
            y: y - 9,
            size: 9,
            font: f,
            color: i === 0 ? muted : ink,
          });
        });
        y -= 13;
      });
    }
  }

  if (input.footer) {
    const pages = doc.getPages();
    pages.forEach((p, i) => {
      p.drawText(ascii(`${input.footer} - page ${i + 1} of ${pages.length}`), {
        x: M,
        y: 24,
        size: 8,
        font,
        color: muted,
      });
    });
  }
  return Buffer.from(await doc.save());
}
