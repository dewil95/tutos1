/**
 * Model routing and pricing (USD per million tokens, Anthropic first-party API, 2026-09).
 * Keep in sync with https://platform.claude.com/docs — the eval runner prints cost per case so
 * drift shows up quickly.
 */
export const MODELS = {
  primary: process.env.MCA_AI_MODEL_PRIMARY ?? "claude-opus-5-5",
  fast: process.env.MCA_AI_MODEL_FAST ?? "claude-haiku-4-5",
} as const;

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  const p = PRICES[model] ?? PRICES["claude-opus-5-5"]!;
  const perTok = 1 / 1_000_000;
  const cost =
    usage.inputTokens * p.input * perTok +
    usage.outputTokens * p.output * perTok +
    usage.cacheReadTokens * p.cacheRead * perTok +
    usage.cacheWriteTokens * p.cacheWrite * perTok;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
