import { describe, expect, it, vi } from "vitest";
import type { EmailProvider, SubmissionPackage } from "../types";
import {
  EmailFunderConnector,
  MAX_ATTACHMENT_BYTES,
  buildSubmissionEmail,
  formatPositions,
} from "./email";

const pkg: SubmissionPackage = {
  dealId: "deal_1",
  submissionId: "sub_1",
  funderName: "Mazal Funders",
  merchantName: "Luxury Nails & Spa",
  positions: [
    { funder: "Pathway Funding", balance: 12500 },
    { funder: "Fox Funding Grp", balance: 22000 },
    { funder: "advance syndicate", balance: 29310.5 },
  ],
  note: "INDUSTRY: NAIL SALON",
  attachments: [
    {
      fileName: "Ascend-Fund-Application.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("x"),
    },
  ],
};
const recipients = {
  to: ["subs@mazalfunders.com"],
  cc: ["iso@mazalfunders.com", "jonas@ascendfund.co"],
};

describe("buildSubmissionEmail", () => {
  it("reproduces the house subject and body", () => {
    const m = buildSubmissionEmail(pkg, recipients, { from: "funding@ascendfund.co" });
    expect(m.subject).toBe("New Deal Submission - Luxury Nails & Spa");
    expect(m.to).toEqual(["subs@mazalfunders.com"]);
    expect(m.cc).toEqual(["iso@mazalfunders.com", "jonas@ascendfund.co"]);
    expect(m.text.startsWith("Hello,\n\nPlease see the attached deal for submission.\n\n")).toBe(
      true,
    );
    expect(m.text).toContain(
      "Pathway Funding: $12,500\nFox Funding Grp: $22,000\nadvance syndicate: $29,310.5",
    );
    expect(m.text).toContain("INDUSTRY: NAIL SALON");
    expect(m.text).toContain("Thank you.\n\nConfidentiality Notice");
    expect(m.attachments).toHaveLength(1);
    expect("bcc" in m).toBe(false);
  });

  it("swaps attachments for Drive links when given", () => {
    const m = buildSubmissionEmail(
      { ...pkg, links: [{ fileName: "Statements.pdf", url: "https://drive.google.com/file/d/1" }] },
      recipients,
      { from: "funding@ascendfund.co" },
    );
    expect(m.attachments).toEqual([]);
    expect(m.text).toContain("Statements.pdf: https://drive.google.com/file/d/1");
  });

  it("formats positions without a balance", () => {
    expect(
      formatPositions([
        { funder: "Kapitus/monthly", balance: null },
        { funder: " ", balance: 1 },
      ]),
    ).toBe("Kapitus/monthly");
  });
});

describe("EmailFunderConnector", () => {
  it("sends one email and returns the Gmail thread and message ids", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "m1", threadId: "t1" });
    const email: EmailProvider = { name: "fake", send, sync: vi.fn(), getAttachment: vi.fn() };
    const c = new EmailFunderConnector(email, { from: "funding@ascendfund.co" });
    const r = await c.submit(pkg, recipients);
    expect(r).toMatchObject({ channel: "EMAIL", externalRef: "t1", messageId: "m1" });
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toMatchObject({ to: recipients.to, cc: recipients.cc });
  });

  it("refuses oversized packages instead of letting Gmail bounce them", async () => {
    const email: EmailProvider = {
      name: "fake",
      send: vi.fn(),
      sync: vi.fn(),
      getAttachment: vi.fn(),
    };
    const big = {
      ...pkg,
      attachments: [
        {
          fileName: "big.pdf",
          mimeType: "application/pdf",
          data: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1),
        },
      ],
    };
    await expect(
      new EmailFunderConnector(email, { from: "f@a.co" }).submit(big, recipients),
    ).rejects.toThrow(/size limit/);
    expect(email.send).not.toHaveBeenCalled();
  });
});
