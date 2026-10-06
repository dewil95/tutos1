import type { MonthlyRow } from "./bankMetrics";
import { round, roundCents } from "./money";

/**
 * Bank scrub: the checks a processor does by eye on every statement pack, done in code on the
 * rows AI job A1 extracted. Everything here is arithmetic on the extracted numbers, so each flag
 * can be explained and re-checked against the PDF.
 */

export interface ScrubDebit {
  descriptor: string;
  amount: number;
  frequency: "daily" | "weekly" | "biweekly" | "monthly" | "irregular";
  occurrences: number;
  firstDate: string;
  lastDate: string;
  looksLikeFinancing: boolean;
}

export interface ScrubRow extends MonthlyRow {
  recurringDebits?: ScrubDebit[];
  nonRevenueDepositNotes?: string[];
}

export type FlagSeverity = "info" | "warning" | "critical";

export interface ScrubFlag {
  code:
    | "BALANCE_MISMATCH"
    | "BALANCE_JUMP"
    | "MISSING_MONTH"
    | "DUPLICATE_MONTH"
    | "INCOMPLETE_MONTH"
    | "MULTIPLE_ACCOUNTS"
    | "NSF"
    | "NEGATIVE_DAYS"
    | "LOW_BALANCES"
    | "DECLINING_REVENUE"
    | "HIGH_NON_REVENUE"
    | "HOLDBACK_BURDEN"
    | "NEW_FUNDING"
    | "NEW_POSITION"
    | "STALE_STATEMENTS";
  severity: FlagSeverity;
  message: string;
  month?: string;
}

export interface ScrubMonth {
  month: string;
  accountLast4: string | null;
  deposits: number;
  trueRevenue: number;
  depositCount: number;
  averageDailyBalance: number;
  endingBalance: number;
  nsfCount: number;
  negativeDays: number;
  /** beginning + deposits − withdrawals − ending; should be ~0 */
  reconciliationGap: number;
  isComplete: boolean;
}

export interface FinancingDebit {
  descriptor: string;
  frequency: ScrubDebit["frequency"];
  amount: number;
  /** Normalised to a calendar month. */
  monthlyAmount: number;
  firstDate: string;
  lastDate: string;
  active: boolean;
}

export interface ScrubReport {
  months: ScrubMonth[];
  flags: ScrubFlag[];
  missingMonths: string[];
  financing: FinancingDebit[];
  /** Active financing debits per month ÷ average monthly true revenue. */
  holdbackBurdenPct: number;
  monthlyFinancingPayments: number;
  latestMonth: string | null;
}

const PER_MONTH: Record<ScrubDebit["frequency"], number> = {
  daily: 21,
  weekly: 4.33,
  biweekly: 2.17,
  monthly: 1,
  irregular: 1,
};

const FUNDING_WORDS =
  /\b(fund(ing|ed)?|capital|advance|lending|lender|loan|mca|financ(e|ial|ing))\b/i;

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const pct = (n: number) => `${Math.round(n * 100)}%`;

export function nextMonth(m: string): string {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}

function monthsBetween(a: string, b: string): number {
  const [ya, ma] = a.split("-").map(Number) as [number, number];
  const [yb, mb] = b.split("-").map(Number) as [number, number];
  return (yb - ya) * 12 + (mb - ma);
}

export function scrubStatements(rowsIn: ScrubRow[], opts: { asOf?: Date } = {}): ScrubReport {
  const flags: ScrubFlag[] = [];
  const rows = [...rowsIn].sort(
    (a, b) =>
      a.month.localeCompare(b.month) || (a.accountLast4 ?? "").localeCompare(b.accountLast4 ?? ""),
  );
  if (rows.length === 0) {
    return {
      months: [],
      flags,
      missingMonths: [],
      financing: [],
      holdbackBurdenPct: 0,
      monthlyFinancingPayments: 0,
      latestMonth: null,
    };
  }

  const accounts = [...new Set(rows.map((r) => r.accountLast4 ?? "?"))];
  if (accounts.length > 1) {
    flags.push({
      code: "MULTIPLE_ACCOUNTS",
      severity: "info",
      message: `Statements cover ${accounts.length} accounts (${accounts.map((a) => `…${a}`).join(", ")}); revenue is summed per month.`,
    });
  }

  const months: ScrubMonth[] = rows.map((r) => {
    const gap = roundCents(
      r.beginningBalance + r.totalDeposits - r.totalWithdrawals - r.endingBalance,
    );
    return {
      month: r.month,
      accountLast4: r.accountLast4 ?? null,
      deposits: r.totalDeposits,
      trueRevenue: roundCents(Math.max(0, r.totalDeposits - r.nonRevenueDeposits)),
      depositCount: r.depositCount,
      averageDailyBalance: r.averageDailyBalance,
      endingBalance: r.endingBalance,
      nsfCount: r.nsfCount,
      negativeDays: r.negativeDays,
      reconciliationGap: gap,
      isComplete: r.isComplete,
    };
  });

  // Per-account checks: reconciliation, continuity, gaps, duplicates.
  const missingMonths: string[] = [];
  for (const acct of accounts) {
    const list = rows.filter((r) => (r.accountLast4 ?? "?") === acct);
    const seen = new Set<string>();
    list.forEach((r, i) => {
      const label = accounts.length > 1 ? `${r.month} (…${acct})` : r.month;
      if (seen.has(r.month)) {
        flags.push({
          code: "DUPLICATE_MONTH",
          severity: "warning",
          month: r.month,
          message: `${label} appears twice; only one statement per month should be counted.`,
        });
      }
      seen.add(r.month);
      const gap = Math.abs(
        r.beginningBalance + r.totalDeposits - r.totalWithdrawals - r.endingBalance,
      );
      if (gap > 5) {
        flags.push({
          code: "BALANCE_MISMATCH",
          severity: gap > 500 ? "critical" : "warning",
          month: r.month,
          message: `${label}: beginning + deposits − withdrawals is off from the ending balance by ${money(gap)}. Missing pages or edited figures.`,
        });
      }
      if (!r.isComplete) {
        flags.push({
          code: "INCOMPLETE_MONTH",
          severity: "warning",
          month: r.month,
          message: `${label} is partial or has missing pages.`,
        });
      }
      const prev = list[i - 1];
      if (prev && prev.month !== r.month) {
        if (
          monthsBetween(prev.month, r.month) === 1 &&
          Math.abs(prev.endingBalance - r.beginningBalance) > 1
        ) {
          flags.push({
            code: "BALANCE_JUMP",
            severity: "critical",
            month: r.month,
            message: `${label} opens at ${money(r.beginningBalance)} but the prior month closed at ${money(prev.endingBalance)}. Check for an altered statement or a different account.`,
          });
        }
        for (let m = nextMonth(prev.month); m < r.month; m = nextMonth(m)) {
          missingMonths.push(m);
          flags.push({
            code: "MISSING_MONTH",
            severity: "warning",
            month: m,
            message: `No statement for ${m}${accounts.length > 1 ? ` (…${acct})` : ""}.`,
          });
        }
      }
    });
  }

  // Per-month totals across accounts.
  const byMonth = new Map<string, ScrubMonth[]>();
  for (const m of months) byMonth.set(m.month, [...(byMonth.get(m.month) ?? []), m]);
  const monthKeys = [...byMonth.keys()].sort();
  const sum = (k: string, f: (m: ScrubMonth) => number) =>
    (byMonth.get(k) ?? []).reduce((a, m) => a + f(m), 0);
  const revenue = monthKeys.map((k) => sum(k, (m) => m.trueRevenue));
  const deposits = monthKeys.map((k) => sum(k, (m) => m.deposits));
  const avgRevenue = revenue.reduce((a, b) => a + b, 0) / revenue.length;
  const latestMonth = monthKeys[monthKeys.length - 1]!;

  for (const k of monthKeys) {
    const nsf = sum(k, (m) => m.nsfCount);
    if (nsf > 3)
      flags.push({
        code: "NSF",
        severity: nsf > 8 ? "critical" : "warning",
        month: k,
        message: `${nsf} NSF / returned items in ${k}.`,
      });
    const neg = sum(k, (m) => m.negativeDays);
    if (neg > 5)
      flags.push({
        code: "NEGATIVE_DAYS",
        severity: neg > 10 ? "critical" : "warning",
        month: k,
        message: `${neg} negative days in ${k}.`,
      });
  }

  const totalDeposits = deposits.reduce((a, b) => a + b, 0);
  const avgAdb = rows.reduce((a, r) => a + r.averageDailyBalance, 0) / rows.length;
  const avgDeposits = totalDeposits / monthKeys.length;
  if (avgDeposits > 0 && avgAdb / avgDeposits < 0.05) {
    flags.push({
      code: "LOW_BALANCES",
      severity: avgAdb <= 0 ? "critical" : "warning",
      message: `Average daily balance ${money(avgAdb)} is ${pct(avgAdb / avgDeposits)} of monthly deposits (funders look for 5%+).`,
    });
  }

  if (revenue.length >= 3) {
    const last = revenue[revenue.length - 1]!;
    const prior = revenue.slice(0, -1);
    const priorAvg = prior.reduce((a, b) => a + b, 0) / prior.length;
    if (priorAvg > 0 && last < priorAvg * 0.7) {
      flags.push({
        code: "DECLINING_REVENUE",
        severity: last < priorAvg * 0.5 ? "critical" : "warning",
        month: latestMonth,
        message: `True revenue in ${latestMonth} (${money(last)}) is ${pct(1 - last / priorAvg)} below the prior average (${money(priorAvg)}).`,
      });
    }
  }

  const nonRevenue = rows.reduce((a, r) => a + r.nonRevenueDeposits, 0);
  if (totalDeposits > 0 && nonRevenue / totalDeposits > 0.3) {
    flags.push({
      code: "HIGH_NON_REVENUE",
      severity: "warning",
      message: `${pct(nonRevenue / totalDeposits)} of deposits are transfers, loans or other non-revenue (${money(nonRevenue)}).`,
    });
  }

  // Financing debits (existing positions) and holdback burden.
  const financing: FinancingDebit[] = [];
  const seenDebit = new Set<string>();
  for (const r of rows) {
    for (const d of r.recurringDebits ?? []) {
      if (!d.looksLikeFinancing) continue;
      const key = `${d.descriptor.toUpperCase().replace(/\s+/g, " ")}|${d.amount}`;
      if (seenDebit.has(key)) continue;
      seenDebit.add(key);
      financing.push({
        descriptor: d.descriptor,
        frequency: d.frequency,
        amount: d.amount,
        monthlyAmount: roundCents(d.amount * PER_MONTH[d.frequency]),
        firstDate: d.firstDate,
        lastDate: d.lastDate,
        active: d.lastDate.slice(0, 7) >= latestMonth,
      });
    }
  }
  const monthlyFinancingPayments = roundCents(
    financing.filter((f) => f.active).reduce((a, f) => a + f.monthlyAmount, 0),
  );
  const holdbackBurdenPct = avgRevenue > 0 ? round(monthlyFinancingPayments / avgRevenue, 4) : 0;
  if (holdbackBurdenPct > 0.2) {
    flags.push({
      code: "HOLDBACK_BURDEN",
      severity: holdbackBurdenPct > 0.35 ? "critical" : "warning",
      message: `Existing advances take about ${pct(holdbackBurdenPct)} of true revenue (${money(monthlyFinancingPayments)}/month).`,
    });
  }
  for (const f of financing.filter((x) => x.active && x.firstDate.slice(0, 7) >= latestMonth)) {
    flags.push({
      code: "NEW_POSITION",
      severity: "warning",
      month: latestMonth,
      message: `New recurring payment started ${f.firstDate}: ${f.descriptor} ${money(f.amount)} ${f.frequency}.`,
    });
  }

  // Funding wires in the latest month (stacking right before applying).
  for (const r of rows.filter((x) => x.month === latestMonth)) {
    const notes = (r.nonRevenueDepositNotes ?? []).filter((n) => FUNDING_WORDS.test(n));
    if (notes.length) {
      flags.push({
        code: "NEW_FUNDING",
        severity: "critical",
        month: latestMonth,
        message: `Looks like new financing deposited in ${latestMonth}: ${notes.join("; ")}.`,
      });
    }
  }

  if (opts.asOf) {
    const asOf = `${opts.asOf.getUTCFullYear()}-${String(opts.asOf.getUTCMonth() + 1).padStart(2, "0")}`;
    const age = monthsBetween(latestMonth, asOf);
    if (age > 2) {
      flags.push({
        code: "STALE_STATEMENTS",
        severity: "warning",
        message: `Latest statement is ${latestMonth}; funders will want the last full month and an MTD.`,
      });
    }
  }

  const order: Record<FlagSeverity, number> = { critical: 0, warning: 1, info: 2 };
  flags.sort(
    (a, b) => order[a.severity] - order[b.severity] || (a.month ?? "").localeCompare(b.month ?? ""),
  );
  return {
    months,
    flags,
    missingMonths,
    financing,
    holdbackBurdenPct,
    monthlyFinancingPayments,
    latestMonth,
  };
}
