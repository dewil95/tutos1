import { round, roundCents } from "./money";

/**
 * One month of a business bank statement as extracted by AI job A1 and verified by a human.
 * Mirrors `MonthlyRowSchema` in @mca/ai; kept structural here so domain has no AI dependency.
 */
export interface MonthlyRow {
  /** YYYY-MM */
  month: string;
  bankName?: string | null;
  accountLast4?: string | null;
  beginningBalance: number;
  endingBalance: number;
  totalDeposits: number;
  depositCount: number;
  totalWithdrawals: number;
  /** Deposits that are not revenue: internal transfers in, loan/MCA proceeds, owner injections */
  nonRevenueDeposits: number;
  averageDailyBalance: number;
  nsfCount: number;
  overdraftFeeCount: number;
  negativeDays: number;
  /** Lowest end-of-day balance in the month */
  minDailyBalance: number;
  /** Whether the statement covers the full calendar month (all pages present) */
  isComplete: boolean;
}

export interface BankMetrics {
  monthsAnalysed: number;
  avgMonthlyDeposits: number;
  avgMonthlyTrueRevenue: number;
  avgDepositCount: number;
  avgDailyBalance: number;
  adbToDepositsRatio: number;
  totalNsf: number;
  nsfPer90Days: number;
  totalNegativeDays: number;
  minDailyBalance: number;
  /** Linear trend of true revenue, as fraction of mean per month (0.05 = +5%/month) */
  revenueTrend: number;
  /** Coefficient of variation of monthly true revenue (lower = steadier) */
  depositVolatility: number;
  incompleteMonths: string[];
  annualisedTrueRevenue: number;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** Slope of least-squares line through (index, value), normalised by mean value. */
function trend(xs: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  if (m === 0) return 0;
  const xMean = (n - 1) / 2;
  let num = 0;
  let den = 0;
  xs.forEach((y, i) => {
    num += (i - xMean) * (y - m);
    den += (i - xMean) ** 2;
  });
  return den === 0 ? 0 : round(num / den / m, 4);
}

export function computeBankMetrics(rowsIn: MonthlyRow[]): BankMetrics {
  if (rowsIn.length === 0) throw new Error("at least one monthly row is required");
  const rows = [...rowsIn].sort((a, b) => a.month.localeCompare(b.month));
  const deposits = rows.map((r) => r.totalDeposits);
  const trueRevenue = rows.map((r) => Math.max(0, r.totalDeposits - r.nonRevenueDeposits));
  const avgMonthlyDeposits = mean(deposits);
  const avgMonthlyTrueRevenue = mean(trueRevenue);
  const avgDailyBalance = mean(rows.map((r) => r.averageDailyBalance));
  const totalNsf = rows.reduce((a, r) => a + r.nsfCount, 0);
  const days = rows.length * 30;

  return {
    monthsAnalysed: rows.length,
    avgMonthlyDeposits: roundCents(avgMonthlyDeposits),
    avgMonthlyTrueRevenue: roundCents(avgMonthlyTrueRevenue),
    avgDepositCount: round(mean(rows.map((r) => r.depositCount)), 1),
    avgDailyBalance: roundCents(avgDailyBalance),
    adbToDepositsRatio: avgMonthlyDeposits > 0 ? round(avgDailyBalance / avgMonthlyDeposits, 4) : 0,
    totalNsf,
    nsfPer90Days: round((totalNsf / days) * 90, 2),
    totalNegativeDays: rows.reduce((a, r) => a + r.negativeDays, 0),
    minDailyBalance: roundCents(Math.min(...rows.map((r) => r.minDailyBalance))),
    revenueTrend: trend(trueRevenue),
    depositVolatility:
      avgMonthlyTrueRevenue > 0 ? round(stddev(trueRevenue) / avgMonthlyTrueRevenue, 4) : 0,
    incompleteMonths: rows.filter((r) => !r.isComplete).map((r) => r.month),
    annualisedTrueRevenue: roundCents(avgMonthlyTrueRevenue * 12),
  };
}
