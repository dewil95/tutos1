import { randomBytes } from "node:crypto";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { Attachment } from "../types";

/**
 * Per-lender watermark. Every page of every PDF in a lender's package gets a small footer naming
 * the lender and a reference tag, plus the tag in the PDF metadata. If a file turns up at a
 * lender it was not sent to (backdooring), the tag says whose copy it was.
 */

export interface WatermarkInfo {
  brokerName: string;
  lenderName: string;
  /** Short reference stored on the Submission. */
  tag: string;
  date?: Date;
}

export interface WatermarkResult {
  attachment: Attachment;
  stamped: boolean;
  /** Why a file went out unstamped (encrypted PDF, unsupported type…). */
  skippedReason?: string;
}

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 8 characters, no look-alikes (0/O, 1/I/L), e.g. "K7QH3MZP". */
export function newWatermarkTag(): string {
  return [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
}

/** Standard PDF fonts only cover WinAnsi; anything else becomes "?". */
const ascii = (s: string) => s.replace(/[^\x20-\x7E]/g, "?");

export function watermarkText(info: WatermarkInfo): string {
  const d = (info.date ?? new Date()).toISOString().slice(0, 10);
  return ascii(
    `Submitted by ${info.brokerName} to ${info.lenderName} only - ${d} - Ref ${info.tag}`,
  );
}

async function stamp(doc: PDFDocument, info: WatermarkInfo): Promise<void> {
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const text = watermarkText(info);
  for (const page of doc.getPages()) {
    const { width } = page.getSize();
    const size = Math.max(6, Math.min(8, width / 80));
    page.drawText(text, {
      x: 18,
      y: 10,
      size,
      font,
      color: rgb(0.45, 0.45, 0.45),
      opacity: 0.85,
    });
  }
  doc.setSubject(ascii(`${info.brokerName} submission to ${info.lenderName}`));
  doc.setKeywords([`ref:${info.tag}`, ascii(`lender:${info.lenderName}`)]);
}

const isPdf = (a: Attachment) =>
  a.mimeType === "application/pdf" || a.fileName.toLowerCase().endsWith(".pdf");
const isImage = (a: Attachment) => /^image\/(jpe?g|png)$/.test(a.mimeType);

export async function watermarkAttachment(
  a: Attachment,
  info: WatermarkInfo,
): Promise<WatermarkResult> {
  if (isPdf(a)) {
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(a.data, { updateMetadata: false });
    } catch (err) {
      // Encrypted or damaged PDFs are sent as they are rather than risking a broken file.
      const reason =
        err instanceof Error && /encrypt/i.test(err.message) ? "encrypted PDF" : "unreadable PDF";
      return { attachment: a, stamped: false, skippedReason: reason };
    }
    await stamp(doc, info);
    return { attachment: { ...a, data: Buffer.from(await doc.save()) }, stamped: true };
  }

  if (isImage(a)) {
    // Photos of DL / voided checks: wrap into a one-page PDF so they can carry the footer too.
    const doc = await PDFDocument.create();
    const img = /png$/.test(a.mimeType) ? await doc.embedPng(a.data) : await doc.embedJpg(a.data);
    const maxW = 612;
    const maxH = 792 - 30;
    const scale = Math.min(1, maxW / img.width, maxH / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    const page = doc.addPage([Math.max(w, 300), h + 30]);
    page.drawImage(img, { x: 0, y: 30, width: w, height: h });
    await stamp(doc, info);
    return {
      attachment: {
        fileName: a.fileName.replace(/\.(jpe?g|png)$/i, "") + ".pdf",
        mimeType: "application/pdf",
        data: Buffer.from(await doc.save()),
      },
      stamped: true,
    };
  }

  return { attachment: a, stamped: false, skippedReason: `unsupported type ${a.mimeType}` };
}

/** Reads the tag back from a PDF's keywords (to trace a file found elsewhere). */
export async function readWatermarkTag(data: Buffer): Promise<string | null> {
  try {
    const doc = await PDFDocument.load(data, { updateMetadata: false });
    return /ref:([A-Z0-9]{8})/.exec(doc.getKeywords() ?? "")?.[1] ?? null;
  } catch {
    return null;
  }
}
