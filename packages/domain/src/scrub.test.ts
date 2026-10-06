import { describe, expect, it } from "vitest";
import { scrubStatements, type ScrubRow } from "./scrub";

function row(month: string, o: Partial<ScrubRow> = {}): ScrubRow {
  const beginningBalance = o.beginningBalance ?? 10_000;
  const totalDeposits = o.totalDeposits ?? 50_000;
  const totalWithdrawals = o.totalWithdrawals ?? 48_000;
  return {
    month,
    accountLast4: "1234",
    beginningBalance,
    endingBalance: beginningBalance + totalDeposits - totalWithdrawals,
    totalDeposits,
    depositCount: 60,
    totalWithdrawals,
    nonRevenueDeposits: 0,
    averageDailyBalance: 8_000,
    nsfCount: 0,
    overdraftFeeCount: 0,
    negativeDays: 0,
    minDailyBalance: 2_000,
    isComplete: true,
    ...o,
  };
}

/** Four clean, continuous months. */
function clean(): ScrubRow[] {
  const out: ScrubRow[] = [];
  let bal = 10_000;
  for (const m of ["2026-05", "2026-06", "2026-07", "2026-08"]) {
    const r = row(m, { beginningBalance: bal });
    out.push(r);
    bal = r.endingBalance;
  }
  return out;
}

const codes = (r: ReturnType<typeof scrubStatements>) => r.flags.map((f) => f.code);

describe("scrubStatements", () => {
  it("passes a clean, continuous pack with no flags", () => {
    const r = scrubStatements(clean(), { asOf: new Date("2026-09-15") });
    expect(r.flags).toEqual([]);
    expect(r.latestMonth).toBe("2026-08");
    expect(r.months).toHaveLength(4);
    expect(r.months.every((m) => m.reconciliationGap === 0)).toBe(true);
  });

  it("catches figures that do not add up and balances that jump between months", () => {
    const rows = clean();
    rows[1] = { ...rows[1]!, endingBalance: rows[1]!.endingBalance + 900 }; // edited ending balance
    const r = scrubStatements(rows);
    expect(r.flags.filter((f) => f.code === "BALANCE_MISMATCH")).toMatchObject([
      { severity: "critical", month: "2026-06" },
    ]);
    expect(r.flags.find((f) => f.code === "BALANCE_JUMP")).toMatchObject({
      month: "2026-07",
      severity: "critical",
    });
    // Critical flags come first.
    expect(r.flags[0]!.severity).toBe("critical");
  });

  it("reports missing and duplicate months", () => {
    const rows = clean().filter((x) => x.month !== "2026-06");
    rows.push(row("2026-08"));
    const r = scrubStatements(rows);
    expect(r.missingMonths).toEqual(["2026-06"]);
    expect(codes(r)).toContain("DUPLICATE_MONTH");
  });

  it("flags NSFs, negative days, thin balances and falling revenue", () => {
    const rows = clean();
    rows[3] = {
      ...rows[3]!,
      nsfCount: 9,
      negativeDays: 6,
      totalDeposits: 20_000,
      totalWithdrawals: 18_000,
      endingBalance: rows[3]!.beginningBalance + 2_000,
    };
    for (const r of rows) r.averageDailyBalance = 1_000;
    const r = scrubStatements(rows);
    expect(r.flags.find((f) => f.code === "NSF")).toMatchObject({
      severity: "critical",
      month: "2026-08",
    });
    expect(r.flags.find((f) => f.code === "NEGATIVE_DAYS")).toMatchObject({ severity: "warning" });
    expect(codes(r)).toContain("LOW_BALANCES");
    expect(r.flags.find((f) => f.code === "DECLINING_REVENUE")).toMatchObject({
      severity: "critical",
    });
  });

  it("measures existing advances against revenue and spots new funding (stacking)", () => {
    const rows = clean();
    rows[3] = {
      ...rows[3]!,
      nonRevenueDeposits: 15_000,
      nonRevenueDepositNotes: ["08/20 WIRE IN SAMPLE CAPITAL FUNDING 15,000.00"],
      recurringDebits: [
        {
          descriptor: "SAMPLE CAP ACH",
          amount: 400,
          frequency: "daily",
          occurrences: 21,
          firstDate: "2026-05-01",
          lastDate: "2026-08-29",
          looksLikeFinancing: true,
        },
        {
          descriptor: "NEWCO FUNDING",
          amount: 1_000,
          frequency: "weekly",
          occurrences: 2,
          firstDate: "2026-08-15",
          lastDate: "2026-08-29",
          looksLikeFinancing: true,
        },
        {
          descriptor: "ADP PAYROLL",
          amount: 5_000,
          frequency: "biweekly",
          occurrences: 2,
          firstDate: "2026-05-01",
          lastDate: "2026-08-29",
          looksLikeFinancing: false,
        },
      ],
    };
    const r = scrubStatements(rows);
    expect(r.financing.map((f) => f.descriptor)).toEqual(["SAMPLE CAP ACH", "NEWCO FUNDING"]);
    expect(r.monthlyFinancingPayments).toBe(400 * 21 + 1000 * 4.33);
    expect(r.flags.find((f) => f.code === "HOLDBACK_BURDEN")).toBeDefined();
    expect(r.flags.find((f) => f.code === "NEW_POSITION")!.message).toContain("NEWCO FUNDING");
    expect(r.flags.find((f) => f.code === "NEW_FUNDING")).toMatchObject({
      severity: "critical",
      month: "2026-08",
    });
  });

  it("asks for fresh statements when the latest one is old", () => {
    expect(codes(scrubStatements(clean(), { asOf: new Date("2026-12-01") }))).toContain(
      "STALE_STATEMENTS",
    );
  });
});
