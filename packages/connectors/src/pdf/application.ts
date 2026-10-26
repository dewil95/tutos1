import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/**
 * Ascend's business funding application as a PDF, drawn from structured fields, in the same
 * design as the application PDF on ascendfund.co: navy header, section bars, label/value rows,
 * terms, and a signature box (the merchant's drawn signature, or their typed name).
 * The standard PDF fonts only cover Latin-1, which keeps Spanish names intact.
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
  /** The signature the signer drew (PNG); without it the typed name is shown. */
  image?: Uint8Array;
}

export interface ApplicationPdfInput {
  brand: string;
  title: string;
  /** Under the brand in the header, e.g. "Business Capital". */
  tagline?: string;
  /** Italic line under the header. */
  intro?: string;
  sections: ApplicationPdfSection[];
  /** Authorization the signer agrees to; printed above the signature. */
  consentText: string;
  /** Heading of the authorization bar (default "Terms of use"). */
  consentHeading?: string;
  /** Absent → unsigned, with an empty signature box. */
  signature?: ApplicationSignatureBlock;
  /** Printed name under the empty signature box of an unsigned application. */
  signerName?: string;
  /** Small print under the header, e.g. "Preview - not signed yet". */
  note?: string;
  /** Contact line in the footer, e.g. "786-565-0570 | www.ascendfund.co". */
  contact?: string;
  /** Date in the header (default: the signing time, else now). */
  date?: Date;
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

const longDate = (d: Date) =>
  d.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

/** "October 22, 2026 05:47 PM EDT", as in the header of ascendfund.co's application. */
export function headerDate(d: Date): string {
  const time = d.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${longDate(d)} ${time}`;
}

const NAVY = rgb(0.13, 0.23, 0.4);
const WHITE = rgb(1, 1, 1);
const INK = rgb(0.13, 0.13, 0.15);
const MUTED = rgb(0.45, 0.47, 0.5);
const ROW = rgb(0.957, 0.961, 0.973);
const RULE = rgb(0.85, 0.87, 0.9);

export async function renderApplicationPdf(input: ApplicationPdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(latin1(`${input.brand} - ${input.title}`));
  doc.setProducer(latin1(`${input.brand} CRM`));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  // A4, like the application PDF on ascendfund.co.
  const W = 595;
  const H = 842;
  const M = 42;
  const FOOT = 64;
  const sig = input.signature;
  const date = input.date ?? sig?.signedAt ?? new Date();

  let page: PDFPage = doc.addPage([W, H]);
  let y = H;

  const text = (
    s: string,
    x: number,
    yy: number,
    o: { size?: number; f?: PDFFont; color?: typeof INK } = {},
  ) =>
    page.drawText(latin1(s), {
      x,
      y: yy,
      size: o.size ?? 9,
      font: o.f ?? font,
      color: o.color ?? INK,
    });
  const right = (s: string, xr: number, yy: number, size: number, f: PDFFont, color = INK) =>
    text(s, xr - f.widthOfTextAtSize(latin1(s), size), yy, { size, f, color });

  // Header band (first page) and a slim band on the next pages.
  const header = (first: boolean) => {
    const h = first ? 66 : 30;
    page.drawRectangle({ x: 0, y: H - h, width: W, height: h, color: NAVY });
    if (first) {
      text(input.brand.toUpperCase(), M, H - 34, { size: 20, f: bold, color: WHITE });
      if (input.tagline) text(input.tagline, M, H - 50, { size: 8.5, color: WHITE });
      right(input.title, W - M, H - 32, 15, bold, WHITE);
      right(headerDate(date), W - M, H - 48, 8, font, WHITE);
    } else {
      text(input.brand.toUpperCase(), M, H - 20, { size: 10, f: bold, color: WHITE });
      right(input.title, W - M, H - 20, 9, bold, WHITE);
    }
    y = H - h - 14;
  };
  const newPage = () => {
    page = doc.addPage([W, H]);
    header(false);
  };
  const need = (h: number) => {
    if (y - h < FOOT) newPage();
  };
  const bar = (label: string, x: number, w: number) => {
    page.drawRectangle({ x, y: y - 16, width: w, height: 16, color: NAVY });
    text(label.toUpperCase(), x + 8, y - 11.5, { size: 8, f: bold, color: WHITE });
    y -= 16;
  };
  const paragraph = (s: string, size: number, f = font, color = INK) => {
    for (const l of wrap(s, f, size, W - 2 * M)) {
      need(size + 3);
      text(l, M, y - size, { size, f, color });
      y -= size + 3;
    }
  };

  header(true);
  if (input.intro) {
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: RULE });
    y -= 4;
    paragraph(input.intro, 8, italic, MUTED);
  }
  if (input.note) paragraph(input.note, 8.5, bold, rgb(0.6, 0.36, 0));
  y -= 8;

  // Sections as cards in two columns, each card placed in the shorter column.
  const gap = 14;
  const colW = (W - 2 * M - gap) / 2;
  const labelW = colW * 0.42;
  const rowsOf = (s: ApplicationPdfSection) =>
    s.fields.map(([label, value]) => {
      const v = wrap(value ?? "-", bold, 8.5, colW - labelW - 12);
      return { label, v, h: Math.max(19, 8 + v.length * 11) };
    });
  const cardH = (s: ApplicationPdfSection) => 16 + rowsOf(s).reduce((t, r) => t + r.h, 0);
  const drawCard = (s: ApplicationPdfSection, x: number, top: number) => {
    const save = y;
    y = top;
    bar(s.heading, x, colW);
    for (const r of rowsOf(s)) {
      page.drawRectangle({ x, y: y - r.h, width: colW, height: r.h, color: ROW });
      page.drawLine({
        start: { x, y: y - r.h },
        end: { x: x + colW, y: y - r.h },
        thickness: 0.5,
        color: RULE,
      });
      text(r.label, x + 8, y - 12.5, { size: 7.5, color: MUTED });
      r.v.forEach((line, j) => text(line, x + labelW, y - 12.5 - j * 11, { size: 8.5, f: bold }));
      y -= r.h;
    }
    const bottom = y;
    y = save;
    return bottom;
  };
  let cols = [y, y];
  for (const s of input.sections) {
    const h = cardH(s);
    let c = cols[0]! >= cols[1]! ? 0 : 1;
    if (cols[c]! - h < FOOT) {
      // Neither column has room: continue on a new page.
      newPage();
      cols = [y, y];
      c = 0;
    }
    cols[c] = drawCard(s, M + c * (colW + gap), cols[c]!) - 12;
  }
  y = Math.min(cols[0]!, cols[1]!) - 6;

  need(60);
  bar(input.consentHeading ?? "Terms of use", M, W - 2 * M);
  y -= 6;
  paragraph(input.consentText, 7.5);
  y -= 16;

  // Signature: the drawn signature (or the typed name) in a box, date, printed name.
  need(150);
  bar("Digital signature", M, W - 2 * M);
  y -= 10;
  const boxW = 250;
  const boxH = 70;
  page.drawRectangle({
    x: M,
    y: y - boxH,
    width: boxW,
    height: boxH,
    borderColor: RULE,
    borderWidth: 1,
    color: WHITE,
  });
  if (sig?.image) {
    const png = await doc.embedPng(sig.image);
    const scale = Math.min((boxW - 20) / png.width, (boxH - 12) / png.height);
    const w = png.width * scale;
    const h = png.height * scale;
    page.drawImage(png, {
      x: M + (boxW - w) / 2,
      y: y - boxH + (boxH - h) / 2,
      width: w,
      height: h,
    });
  } else if (sig) {
    const size = 20;
    const name = wrap(sig.name, italic, size, boxW - 20)[0] ?? "";
    text(name, M + 12, y - boxH / 2 - size / 3, { size, f: italic });
  } else {
    // Unsigned, as on ascendfund.co's application: a placeholder in the empty box.
    text("Applicant Signature", M + 12, y - boxH / 2 - 3, { size: 8.5, f: italic, color: MUTED });
  }
  y -= boxH + 12;
  text("Signature", M, y, { size: 7.5, color: MUTED });
  const signedOn = sig?.signedAt ?? input.date;
  text(`Date: ${signedOn ? longDate(signedOn) : "______________________"}`, M + boxW + 40, y + 2, {
    size: 8,
    color: MUTED,
  });
  y -= 16;
  const printed = sig?.name ?? input.signerName;
  if (printed) text(printed, M, y, { size: 9, f: bold });
  else
    page.drawLine({
      start: { x: M, y: y - 2 },
      end: { x: M + boxW, y: y - 2 },
      thickness: 0.6,
      color: INK,
    });
  y -= 11;
  text("Printed Name", M, y, { size: 7.5, color: MUTED });
  y -= 14;
  if (sig) {
    paragraph(
      `Signed electronically by ${sig.name} on ${formatSignedAt(sig.signedAt)} via ${sig.via}. Ref ${sig.ref}`,
      7,
      font,
      MUTED,
    );
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => {
    page = p;
    p.drawLine({ start: { x: M, y: 46 }, end: { x: W - M, y: 46 }, thickness: 0.6, color: RULE });
    text(`${input.brand} ${input.tagline ?? ""}`.trim().toUpperCase(), M, 34, {
      size: 7.5,
      f: bold,
      color: NAVY,
    });
    if (input.contact) text(input.contact, M, 23, { size: 7, color: MUTED });
    right(`Page ${i + 1} of ${pages.length}`, W - M, 34, 7.5, font, MUTED);
    right("CONFIDENTIAL", W - M, 23, 7, font, MUTED);
  });
  return Buffer.from(await doc.save());
}
