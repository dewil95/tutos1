import { describe, expect, it, vi } from "vitest";
import { EmailFunderConnector, buildSubmissionEmail } from "./email";
import type { EmailProvider, SubmissionPackage } from "../types";

const pkg: SubmissionPackage = {
  dealId: "deal_1",
  submissionId: "sub_1",
  funderName: "Example Funder A",
  programName: "Core",
  merchantLegalName: "Acme Plumbing LLC",
  isoName: "Blu Capital",
  requestedAmount: 75000,
  processorSummary: "4 months, $51K avg true revenue, 0 NSFs, 1st position.",
  attachments: [
    { fileName: "application.pdf", mimeType: "application/pdf", data: Buffer.from("x") },
  ],
  watermarkTag: "BLU/FUNDER-A/2026-10-05",
};

describe("buildSubmissionEmail", () => {
  it("uses the Merchant / ISO subject convention and lists attachments", () => {
    const m = buildSubmissionEmail(pkg, "iso@funder.test", "subs@blu.test");
    expect(m.subject).toBe("Acme Plumbing LLC / Blu Capital");
    expect(m.text).toContain("Requested: $75,000");
    expect(m.text).toContain("application.pdf");
    expect(m.text).toContain("BLU/FUNDER-A/2026-10-05");
    expect(m.correlationId).toBe("sub_1");
  });
});

describe("EmailFunderConnector", () => {
  it("sends through the email provider and returns the thread as externalRef", async () => {
    const send = vi.fn().mockResolvedValue({ externalId: "m1", threadId: "t1" });
    const email: EmailProvider = { name: "fake", send, sync: vi.fn() };
    const c = new EmailFunderConnector(email, {
      submissionAddress: "iso@funder.test",
      fromAddress: "subs@blu.test",
    });
    const r = await c.submit(pkg);
    expect(r).toMatchObject({ channel: "EMAIL", externalRef: "t1" });
    expect(send).toHaveBeenCalledOnce();
  });
});
