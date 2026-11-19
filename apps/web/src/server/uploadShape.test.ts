import { describe, expect, it } from "vitest";
import {
  applicationUploadToPdf,
  statementUploadsToPdfs,
  UploadShapeError,
} from "./ascendApplication";

const pdf = (name: string) => ({ name, type: "application/pdf", data: Buffer.from("%PDF-1.4") });
const jpg = (name: string) => ({ name, type: "image/jpeg", data: Buffer.alloc(0) });

describe("public uploads", () => {
  it("names the shape problem so the merchant reads it in their language", async () => {
    const code = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: UploadShapeError) => e.code,
      );
    expect(await code(applicationUploadToPdf([pdf("a.pdf"), pdf("b.pdf")]))).toBe("onepdf");
    expect(await code(applicationUploadToPdf([pdf("a.pdf"), jpg("p1.jpg")]))).toBe("mixed");
    expect(
      await code(
        applicationUploadToPdf([{ name: "x.gif", type: "image/gif", data: Buffer.alloc(0) }]),
      ),
    ).toBe("apptype");
    expect(await applicationUploadToPdf([pdf("a.pdf")])).toMatchObject({ fileName: "a.pdf" });
  });

  it("keeps statement PDFs as they are and passes photos on as one PDF instead of dropping them", async () => {
    expect(await statementUploadsToPdfs([pdf("sep.pdf"), pdf("oct.pdf")])).toHaveLength(2);
    expect(await statementUploadsToPdfs([])).toEqual([]);
    const png = (name: string) => ({
      name,
      type: "image/png",
      data: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
        "base64",
      ),
    });
    const out = await statementUploadsToPdfs([pdf("sep.pdf"), png("p1.png"), png("p2.png")]);
    expect(out.map((f) => f.name)).toEqual(["sep.pdf", "Bank statement photos (2 pages).pdf"]);
    expect(out[1]!.data.subarray(0, 4).toString()).toBe("%PDF");
  });
});
