import type { Recipients } from "./types";

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/;

export function normalizeEmail(raw: string): string {
  return raw
    .trim()
    .replace(/^mailto:/i, "")
    .toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  return EMAIL_RE.test(normalizeEmail(raw));
}

/** Splits "a@x.com; b@x.com, c@x.com" style cells into clean addresses. */
export function splitEmails(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[;,\s]+/)
    .map(normalizeEmail)
    .filter(Boolean);
}

export interface LenderAddresses {
  /** Ordered: the first address is the lender's main submission inbox. */
  emails: string[];
}

export interface BuildRecipientsOptions {
  /** Ascend team members copied on every submission (e.g. jonas@, savvy@, david@). */
  teamCc?: string[];
  /** The sending mailbox; never copied to itself. */
  from?: string;
}

/**
 * Ascend's rule for one lender: the first address goes in To, every other address of that
 * lender goes in CC, then the team. No BCC. Addresses are de-duplicated case-insensitively.
 */
export function buildRecipients(
  lender: LenderAddresses,
  opts: BuildRecipientsOptions = {},
): Recipients {
  const seen = new Set<string>();
  const from = opts.from ? normalizeEmail(opts.from) : null;
  const take = (raw: string): string | null => {
    const e = normalizeEmail(raw);
    if (!e || seen.has(e) || e === from) return null;
    if (!isValidEmail(e)) throw new Error(`invalid email address: "${raw}"`);
    seen.add(e);
    return e;
  };

  const lenderEmails = lender.emails.map(take).filter((e): e is string => e !== null);
  const [first, ...rest] = lenderEmails;
  if (!first) throw new Error("lender has no submission email address");

  const team = (opts.teamCc ?? []).map(take).filter((e): e is string => e !== null);
  return { to: [first], cc: [...rest, ...team] };
}

export interface LenderTarget extends LenderAddresses {
  funderId: string;
  funderName: string;
}

export interface PlannedSubmission {
  funderId: string;
  funderName: string;
  recipients: Recipients;
}

/**
 * One planned email per lender. Throws before anything is sent if any lender is misconfigured,
 * so a bad row never results in a half-sent batch.
 */
export function planSubmissions(
  lenders: LenderTarget[],
  opts: BuildRecipientsOptions = {},
): PlannedSubmission[] {
  const ids = new Set<string>();
  return lenders.map((l) => {
    if (ids.has(l.funderId)) throw new Error(`lender ${l.funderName} selected twice`);
    ids.add(l.funderId);
    return { funderId: l.funderId, funderName: l.funderName, recipients: buildRecipients(l, opts) };
  });
}
