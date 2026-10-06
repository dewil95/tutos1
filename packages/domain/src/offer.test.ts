import { describe, expect, it } from "vitest";
import {
  computeOffer,
  estimateAdvanceRange,
  estimateApr,
  paymentFromHoldback,
  solvePeriodicRate,
} from "./offer";

describe("computeOffer", () => {
  it("computes the classic broker example: $37,500 at 1.35 over 6 months daily", () => {
    const o = computeOffer({
      advanceAmount: 37_500,
      buyRate: 1.25,
      sellRate: 1.35,
      frequency: "DAILY",
      termMonths: 6,
    });
    expect(o.paybackAmount).toBe(50_625);
    expect(o.numberOfPayments).toBe(126);
    expect(o.paymentAmount).toBe(401.79);
    expect(o.commissionPoints).toBe(10);
    expect(o.commissionAmount).toBe(3_750);
    expect(o.netToMerchant).toBe(37_500);
    expect(o.costOfCapital).toBe(13_125);
    expect(o.estimatedApr).not.toBeNull();
    // Daily payments over 6 months at 1.35 are roughly 120%+ APR
    expect(o.estimatedApr!).toBeGreaterThan(1.1);
    expect(o.estimatedApr!).toBeLessThan(1.5);
  });

  it("derives term from numberOfPayments for weekly schedules", () => {
    const o = computeOffer({
      advanceAmount: 100_000,
      buyRate: 1.18,
      sellRate: 1.3,
      frequency: "WEEKLY",
      numberOfPayments: 40,
      originationFee: 2_500,
      psfAmount: 3_000,
    });
    expect(o.termMonths).toBeCloseTo(9.23, 2);
    expect(o.paybackAmount).toBe(130_000);
    expect(o.paymentAmount).toBe(3_250);
    expect(o.commissionPoints).toBe(12);
    expect(o.netToMerchant).toBe(94_500);
    expect(o.costOfCapital).toBe(35_500);
  });

  it("rejects a sell rate below the buy rate", () => {
    expect(() =>
      computeOffer({
        advanceAmount: 10_000,
        buyRate: 1.3,
        sellRate: 1.2,
        frequency: "DAILY",
        termMonths: 4,
      }),
    ).toThrow(/sellRate/);
  });

  it("requires a term or payment count", () => {
    expect(() =>
      computeOffer({ advanceAmount: 10_000, buyRate: 1.2, sellRate: 1.3, frequency: "DAILY" }),
    ).toThrow(/termMonths/);
  });
});

describe("APR solver", () => {
  it("returns 0 when payback equals principal", () => {
    expect(solvePeriodicRate(1000, 100, 10)).toBe(0);
  });

  it("matches a known monthly amortisation: $10,000, 12 × $888.49 ≈ 12% APR", () => {
    const apr = estimateApr(10_000, 888.49, 12, "MONTHLY");
    expect(apr).not.toBeNull();
    expect(apr!).toBeCloseTo(0.12, 3);
  });

  it("returns null for impossible inputs", () => {
    expect(solvePeriodicRate(0, 10, 5)).toBeNull();
    expect(solvePeriodicRate(100, -1, 5)).toBeNull();
  });
});

describe("paymentFromHoldback", () => {
  it("converts a 15% holdback on $50K/mo into a daily payment", () => {
    // 50,000 * 15% = 7,500/mo -> 90,000/yr / 252 days
    expect(paymentFromHoldback(50_000, 15, "DAILY")).toBe(357.14);
    expect(paymentFromHoldback(50_000, 15, "WEEKLY")).toBe(1_730.77);
  });
});

describe("estimateAdvanceRange", () => {
  it("sizes a clean first-position A-paper file around 0.75–1.5x deposits", () => {
    const r = estimateAdvanceRange({
      avgMonthlyDeposits: 50_000,
      annualRevenue: 600_000,
      position: 1,
      paperGrade: "A",
    });
    expect(r.low).toBe(37_500);
    expect(r.high).toBe(75_000);
    expect(r.factorLow).toBe(1.15);
    expect(r.termMonthsHigh).toBe(18);
  });

  it("shrinks size and bumps factor for a third position C-paper file", () => {
    const r = estimateAdvanceRange({ avgMonthlyDeposits: 50_000, position: 3, paperGrade: "C" });
    expect(r.high).toBeLessThan(50_000 * 0.9);
    expect(r.factorLow).toBeCloseTo(1.51, 2);
    expect(r.low).toBeLessThanOrEqual(r.high);
  });

  it("caps at 25% of annual revenue", () => {
    const r = estimateAdvanceRange({
      avgMonthlyDeposits: 100_000,
      annualRevenue: 200_000,
      position: 1,
      paperGrade: "A",
    });
    expect(r.high).toBe(50_000);
  });
});
