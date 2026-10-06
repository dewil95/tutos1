import type { InboundEmail } from "@mca/connectors";

export interface FunderDomains {
  id: string;
  name: string;
  emailDomains: string[];
}

export type Route =
  /** A "New Deal Submission - X" the team sent by hand from Gmail: import it as a deal. */
  | { kind: "outbound_submission"; merchantName: string }
  /** Mail from a lender's domain: reply on a submission (or a lender blast). */
  | { kind: "funder"; funderId: string; funderName: string }
  /** Anything else from outside: may be a merchant sending documents. */
  | { kind: "external" }
  /** Team-internal or our own non-submission mail. */
  | { kind: "ignore" };

export const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

const SUBMISSION_SUBJECT = /^\s*new deal submission\s*[-–:]\s*(.+?)\s*$/i;
const REPLY_PREFIX = /^\s*((re|fw|fwd)\s*:\s*)+/i;

/** "RE: Fwd: New Deal Submission - Joe's Pizza LLC" → "Joe's Pizza LLC" (or null). */
export function merchantFromSubject(subject: string): string | null {
  return SUBMISSION_SUBJECT.exec(subject.replace(REPLY_PREFIX, ""))?.[1] ?? null;
}

export function routeMessage(
  m: Pick<InboundEmail, "from" | "subject" | "labelIds">,
  ctx: { ownDomain: string; funders: FunderDomains[] },
): Route {
  const fromDomain = domainOf(m.from);
  const ours = m.labelIds.includes("SENT") || fromDomain === ctx.ownDomain.toLowerCase();
  if (ours) {
    const isOriginal = !REPLY_PREFIX.test(m.subject);
    const merchant = isOriginal ? merchantFromSubject(m.subject) : null;
    return merchant ? { kind: "outbound_submission", merchantName: merchant } : { kind: "ignore" };
  }
  const funder = ctx.funders.find((f) =>
    f.emailDomains.some((d) => d.toLowerCase() === fromDomain),
  );
  if (funder) return { kind: "funder", funderId: funder.id, funderName: funder.name };
  return { kind: "external" };
}

/** Lenders addressed by a hand-sent submission (To + CC), matched by domain, in order. */
export function fundersAddressed(
  m: Pick<InboundEmail, "to" | "cc">,
  funders: FunderDomains[],
): FunderDomains[] {
  const out: FunderDomains[] = [];
  for (const addr of [...m.to, ...m.cc]) {
    const f = funders.find((x) => x.emailDomains.includes(domainOf(addr)));
    if (f && !out.includes(f)) out.push(f);
  }
  return out;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\b(llc|inc|corp|co|ltd|l\.l\.c)\b\.?/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** True when a merchant name appears in an email subject (ignores LLC/Inc and punctuation). */
export function subjectMentions(subject: string, names: (string | null)[]): boolean {
  const s = ` ${norm(subject)} `;
  return names.some((n) => {
    const k = n ? norm(n) : "";
    return k.length >= 3 && s.includes(` ${k} `);
  });
}
