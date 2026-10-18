import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { databasePath } from "@mca/db";

/**
 * Oracle reclaims an Always Free server when, over 7 days, CPU (95th percentile), network and
 * memory all stay under 20%. The server's usage meter (deploy/oracle/usage-sample.sh) writes
 * "epoch cpu% mem%" lines; this turns them into a risk the team can see before Oracle acts.
 */
export interface UsageSummary {
  samples: number;
  days: number;
  cpuP95: number | null;
  memAvg: number | null;
  memMin: number | null;
  /** low: memory or CPU comfortably above 20%; watch: close; high: would count as idle. */
  idleRisk: "low" | "watch" | "high" | "unknown";
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const v = [...values].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.ceil((p / 100) * v.length) - 1)]!;
}

export function summarizeUsage(text: string, nowSec = Date.now() / 1000): UsageSummary {
  const rows = text
    .split("\n")
    .map((l) => l.trim().split(/\s+/).map(Number))
    .filter((r) => r.length === 3 && r.every(Number.isFinite) && r[0]! > nowSec - 7 * 86_400);
  if (rows.length === 0)
    return { samples: 0, days: 0, cpuP95: null, memAvg: null, memMin: null, idleRisk: "unknown" };
  const cpu = rows.map((r) => r[1]!);
  const mem = rows.map((r) => r[2]!);
  const cpuP95 = percentile(cpu, 95)!;
  const memAvg = Math.round((mem.reduce((a, b) => a + b, 0) / mem.length) * 10) / 10;
  const memMin = Math.min(...mem);
  // Safe while at least one measure is clearly above Oracle's 20% line.
  const best = Math.max(cpuP95, memMin);
  const idleRisk = best >= 25 ? "low" : best >= 20 ? "watch" : "high";
  const days = Math.round(((nowSec - rows[0]![0]!) / 86_400) * 10) / 10;
  return { samples: rows.length, days, cpuP95, memAvg, memMin, idleRisk };
}

export interface BackupCheck {
  at: string;
  ok: boolean;
  detail: string;
}

/** The latest nightly restore check (deploy/oracle/nightly-check.sh), if any. */
export function lastBackupCheck(text: string): BackupCheck | null {
  const lines = text.trim().split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const v = JSON.parse(lines[i]!) as BackupCheck;
      if (typeof v.ok === "boolean") return v;
    } catch {
      // a partial line: try the one before
    }
  }
  return null;
}

const read = (name: string) => {
  try {
    return readFileSync(join(dirname(databasePath()), name), "utf8");
  } catch {
    return "";
  }
};

/** Usage and backup status from the files the server's timers write next to the database. */
export function serverStatus() {
  return {
    usage: summarizeUsage(read("usage.log")),
    backupCheck: lastBackupCheck(read("backup-check.log")),
  };
}
