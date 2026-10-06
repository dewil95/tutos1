import { createHash } from "node:crypto";
import type { z } from "zod";
import type { Effort, ModelTier, Provider, TokenUsage } from "./models";

/**
 * Provider-neutral contract for every LLM call in the CRM. Jobs (A1…A15) only depend on this
 * file; `providers/gemini.ts` (default) and `providers/anthropic.ts` implement it.
 */

export type AiJob =
  | "A1_STATEMENT_EXTRACTION"
  | "A2_POSITION_DETECTION"
  | "A3_PRE_UNDERWRITING"
  | "A4_DOCUMENT_QA"
  | "A5_APPLICATION_OCR"
  | "A6_FUNDER_MATCHING"
  | "A7_SUBMISSION_EMAIL"
  | "A8_INBOUND_PARSING"
  | "A9_OFFER_COMPARISON"
  | "A10_FOLLOWUP_DRAFT"
  | "A12_LEAD_SCORING"
  | "A13_DEAL_DESK"
  | "A14_BATCH"
  | "A15_DISCLOSURE_CHECK";

/** What gets persisted to the AiRun table. The sink is injected so this package has no DB dep. */
export interface AiRunRecord {
  job: AiJob;
  promptVersion: string;
  provider: Provider;
  model: string;
  effort: Effort | null;
  inputHash: string;
  usage: TokenUsage;
  costUsd: number;
  latencyMs: number;
  stopReason: string | null;
  output: unknown;
  error: string | null;
  tenantId?: string;
  dealId?: string;
}

export type AiRunSink = (record: AiRunRecord) => Promise<void> | void;

/** Request content, independent of any SDK's block format. */
export type ContentPart =
  { type: "text"; text: string } | { type: "pdf"; data: Buffer; title?: string };

export interface StructuredCallInput<T extends z.ZodType> {
  job: AiJob;
  promptVersion: string;
  /** Stable instructions. Providers cache this prefix — never put per-deal data here. */
  system: string;
  /** Per-call content: text and PDF parts. */
  user: ContentPart[];
  schema: T;
  /** "primary" for judgment-heavy work, "fast" for high-volume classification. */
  tier?: ModelTier;
  /** Explicit model id; overrides `tier`. */
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  tenantId?: string;
  dealId?: string;
  /** Masks sensitive fields (SSN, DOB) in what is written to the AiRun log. */
  redactForLog?: (data: z.output<T>) => unknown;
}

export interface StructuredCallResult<T> {
  data: T;
  record: AiRunRecord;
  /** Provider SDK response, for debugging only. */
  raw: unknown;
}

export interface LlmClient {
  readonly provider: Provider;
  structured<T extends z.ZodType>(
    input: StructuredCallInput<T>,
  ): Promise<StructuredCallResult<z.output<T>>>;
}

export class AiRefusalError extends Error {
  constructor(
    public readonly category: string | null,
    public readonly explanation: string | null,
  ) {
    super(`The model declined the request${category ? ` (${category})` : ""}`);
    this.name = "AiRefusalError";
  }
}

export class AiOutputError extends Error {
  constructor(
    message: string,
    public readonly rawText: string,
  ) {
    super(message);
    this.name = "AiOutputError";
  }
}

export function textBlock(text: string): ContentPart {
  return { type: "text", text };
}

export function pdfBlock(data: Buffer, title?: string): ContentPart {
  return title ? { type: "pdf", data, title } : { type: "pdf", data };
}

export function hashInput(parts: unknown[]): string {
  const h = createHash("sha256");
  for (const p of parts) {
    if (typeof p === "string") h.update(p);
    else
      h.update(
        JSON.stringify(p, (_k, v: unknown) =>
          Buffer.isBuffer(v) ? createHash("sha256").update(v).digest("hex") : v,
        ),
      );
  }
  return h.digest("hex");
}

export const ZERO_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** Removes the leading `$schema` key and keywords a provider's schema dialect rejects. */
export function stripSchemaKeys(schema: unknown, drop: ReadonlySet<string>): unknown {
  if (Array.isArray(schema)) return schema.map((s) => stripSchemaKeys(s, drop));
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema)) {
      if (drop.has(k)) continue;
      // `properties` maps user field names to schemas: never drop a field because its name
      // collides with a keyword (e.g. a field called "pattern").
      out[k] =
        k === "properties" && v && typeof v === "object"
          ? Object.fromEntries(
              Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [
                pk,
                stripSchemaKeys(pv, drop),
              ]),
            )
          : stripSchemaKeys(v, drop);
    }
    return out;
  }
  return schema;
}

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
  isRetryable: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

/** Exponential backoff with jitter: base, 2×base, 4×base … (±20 %). */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let lastErr: unknown;
  for (let attempt = 1; attempt <= opts.attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === opts.attempts || !opts.isRetryable(err)) throw err;
      const delay = opts.baseDelayMs * 2 ** (attempt - 1);
      await sleep(Math.round(delay * (0.8 + Math.random() * 0.4)));
    }
  }
  throw lastErr;
}
