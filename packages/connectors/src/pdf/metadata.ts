import { PDFDocument } from "pdf-lib";

/**
 * File-level signs that a bank statement PDF was edited after the bank produced it. Banks export
 * statements from their own systems; a statement last saved by a PDF editor, or modified days
 * after it was created, deserves a closer look. These are hints for a person, never a decline.
 */

export interface PdfInspection {
  pageCount: number | null;
  producer: string | null;
  creator: string | null;
  createdAt: string | null;
  modifiedAt: string | null;
  encrypted: boolean;
  flags: { code: "EDITOR_SOFTWARE" | "MODIFIED_AFTER_CREATION" | "UNREADABLE"; message: string }[];
}

const EDITORS =
  /(photoshop|illustrator|acrobat\s*(pro|dc|standard)|foxit\s*(phantom|editor)|nitro|pdfelement|wondershare|sejda|smallpdf|ilovepdf|pdf-?xchange|pdfescape|canva|inkscape|gimp|pdf\s*editor|microsoft.*word|libreoffice\s*writer|google docs)/i;

export async function inspectPdf(data: Buffer): Promise<PdfInspection> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(data, { updateMetadata: false, ignoreEncryption: true });
  } catch {
    return {
      pageCount: null,
      producer: null,
      creator: null,
      createdAt: null,
      modifiedAt: null,
      encrypted: false,
      flags: [{ code: "UNREADABLE", message: "The PDF could not be opened to check its history." }],
    };
  }
  const producer = doc.getProducer() ?? null;
  const creator = doc.getCreator() ?? null;
  // Some banks write dates like "9/1/2026 04:10:24", which pdf-lib refuses: treat as unknown.
  const date = (get: () => Date | undefined) => {
    try {
      return get() ?? null;
    } catch {
      return null;
    }
  };
  const created = date(() => doc.getCreationDate());
  const modified = date(() => doc.getModificationDate());
  const flags: PdfInspection["flags"] = [];

  const editor = [producer, creator].find((v) => v && EDITORS.test(v));
  if (editor) {
    flags.push({
      code: "EDITOR_SOFTWARE",
      message: `Last saved with "${editor}", not the bank's own system.`,
    });
  }
  if (created && modified && modified.getTime() - created.getTime() > 24 * 3_600_000) {
    const days = Math.round((modified.getTime() - created.getTime()) / 86_400_000);
    flags.push({
      code: "MODIFIED_AFTER_CREATION",
      message: `Modified ${days} day(s) after it was created (${created.toISOString().slice(0, 10)} → ${modified.toISOString().slice(0, 10)}).`,
    });
  }
  return {
    pageCount: doc.getPageCount(),
    producer,
    creator,
    createdAt: created?.toISOString() ?? null,
    modifiedAt: modified?.toISOString() ?? null,
    encrypted: doc.isEncrypted,
    flags,
  };
}
