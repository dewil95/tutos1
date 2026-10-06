import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderReportPdf } from "./report";

describe("renderReportPdf", () => {
  it("renders headings, bullets and tables across pages with a footer", async () => {
    const pdf = await renderReportPdf({
      title: "Risk Report – Sample Bistro LLC",
      subtitle: "Score 62 / 100 · moderate",
      footer: "INTERNAL – do not send to lenders",
      sections: [
        { heading: "Summary", lines: ["Long text ".repeat(200)] },
        {
          heading: "Top risks",
          lines: ["- New funding wire in August", "- 3 active positions → heavy holdback"],
        },
        {
          heading: "Months",
          table: [
            ["Month", "Deposits"],
            ...Array.from({ length: 60 }, (_, i) => [`2026-${i}`, "$50,000"]),
          ],
        },
      ],
    });
    const doc = await PDFDocument.load(pdf);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toBe("Risk Report - Sample Bistro LLC");
  });
});
