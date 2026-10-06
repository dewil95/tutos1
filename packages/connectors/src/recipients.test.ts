import { describe, expect, it } from "vitest";
import { buildRecipients, planSubmissions, splitEmails } from "./recipients";

const team = ["jonas@ascendfund.co", "savvy@ascendfund.co", "david@ascendfund.co"];

describe("buildRecipients", () => {
  it("puts a lender's only address in To and the team in CC", () => {
    expect(buildRecipients({ emails: ["Submissions@zlur.com"] }, { teamCc: team })).toEqual({
      to: ["submissions@zlur.com"],
      cc: team,
    });
  });

  it("puts the first lender address in To and the lender's other addresses in CC before the team", () => {
    const r = buildRecipients(
      { emails: ["subs@mazalfunders.com", "iso@mazalfunders.com", "nate@mazalfunders.com"] },
      { teamCc: team },
    );
    expect(r.to).toEqual(["subs@mazalfunders.com"]);
    expect(r.cc).toEqual(["iso@mazalfunders.com", "nate@mazalfunders.com", ...team]);
  });

  it("never returns a bcc field", () => {
    const r = buildRecipients({ emails: ["a@lender.com", "b@lender.com"] }, { teamCc: team });
    expect(Object.keys(r).sort()).toEqual(["cc", "to"]);
  });

  it("de-duplicates case-insensitively and drops the sending mailbox", () => {
    const r = buildRecipients(
      { emails: ["UW@Lender.com", "uw@lender.com", " sales@lender.com "] },
      {
        teamCc: ["jonas@ascendfund.co", "JONAS@ascendfund.co", "funding@ascendfund.co"],
        from: "funding@ascendfund.co",
      },
    );
    expect(r).toEqual({ to: ["uw@lender.com"], cc: ["sales@lender.com", "jonas@ascendfund.co"] });
  });

  it("rejects lenders without addresses and invalid addresses", () => {
    expect(() => buildRecipients({ emails: [] })).toThrow(/no submission email/);
    expect(() => buildRecipients({ emails: ["not-an-email"] })).toThrow(/invalid email/);
  });
});

describe("planSubmissions", () => {
  it("creates one separate message per lender with no lender seeing another", () => {
    const plan = planSubmissions(
      [
        {
          funderId: "f1",
          funderName: "Mazal",
          emails: ["subs@mazalfunders.com", "iso@mazalfunders.com"],
        },
        { funderId: "f2", funderName: "Zlur", emails: ["submissions@zlur.com"] },
        {
          funderId: "f3",
          funderName: "Instagreen",
          emails: ["submit@instagreencapital.com", "isabel@instagreencapital.com"],
        },
      ],
      { teamCc: team },
    );
    expect(plan).toHaveLength(3);
    const lenderDomains = ["mazalfunders.com", "zlur.com", "instagreencapital.com"];
    plan.forEach((p, i) => {
      const all = [...p.recipients.to, ...p.recipients.cc];
      for (const [j, domain] of lenderDomains.entries()) {
        const present = all.some((a) => a.endsWith(`@${domain}`));
        expect(present).toBe(i === j);
      }
    });
    expect(plan[2]!.recipients).toEqual({
      to: ["submit@instagreencapital.com"],
      cc: ["isabel@instagreencapital.com", ...team],
    });
  });

  it("refuses the whole batch if one lender is misconfigured", () => {
    expect(() =>
      planSubmissions([
        { funderId: "f1", funderName: "Good", emails: ["a@good.com"] },
        { funderId: "f2", funderName: "Bad", emails: [] },
      ]),
    ).toThrow();
  });

  it("refuses to send the same lender twice", () => {
    expect(() =>
      planSubmissions([
        { funderId: "f1", funderName: "Mazal", emails: ["a@m.com"] },
        { funderId: "f1", funderName: "Mazal", emails: ["a@m.com"] },
      ]),
    ).toThrow(/twice/);
  });
});

describe("splitEmails", () => {
  it("splits CSV cells with ; , and spaces", () => {
    expect(splitEmails("iso@m.com;Nate@M.com, x@y.com")).toEqual([
      "iso@m.com",
      "nate@m.com",
      "x@y.com",
    ]);
    expect(splitEmails("")).toEqual([]);
    expect(splitEmails(null)).toEqual([]);
  });
});
