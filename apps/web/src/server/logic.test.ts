import { describe, expect, it } from "vitest";
import { classifyFileName, defaultPackage } from "./documents";
import {
  fundersAddressed,
  isLenderAddress,
  merchantFromSubject,
  routeMessage,
  subjectMentions,
} from "./inbox/route";
import { advanceStage, forwardStage, statusForIntent } from "./jobs/parseReply";
import { dealProfile } from "./lenders";
import { nextStep, type NextStepInput } from "./nextStep";
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
    // Lenders that put their decision in the subject (TMR).
    expect(merchantFromSubject("Decline: New Deal Submission - Acme Bistro")).toBe("Acme Bistro");
  });

  it("imports a forwarded re-shop as a submission, but not the team's replies", () => {
    const fwd = {
      from: "jonas@ascendfund.co",
      labelIds: ["SENT"],
      subject: "Fwd: New Deal Submission - Acme",
    };
    expect(routeMessage(fwd, ctx)).toEqual({ kind: "outbound_submission", merchantName: "Acme" });
    expect(routeMessage({ ...fwd, subject: "FW: RE: New Deal Submission - Acme" }, ctx)).toEqual({
      kind: "ignore",
    });
  });

  it("matches a lender on a free mailbox by its exact address only", () => {
    const keys = ["fundmefastllc@gmail.com"];
    expect(isLenderAddress("FundMeFastLLC@gmail.com", keys)).toBe(true);
    expect(isLenderAddress("someone.else@gmail.com", keys)).toBe(false);
    expect(isLenderAddress("uw@tmrnow.com", ["tmrnow.com"])).toBe(true);
    const gmailLender = [{ id: "f9", name: "Fund Me Fast", emailDomains: keys }];
    expect(
      routeMessage(
        { from: "owner@gmail.com", labelIds: ["INBOX"], subject: "x" },
        {
          ownDomain: "ascendfund.co",
          funders: gmailLender,
        },
      ),
    ).toEqual({ kind: "external" });
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

describe("deal profile for the lender ranking", () => {
  it('treats a misread "$1" request as unknown instead of ruling lenders out', () => {
    const base = {
      paperGrade: "B",
      avgMonthlyTrueRevenue: 40_000,
      startDate: null,
      existingPositions: 0,
      state: "NJ",
      naics: null,
    };
    expect(dealProfile({ ...base, requestedAmount: 1 }).requestedAmount).toBeNull();
    expect(dealProfile({ ...base, requestedAmount: 25_000 }).requestedAmount).toBe(25_000);
  });
});

describe("next step on the deal page", () => {
  const base: NextStepInput = {
    stage: "DOCS_RECEIVED",
    reading: "done",
    missing: [],
    signed: true,
    signatureFromUploadPending: false,
    statements: 3,
    pendingStatements: 0,
    scrubbed: true,
    contractsRequested: false,
    submissions: [],
  };
  const sub = (
    funder: string,
    status: NextStepInput["submissions"][number]["status"],
    extra = {},
  ) => ({
    funder,
    status,
    latest: null,
    offer: null,
    ...extra,
  });

  it("walks the file from reading to shopping", () => {
    expect(nextStep({ ...base, reading: "reading" })?.title).toMatch(/Reading/);
    expect(nextStep({ ...base, missing: ["EIN", "Owner SSN"] })).toMatchObject({
      tone: "warn",
      title: "2 details missing before the merchant can sign:",
      detail: "EIN, Owner SSN.",
    });
    expect(nextStep({ ...base, signed: false, signatureFromUploadPending: true })?.action).toEqual({
      label: "Apply the signature",
      href: "#ascend-application",
    });
    expect(nextStep({ ...base, signed: false })?.title).toBe("Not signed yet.");
    expect(nextStep({ ...base, statements: 0 })?.title).toBe("No bank statements yet.");
    expect(nextStep(base)).toMatchObject({ tone: "ok", action: { href: "#ship" } });
  });

  it("follows the lenders' answers", () => {
    const sent = [sub("Mazal Funders", "SENT"), sub("Zlur", "ACKNOWLEDGED")];
    expect(nextStep({ ...base, submissions: sent })?.title).toBe(
      "Sent to 2 lenders · 1 replied · waiting on 1.",
    );
    expect(
      nextStep({
        ...base,
        submissions: [sub("Mazal Funders", "APPROVED", { offer: { amount: 15000, factor: 1.45 } })],
      }),
    ).toMatchObject({ tone: "ok", title: "Offer from Mazal Funders.", detail: /\$15,000 at 1.45/ });
    expect(
      nextStep({
        ...base,
        contractsRequested: true,
        submissions: [sub("Mazal Funders", "APPROVED")],
      })?.title,
    ).toBe("Contracts requested.");
    expect(
      nextStep({ ...base, submissions: [sub("Zlur", "DECLINED"), sub("TMR Now", "DECLINED")] }),
    ).toMatchObject({ tone: "bad", title: "All 2 lenders declined." });
    expect(nextStep({ ...base, stage: "DEAD" })).toBeNull();
    expect(nextStep({ ...base, stage: "FUNDED" })?.title).toBe("Funded.");
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

  it("a contract request never pulls a deal back from stips, contract out or funded", () => {
    expect(forwardStage("OFFERS_RECEIVED", "OFFER_ACCEPTED")).toBe("OFFER_ACCEPTED");
    expect(forwardStage("OFFER_ACCEPTED", "OFFER_ACCEPTED")).toBeNull();
    expect(forwardStage("STIPS", "OFFER_ACCEPTED")).toBeNull();
    expect(forwardStage("CONTRACT_OUT", "OFFER_ACCEPTED")).toBeNull();
    expect(forwardStage("FUNDED", "OFFER_ACCEPTED")).toBeNull();
    expect(forwardStage("DEAD", "OFFER_ACCEPTED")).toBeNull();
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
