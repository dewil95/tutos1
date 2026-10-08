import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Ascend's business funding application as a PDF, drawn from structured fields (WhatsApp
 * applications). The standard PDF fonts only cover Latin-1, which keeps Spanish names intact.
 */
export interface ApplicationPdfSection {
  heading: string;
  fields: [label: string, value: string | null][];
}

export interface ApplicationSignatureBlock {
  name: string;
  signedAt: Date;
  /** e.g. "WhatsApp +1 ••• ••• 0123" */
  via: string;
  ref: string;
}

export interface ApplicationPdfInput {
  brand: string;
  title: string;
  sections: ApplicationPdfSection[];
  /** Authorization the signer agrees to; printed above the signature. */
  consentText: string;
  /** Absent → unsigned preview with an empty signature line. */
  signature?: ApplicationSignatureBlock;
  /** Small print under the title, e.g. "Preview - not signed yet". */
  note?: string;
}

const latin1 = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/•/g, "*")
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, "?");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of latin1(text).split("\n")) {
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

export function formatSignedAt(d: Date): string {
  return (
    d.toLocaleString("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }) + " ET"
  );
}

export async function renderApplicationPdf(input: ApplicationPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(latin1(`${input.brand} - ${input.title}`));
  doc.setProducer(latin1(`${input.brand} CRM`));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 612;
  const H = 792;
  const M = 48;
  const ink = rgb(0.08, 0.1, 0.14);
  const muted = rgb(0.42, 0.44, 0.48);
  const rule = rgb(0.82, 0.84, 0.87);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const need = (h: number) => {
    if (y - h < M + 24) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  const write = (
    s: string,
    o: { size?: number; f?: PDFFont; color?: typeof ink; x?: number; w?: number } = {},
  ) => {
    const size = o.size ?? 10;
    const x = o.x ?? M;
    for (const l of wrap(s, o.f ?? font, size, o.w ?? W - M - x)) {
      need(size + 4);
      page.drawText(l, { x, y: y - size, size, font: o.f ?? font, color: o.color ?? ink });
      y -= size + 4;
    }
  };

  write(input.brand.toUpperCase(), { size: 9, f: bold, color: muted });
  write(input.title, { size: 18, f: bold });
  if (input.note) write(input.note, { size: 9, color: muted });
  y -= 6;

  const colW = (W - 2 * M) / 2;
  for (const s of input.sections) {
    need(36);
    y -= 8;
    write(s.heading, { size: 11, f: bold });
    page.drawLine({
      start: { x: M, y: y + 1 },
      end: { x: W - M, y: y + 1 },
      thickness: 0.6,
      color: rule,
    });
    y -= 6;
    // Two columns of label / value pairs.
    for (let i = 0; i < s.fields.length; i += 2) {
      const pair = s.fields.slice(i, i + 2);
      const rows = pair.map(([, v]) => wrap(v ?? "-", font, 10, colW - 12));
      const h = 11 + Math.max(...rows.map((r) => r.length)) * 13 + 4;
      need(h);
      pair.forEach(([label], c) => {
        const x = M + c * colW;
        page.drawText(latin1(label), { x, y: y - 8, size: 7.5, font: bold, color: muted });
        rows[c]!.forEach((line, j) => {
          page.drawText(line, { x, y: y - 21 - j * 13, size: 10, font, color: ink });
        });
      });
      y -= h;
    }
  }

  need(140);
  y -= 10;
  write("Authorization and signature", { size: 11, f: bold });
  page.drawLine({
    start: { x: M, y: y + 1 },
    end: { x: W - M, y: y + 1 },
    thickness: 0.6,
    color: rule,
  });
  y -= 6;
  write(input.consentText, { size: 8.5, color: ink });
  y -= 14;
  need(60);
  const sig = input.signature;
  if (sig) write(sig.name, { size: 16, f: bold });
  else y -= 20;
  page.drawLine({
    start: { x: M, y: y - 2 },
    end: { x: M + 260, y: y - 2 },
    thickness: 0.8,
    color: ink,
  });
  y -= 6;
  write(
    sig
      ? `Signed electronically by ${sig.name} on ${formatSignedAt(sig.signedAt)} via ${sig.via}. Ref ${sig.ref}`
      : "Signature (not signed yet)",
    { size: 8, color: muted },
  );

  const pages = doc.getPages();
  pages.forEach((p, i) =>
    p.drawText(latin1(`${input.brand} - ${input.title} - page ${i + 1} of ${pages.length}`), {
      x: M,
      y: 24,
      size: 7.5,
      font,
      color: muted,
    }),
  );
  return Buffer.from(await doc.save());
}
