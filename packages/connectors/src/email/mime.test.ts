import { describe, expect, it } from "vitest";
import { buildMime, encodeHeader } from "./mime";

const base = {
  from: "funding@ascendfund.co",
  to: ["subs@mazalfunders.com"],
  cc: ["iso@mazalfunders.com", "jonas@ascendfund.co"],
  subject: "New Deal Submission - Café Olé LLC",
  text: "Hello,\n\nPlease see the attached deal for submission.",
  correlationId: "sub_123",
};

describe("buildMime", () => {
  it("writes exact To and Cc headers, encodes non-ASCII subjects, and never writes Bcc", () => {
    const mime = buildMime(
      {
        ...base,
        attachments: [
          {
            fileName: "Ascend-Fund-Application.pdf",
            mimeType: "application/pdf",
            data: Buffer.from("%PDF-1.7 app"),
          },
          { fileName: "Julio.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF-1.7 jul") },
        ],
      },
      "BOUNDARY",
    );
    const headerBlock = mime.split("\r\n\r\n")[0]!;
    expect(headerBlock).toContain("To: subs@mazalfunders.com\r\n");
    expect(headerBlock).toContain("Cc: iso@mazalfunders.com, jonas@ascendfund.co\r\n");
    expect(headerBlock).toContain(`Subject: ${encodeHeader(base.subject)}`);
    expect(headerBlock).toContain('Content-Type: multipart/mixed; boundary="BOUNDARY"');
    expect(mime.toLowerCase()).not.toContain("bcc");
    expect(mime).toContain(
      'Content-Disposition: attachment; filename="Ascend-Fund-Application.pdf"',
    );
    expect(mime).toContain(Buffer.from("%PDF-1.7 jul").toString("base64"));
    expect(mime.trimEnd().endsWith("--BOUNDARY--")).toBe(true);
    expect(mime.split("--BOUNDARY\r\n")).toHaveLength(4); // preamble + text + 2 attachments
  });

  it("emits a single-part message without attachments and omits Cc when empty", () => {
    const mime = buildMime({ ...base, cc: [] });
    expect(mime).not.toContain("multipart");
    expect(mime).not.toContain("Cc:");
    expect(mime).toContain(Buffer.from(base.text).toString("base64"));
  });

  it("threads replies with In-Reply-To and References", () => {
    const mime = buildMime({ ...base, inReplyTo: "<abc@mail.gmail.com>" });
    expect(mime).toContain("In-Reply-To: <abc@mail.gmail.com>");
    expect(mime).toContain("References: <abc@mail.gmail.com>");
  });

  it("blocks header injection", () => {
    expect(() => buildMime({ ...base, subject: "Hi\r\nBcc: everyone@x.com" })).toThrow(/injection/);
    expect(() => buildMime({ ...base, to: ["a@b.com\r\nBcc: x@y.com"] })).toThrow(/injection/);
  });

  it("requires a To recipient", () => {
    expect(() => buildMime({ ...base, to: [] })).toThrow(/To recipient/);
  });

  it("encodes non-ASCII attachment names with RFC 2231", () => {
    const mime = buildMime({
      ...base,
      attachments: [
        { fileName: "Septiembre año.pdf", mimeType: "application/pdf", data: Buffer.from("x") },
      ],
    });
    expect(mime).toContain("filename*=UTF-8''Septiembre%20a%C3%B1o.pdf");
  });
});
