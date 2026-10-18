import { describe, expect, it } from "vitest";
import { lastBackupCheck, percentile, summarizeUsage } from "./serverUsage";

const now = 1_800_000_000;
const lines = (rows: [number, number][]) =>
  rows.map(([cpu, mem], i) => `${now - (rows.length - i) * 60} ${cpu} ${mem}`).join("\n");

describe("idle risk (Oracle's 7-day rule)", () => {
  it("is low when memory stays clearly above 20% even with an idle CPU", () => {
    const u = summarizeUsage(
      lines(Array.from({ length: 100 }, () => [2, 28] as [number, number])),
      now,
    );
    expect(u).toMatchObject({ samples: 100, cpuP95: 2, memMin: 28, idleRisk: "low" });
  });

  it("is high when CPU and memory both stay under 20%", () => {
    const u = summarizeUsage(
      lines(Array.from({ length: 100 }, () => [3, 12] as [number, number])),
      now,
    );
    expect(u.idleRisk).toBe("high");
  });

  it("watches when the best measure is just over the line, and ignores samples older than 7 days", () => {
    const old = `${now - 8 * 86_400} 90 90\n`;
    const u = summarizeUsage(
      old +
        lines([
          [1, 21],
          [1, 22],
          [1, 23],
        ]),
      now,
    );
    expect(u).toMatchObject({ samples: 3, idleRisk: "watch" });
    expect(summarizeUsage("", now).idleRisk).toBe("unknown");
  });

  it("uses the 95th percentile for CPU", () => {
    expect(percentile([...Array(95).fill(1), ...Array(5).fill(50)], 95)).toBe(1);
    expect(percentile([...Array(94).fill(1), ...Array(6).fill(50)], 95)).toBe(50);
  });
});

describe("backup check", () => {
  it("reads the latest nightly result", () => {
    const text =
      '{"at":"2026-10-17T03:31:00Z","ok":false,"detail":"restore failed"}\n' +
      '{"at":"2026-10-18T03:31:00Z","ok":true,"detail":"integrity ok"}\n';
    expect(lastBackupCheck(text)).toEqual({
      at: "2026-10-18T03:31:00Z",
      ok: true,
      detail: "integrity ok",
    });
    expect(lastBackupCheck("")).toBeNull();
  });
});
