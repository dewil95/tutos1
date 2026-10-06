import { roundCents, round } from "./money";

export type PaymentFrequency = "DAILY" | "WEEKLY" | "BIWEEKLY" | "MONTHLY";

/** Business-day based payments per year used across the industry. */
export const PAYMENTS_PER_YEAR: Record<PaymentFrequency, number> = {
  DAILY: 252,
  WEEKLY: 52,
  BIWEEKLY: 26,
  MONTHLY: 12,
};

/** Business days per month (252 / 12). */
export const BUSINESS_DAYS_PER_MONTH = 21;

export interface OfferInput {
  advanceAmount: number;
  /** Factor the funder quotes at zero commission, e.g. 1.18 */
  buyRate: number;
  /** Factor presented to merchant; commission points = (sellRate - buyRate) * 100 */
  sellRate: number;
  frequency: PaymentFrequency;
  /** Either termMonths or numberOfPayments must be given. */
  termMonths?: number;
  numberOfPayments?: number;
  originationFee?: number;
  otherFees?: number;
  /** Broker professional service fee charged to merchant, if any. */
  psfAmount?: number;
}

export interface OfferTerms {
  advanceAmount: number;
  buyRate: number;
  sellRate: number;
  paybackAmount: number;
  frequency: PaymentFrequency;
  numberOfPayments: number;
  termMonths: number;
  paymentAmount: number;
  /** points = (sell - buy) * 100, 1 point = 1% of advance */
  commissionPoints: number;
  commissionAmount: number;
  totalFees: number;
  psfAmount: number;
  netToMerchant: number;
  /** Total cost of capital in dollars (payback - advance + fees + psf) */
  costOfCapital: number;
  /** Simple annualised rate, as decimal (0.42 = 42%). Used for quick comparisons. */
  annualisedCostRate: number;
  /**
   * Estimated APR as decimal, computed by IRR over the periodic payment schedule — the
   * methodology CA DFPI / NY DFS disclosures require for sales-based financing with a fixed
   * payment. Null if the schedule cannot be solved.
   */
  estimatedApr: number | null;
}

function paymentsForTerm(termMonths: number, frequency: PaymentFrequency): number {
  switch (frequency) {
    case "DAILY":
      return Math.round(termMonths * BUSINESS_DAYS_PER_MONTH);
    case "WEEKLY":
      return Math.round((termMonths * 52) / 12);
    case "BIWEEKLY":
      return Math.round((termMonths * 26) / 12);
    case "MONTHLY":
      return Math.round(termMonths);
  }
}

function termForPayments(numberOfPayments: number, frequency: PaymentFrequency): number {
  return round((numberOfPayments / PAYMENTS_PER_YEAR[frequency]) * 12, 2);
}

/**
 * Periodic IRR for: receive `principal` today, pay `payment` for `n` periods.
 * Returns the periodic rate, or null if it does not converge.
 */
export function solvePeriodicRate(principal: number, payment: number, n: number): number | null {
  if (principal <= 0 || payment <= 0 || n <= 0) return null;
  if (payment * n <= principal) return 0;
  // Newton-Raphson on f(r) = payment * (1 - (1+r)^-n) / r - principal
  let r = (payment * n - principal) / principal / n; // reasonable starting guess
  for (let i = 0; i < 100; i++) {
    const pow = Math.pow(1 + r, -n);
    const f = (payment * (1 - pow)) / r - principal;
    const df = (payment * (n * pow * Math.pow(1 + r, -1) * r - (1 - pow))) / (r * r);
    const next = r - f / df;
    if (!Number.isFinite(next) || next <= 0) return null;
    if (Math.abs(next - r) < 1e-12) return next;
    r = next;
  }
  return null;
}

/** Nominal APR = periodic rate × periods per year (the disclosure-law convention). */
export function estimateApr(
  netProceeds: number,
  paymentAmount: number,
  numberOfPayments: number,
  frequency: PaymentFrequency,
): number | null {
  const periodic = solvePeriodicRate(netProceeds, paymentAmount, numberOfPayments);
  if (periodic === null) return null;
  return round(periodic * PAYMENTS_PER_YEAR[frequency], 4);
}

export function computeOffer(input: OfferInput): OfferTerms {
  if (input.advanceAmount <= 0) throw new Error("advanceAmount must be positive");
  if (input.buyRate < 1 || input.sellRate < 1) throw new Error("factor rates must be >= 1.0");
  if (input.sellRate < input.buyRate) throw new Error("sellRate cannot be below buyRate");

  let numberOfPayments: number;
  let termMonths: number;
  if (input.numberOfPayments !== undefined) {
    numberOfPayments = input.numberOfPayments;
    termMonths = termForPayments(numberOfPayments, input.frequency);
  } else if (input.termMonths !== undefined) {
    termMonths = input.termMonths;
    numberOfPayments = paymentsForTerm(termMonths, input.frequency);
  } else {
    throw new Error("termMonths or numberOfPayments is required");
  }
  if (numberOfPayments <= 0) throw new Error("numberOfPayments must be positive");

  const paybackAmount = roundCents(input.advanceAmount * input.sellRate);
  const paymentAmount = roundCents(paybackAmount / numberOfPayments);
  const commissionPoints = round((input.sellRate - input.buyRate) * 100, 2);
  const commissionAmount = roundCents(input.advanceAmount * (commissionPoints / 100));
  const totalFees = roundCents((input.originationFee ?? 0) + (input.otherFees ?? 0));
  const psfAmount = roundCents(input.psfAmount ?? 0);
  const netToMerchant = roundCents(input.advanceAmount - totalFees - psfAmount);
  const costOfCapital = roundCents(paybackAmount - input.advanceAmount + totalFees + psfAmount);
  const years = termMonths / 12;
  const annualisedCostRate = years > 0 ? round(costOfCapital / netToMerchant / years, 4) : 0;
  const estimatedApr = estimateApr(netToMerchant, paymentAmount, numberOfPayments, input.frequency);

  return {
    advanceAmount: roundCents(input.advanceAmount),
    buyRate: input.buyRate,
    sellRate: input.sellRate,
    paybackAmount,
    frequency: input.frequency,
    numberOfPayments,
    termMonths,
    paymentAmount,
    commissionPoints,
    commissionAmount,
    totalFees,
    psfAmount,
    netToMerchant,
    costOfCapital,
    annualisedCostRate,
    estimatedApr,
  };
}

/**
 * Holdback-style estimate: what fixed payment approximates a % of average daily deposits.
 */
export function paymentFromHoldback(
  avgMonthlyDeposits: number,
  holdbackPct: number,
  frequency: PaymentFrequency,
): number {
  const monthlyTake = avgMonthlyDeposits * (holdbackPct / 100);
  const perYear = PAYMENTS_PER_YEAR[frequency];
  return roundCents((monthlyTake * 12) / perYear);
}

export interface AdvanceEstimateInput {
  avgMonthlyDeposits: number;
  annualRevenue?: number;
  /** 1 = first position, 2 = second, ... */
  position: number;
  paperGrade: "A" | "B" | "C" | "D";
}

export interface AdvanceEstimate {
  low: number;
  high: number;
  factorLow: number;
  factorHigh: number;
  termMonthsLow: number;
  termMonthsHigh: number;
}

/**
 * Rule-of-thumb sizing used by brokers before any funder replies (docs/PLAN.md §1 stage 4):
 * first position ≈ 0.75–1.5× avg monthly deposits, capped at 10–25% of annual revenue;
 * each additional position shrinks size and adds ~0.05–0.15 to the factor.
 */
export function estimateAdvanceRange(input: AdvanceEstimateInput): AdvanceEstimate {
  const gradeMultiplier = { A: 1.5, B: 1.2, C: 0.9, D: 0.6 }[input.paperGrade];
  const positionPenalty = Math.max(0, input.position - 1);
  const highMult = Math.max(0.3, gradeMultiplier - positionPenalty * 0.3);
  const lowMult = Math.max(0.2, 0.75 - positionPenalty * 0.2);

  let high = input.avgMonthlyDeposits * highMult;
  let low = input.avgMonthlyDeposits * lowMult;
  if (input.annualRevenue) {
    high = Math.min(high, input.annualRevenue * 0.25);
    low = Math.min(low, input.annualRevenue * 0.1);
  }
  low = Math.min(low, high);

  const baseFactor = { A: [1.15, 1.3], B: [1.25, 1.4], C: [1.35, 1.49], D: [1.45, 1.55] }[
    input.paperGrade
  ] as [number, number];
  const factorBump = positionPenalty * 0.08;
  const termBase = { A: [8, 18], B: [6, 12], C: [4, 9], D: [3, 6] }[input.paperGrade] as [
    number,
    number,
  ];

  return {
    low: roundCents(Math.floor(low / 500) * 500),
    high: roundCents(Math.floor(high / 500) * 500),
    factorLow: round(baseFactor[0] + factorBump, 2),
    factorHigh: round(baseFactor[1] + factorBump, 2),
    termMonthsLow: Math.max(3, termBase[0] - positionPenalty),
    termMonthsHigh: Math.max(3, termBase[1] - positionPenalty * 2),
  };
}
