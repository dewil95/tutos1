/**
 * Parses docs/funder-appetite-matrix.csv into Funder + FunderProgram seed rows. Kept free of
 * Prisma types so it can be unit-tested and reused by an "import lenders" screen later.
 */

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  const [header, ...data] = rows;
  if (!header) return [];
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const list = (v: string | undefined, sep = /[;,]/) =>
  (v ?? "")
    .split(sep)
    .map((s) => s.trim())
    .filter(Boolean);
const num = (v: string | undefined) => (v && !Number.isNaN(Number(v)) ? Number(v) : null);
const emails = (v: string | undefined) => list(v, /[;,\s]+/).map((e) => e.toLowerCase());

export interface FunderSeed {
  name: string;
  submissionTo: string | null;
  submissionCc: string[];
  emailDomains: string[];
  isActive: boolean;
  clawbackDays: number | null;
  backdoorProtection: boolean;
  isoAgreementNotes: string | null;
  program: {
    name: string;
    channel: "EMAIL" | "PORTAL";
    submissionEmail: string | null;
    portalUrl: string | null;
    paperGrades: string[];
    minMonthlyRevenue: number | null;
    minTimeInBusinessMonths: number | null;
    minFico: number | null;
    maxExistingPositions: number | null;
    positionAppetite: string[];
    minAdvance: number | null;
    maxAdvance: number | null;
    maxFactorSell: number | null;
    buyRateFloor: number | null;
    maxPoints: number | null;
    allowedStates: string[];
    excludedStates: string[];
    excludedNaics: string[];
    requiredDocs: string[];
    typicalTurnaroundHours: number | null;
    renewalEligibilityPct: number | null;
    notes: string | null;
  };
}

export function funderSeedsFromCsv(text: string): FunderSeed[] {
  const byName = new Map<string, FunderSeed>();
  for (const r of parseCsv(text)) {
    const name = r.funder_name;
    if (!name) continue;
    const to = emails(r.submission_email)[0] ?? null;
    const cc = emails(r.cc_emails).filter((e) => e !== to);
    const domains = [...new Set([to, ...cc].filter(Boolean).map((e) => e!.split("@")[1]!))];
    // A row that routes through another funder's inbox (e.g. Fundzilla via Mazal) must not be
    // offered as a separate send target, or the same inbox would get the deal twice.
    const routedVia = /\(via ([^)]+)\)/i.exec(name)?.[1] ?? null;
    const notes = [r.reply_style, r.notes].filter(Boolean).join(" | ") || null;
    byName.set(name, {
      name,
      submissionTo: to,
      submissionCc: cc,
      emailDomains: domains,
      isActive: routedVia === null,
      clawbackDays: num(r.clawback_days),
      backdoorProtection: /^y(es)?$/i.test(r.backdoor_protection ?? ""),
      isoAgreementNotes: routedVia
        ? `Receives files through ${routedVia}; do not submit directly.`
        : null,
      program: {
        name: r.program_name || "Core",
        channel: /portal/i.test(r.submission_channel ?? "") && !to ? "PORTAL" : "EMAIL",
        submissionEmail: to,
        portalUrl: r.portal_url || null,
        paperGrades: list(r.paper_grades),
        minMonthlyRevenue: num(r.min_monthly_revenue),
        minTimeInBusinessMonths: num(r.min_time_in_business_months),
        minFico: num(r.min_fico),
        maxExistingPositions: num(r.max_existing_positions),
        positionAppetite: list(r.position_appetite),
        minAdvance: num(r.min_advance),
        maxAdvance: num(r.max_advance),
        maxFactorSell: num(r.max_factor_sell),
        buyRateFloor: num(r.buy_rate_floor),
        maxPoints: num(r.max_points),
        allowedStates: list(r.allowed_states).map((s) => s.toUpperCase()),
        excludedStates: list(r.excluded_states).map((s) => s.toUpperCase()),
        excludedNaics: list(r.excluded_industries_naics),
        requiredDocs: list(r.required_docs),
        typicalTurnaroundHours: num(r.typical_turnaround_hours),
        renewalEligibilityPct: num(r.renewal_eligibility_pct),
        notes,
      },
    });
  }
  return [...byName.values()];
}
