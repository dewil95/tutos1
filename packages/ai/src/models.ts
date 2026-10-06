/**
 * Model routing and pricing.
 *
 * Default provider is Google Gemini (MCA_AI_PROVIDER=gemini). The Anthropic Claude provider is
 * kept behind the same interface (MCA_AI_PROVIDER=anthropic) for A/B evals.
 *
 * Prices are USD per million tokens, paid tier, as published around 2026-10. Gemini ids marked
 * "preview" can change; override with MCA_AI_MODEL_PRIMARY / MCA_AI_MODEL_FAST without a code
 * change. The eval runner prints cost per case so price drift shows up quickly.
 */

export type Provider = "gemini" | "anthropic";
export type ModelTier = "primary" | "fast";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

const DEFAULT_MODELS: Record<Provider, Record<ModelTier, string>> = {
  gemini: { primary: "gemini-3.1-pro-preview", fast: "gemini-3-flash-preview" },
  anthropic: { primary: "claude-opus-5-5", fast: "claude-haiku-4-5" },
};

export function currentProvider(): Provider {
  return process.env.MCA_AI_PROVIDER === "anthropic" ? "anthropic" : "gemini";
}

export function modelFor(provider: Provider, tier: ModelTier): string {
  const override =
    tier === "primary" ? process.env.MCA_AI_MODEL_PRIMARY : process.env.MCA_AI_MODEL_FAST;
  return override || DEFAULT_MODELS[provider][tier];
}

/** Resolved for the active provider at call time (env can change between tests). */
export const MODELS = {
  get primary(): string {
    return modelFor(currentProvider(), "primary");
  },
  get fast(): string {
    return modelFor(currentProvider(), "fast");
  },
};

interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Gemini Pro charges more once the prompt exceeds this many tokens. */
  longContext?: { thresholdTokens: number; input: number; output: number; cacheRead: number };
}

const PRICES: Record<string, Price> = {
  // Google Gemini (implicit caching: cached tokens billed at cacheRead, no write charge)
  "gemini-3.1-pro-preview": {
    input: 2,
    output: 12,
    cacheRead: 0.2,
    cacheWrite: 0,
    longContext: { thresholdTokens: 200_000, input: 4, output: 18, cacheRead: 0.4 },
  },
  "gemini-3-pro-preview": {
    input: 2,
    output: 12,
    cacheRead: 0.2,
    cacheWrite: 0,
    longContext: { thresholdTokens: 200_000, input: 4, output: 18, cacheRead: 0.4 },
  },
  "gemini-3-flash-preview": { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite: 0 },
  "gemini-2.5-flash-lite": { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite: 0 },
  // Anthropic Claude (alternative provider)
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export interface TokenUsage {
  /** Uncached prompt tokens. */
  inputTokens: number;
  /** Output tokens including thinking tokens (both are billed at the output rate). */
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

const warned = new Set<string>();

/** Strips version suffixes the API echoes back (e.g. "gemini-3-flash-preview-09-2026"). */
function priceFor(model: string): Price | undefined {
  if (PRICES[model]) return PRICES[model];
  const key = Object.keys(PRICES)
    .filter((k) => model.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return key ? PRICES[key] : undefined;
}

export function estimateCostUsd(model: string, usage: TokenUsage): number {
  let p = priceFor(model);
  if (!p) {
    const fallback = model.startsWith("claude")
      ? DEFAULT_MODELS.anthropic.primary
      : DEFAULT_MODELS.gemini.primary;
    if (!warned.has(model)) {
      warned.add(model);
      console.warn(`[mca/ai] no price for model "${model}", estimating with ${fallback}`);
    }
    p = PRICES[fallback]!;
  }
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const rate =
    p.longContext && promptTokens > p.longContext.thresholdTokens ? { ...p, ...p.longContext } : p;
  const perTok = 1 / 1_000_000;
  const cost =
    usage.inputTokens * rate.input * perTok +
    usage.outputTokens * rate.output * perTok +
    usage.cacheReadTokens * rate.cacheRead * perTok +
    usage.cacheWriteTokens * rate.cacheWrite * perTok;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
