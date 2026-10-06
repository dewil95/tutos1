import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { inspectPdf } from "./metadata";

async function pdf(meta: { producer?: string; creator?: string; created?: Date; modified?: Date }) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage();
  if (meta.producer) doc.setProducer(meta.producer);
  if (meta.creator) doc.setCreator(meta.creator);
  if (meta.created) doc.setCreationDate(meta.created);
  if (meta.modified) doc.setModificationDate(meta.modified);
  return Buffer.from(await doc.save({ updateFieldAppearances: false }));
}

describe("inspectPdf", () => {
  it("does not flag a statement straight from the bank's system", async () => {
    const r = await inspectPdf(
      await pdf({
        producer: "Sample Bank Statement Engine 4.2",
        created: new Date("2026-07-01"),
        modified: new Date("2026-07-01"),
      }),
    );
    expect(r.flags).toEqual([]);
    expect(r.pageCount).toBe(1);
  });

  it("flags editor software and late modification", async () => {
    const r = await inspectPdf(
      await pdf({
        producer: "Adobe Acrobat Pro (64-bit) 24.1",
        created: new Date("2026-07-01T10:00:00Z"),
        modified: new Date("2026-09-20T10:00:00Z"),
      }),
    );
    expect(r.flags.map((f) => f.code)).toEqual(["EDITOR_SOFTWARE", "MODIFIED_AFTER_CREATION"]);
    expect(r.flags[1]!.message).toContain("81 day(s)");
  });

  it("reports files it cannot open instead of throwing", async () => {
    expect((await inspectPdf(Buffer.from("nope"))).flags[0]!.code).toBe("UNREADABLE");
  });
});
