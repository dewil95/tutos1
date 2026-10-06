import { describe, expect, it } from "vitest";
import { classifyFileName, defaultPackage } from "./documents";
import {
  fundersAddressed,
  merchantFromSubject,
  routeMessage,
  subjectMentions,
} from "./inbox/route";
import { advanceStage, statusForIntent } from "./jobs/parseReply";
import { parsePositions, positionsToText } from "./submissions";

const funders = [
  { id: "f1", name: "Mazal Funders", emailDomains: ["mazalfunders.com"] },
  { id: "f2", name: "Zlur", emailDomains: ["zlur.com"] },
];
const ctx = { ownDomain: "ascendfund.co", funders };

describe("inbox routing", () => {
  it("reads the merchant out of submission subjects, through Re:/Fwd:", () => {
    expect(merchantFromSubject("New Deal Submission - Joe's Pizza LLC")).toBe("Joe's Pizza LLC");
    expect(merchantFromSubject("RE: Fwd: New Deal Submission - Real Drip NYC")).toBe(
      "Real Drip NYC",
    );
    expect(merchantFromSubject("Deal funded")).toBeNull();
  });

  it("imports hand-sent submissions, ignores our replies, routes lender and outside mail", () => {
    const sent = {
      from: "funding@ascendfund.co",
      labelIds: ["SENT"],
      subject: "New Deal Submission - Acme",
    };
    expect(routeMessage(sent, ctx)).toEqual({ kind: "outbound_submission", merchantName: "Acme" });
    expect(routeMessage({ ...sent, subject: "Re: New Deal Submission - Acme" }, ctx)).toEqual({
      kind: "ignore",
    });
    expect(
      routeMessage({ from: "subs@mazalfunders.com", labelIds: ["INBOX"], subject: "x" }, ctx),
    ).toMatchObject({
      kind: "funder",
      funderId: "f1",
    });
    expect(
      routeMessage({ from: "owner@acme.com", labelIds: ["INBOX"], subject: "statements" }, ctx),
    ).toEqual({
      kind: "external",
    });
  });

  it("finds each lender addressed by a hand-sent email once", () => {
    const m = {
      to: ["subs@mazalfunders.com", "submissions@zlur.com"],
      cc: ["iso@mazalfunders.com", "jonas@ascendfund.co"],
    };
    expect(fundersAddressed(m, funders).map((f) => f.id)).toEqual(["f1", "f2"]);
  });

  it("matches merchant names in reply subjects regardless of LLC and punctuation", () => {
    expect(subjectMentions("RE: Approval - JOES PIZZA", ["Joe's Pizza LLC", null])).toBe(false);
    expect(subjectMentions("RE: Approval - Joe's Pizza", ["Joe's Pizza LLC", null])).toBe(true);
    expect(subjectMentions("Decline: Acme Landscaping Inc.", ["ACME LANDSCAPING, INC", null])).toBe(
      true,
    );
    expect(subjectMentions("Decline: Acme", ["Ac", null])).toBe(false);
  });
});

describe("positions block", () => {
  it("parses the lines reps type and formats them back", () => {
    const p = parsePositions("Mazal: $12,500\nFundzilla 8k\nUnknown lender\n\n");
    expect(p).toEqual([
      { funder: "Mazal", balance: 12500 },
      { funder: "Fundzilla", balance: 8000 },
      { funder: "Unknown lender", balance: null },
    ]);
    expect(positionsToText(p)).toBe("Mazal: $12,500\nFundzilla: $8,000\nUnknown lender");
  });
});

describe("reply → status", () => {
  it("never moves a submission backwards", () => {
    expect(statusForIntent("ACKNOWLEDGED", "SENT")).toBe("ACKNOWLEDGED");
    expect(statusForIntent("ACKNOWLEDGED", "APPROVED")).toBeNull();
    expect(statusForIntent("DECLINED", "IN_REVIEW")).toBe("DECLINED");
    expect(statusForIntent("STIP_REQUEST", "APPROVED")).toBeNull();
    expect(statusForIntent("MARKETING", "SENT")).toBeNull();
  });

  it("advances the deal stage forward only", () => {
    expect(advanceStage("SUBMITTED", "APPROVED")).toBe("OFFERS_RECEIVED");
    expect(advanceStage("CONTRACT_OUT", "APPROVED")).toBeNull();
    expect(advanceStage("CONTRACT_OUT", "FUNDED")).toBe("FUNDED");
    expect(advanceStage("DEAD", "FUNDED")).toBeNull();
  });
});

describe("documents", () => {
  it("guesses type and Drive subfolder from the file name", () => {
    expect(classifyFileName("Ascend-Fund-Application-Acme.pdf").type).toBe("APPLICATION");
    expect(classifyFileName("Chase June 2026.pdf")).toEqual({
      type: "BANK_STATEMENT",
      subfolder: "Statements",
    });
    expect(classifyFileName("MTD.docx").subfolder).toBe("MTD");
    expect(classifyFileName("voided check.jpg").type).toBe("VOIDED_CHECK");
    expect(classifyFileName("scan001.pdf").type).toBe("OTHER");
  });

  it("pre-selects the newest application and the latest four statements", () => {
    const d = (id: string, type: "APPLICATION" | "BANK_STATEMENT" | "OTHER", month: number) => ({
      id,
      type,
      createdAt: new Date(2026, 0, 1),
      periodEnd: new Date(2026, month, 28),
    });
    const docs = [d("a1", "APPLICATION", 1), d("a2", "APPLICATION", 5), d("o", "OTHER", 9)];
    for (let m = 0; m < 6; m++) docs.push(d(`s${m}`, "BANK_STATEMENT", m));
    expect(defaultPackage(docs)).toEqual(["a2", "s5", "s4", "s3", "s2"]);
  });
});
