import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { z } from "zod";
import { MODELS, estimateCostUsd, type Effort, type TokenUsage } from "./models";

/** Beta flag for the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

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
  | "A11_CALL_SUMMARY"
  | "A12_LEAD_SCORING"
  | "A13_DEAL_DESK"
  | "A14_BATCH"
  | "A15_DISCLOSURE_CHECK";

/** What gets persisted to the AiRun table. The sink is injected so this package has no DB dep. */
export interface AiRunRecord {
  job: AiJob;
  promptVersion: string;
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

export interface ClaudeClientOptions {
  anthropic?: Anthropic;
  sink?: AiRunSink;
  /** Default false: fallbacks need the beta header; set true in prod on the Claude API. */
  enableFallbacks?: boolean;
}

export type UserContent = Anthropic.Beta.BetaContentBlockParam[];

export interface StructuredCallInput<T extends z.ZodType> {
  job: AiJob;
  promptVersion: string;
  /** Stable instructions. Cached with a 1h TTL — never put per-deal data here. */
  system: string;
  /** Per-call content: text, PDF document blocks, images. */
  user: UserContent;
  schema: T;
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  tenantId?: string;
  dealId?: string;
}

export interface StructuredCallResult<T> {
  data: T;
  record: AiRunRecord;
  raw: Anthropic.Beta.BetaMessage;
}

export class AiRefusalError extends Error {
  constructor(
    public readonly category: string | null,
    public readonly explanation: string | null,
  ) {
    super(`Claude declined the request${category ? ` (${category})` : ""}`);
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

function hashInput(parts: unknown[]): string {
  const h = createHash("sha256");
  for (const p of parts) h.update(typeof p === "string" ? p : JSON.stringify(p));
  return h.digest("hex");
}

/**
 * Single entry point for every Claude call in the CRM. Enforces:
 *  - structured output validated by Zod (no free-text parsing downstream)
 *  - stable system prompt first with cache_control, volatile deal data last
 *  - an AiRun record for every call (success or failure) via the sink
 *  - typed SDK error handling; refusals surface as AiRefusalError
 */
export class ClaudeClient {
  private readonly anthropic: Anthropic;
  private readonly sink: AiRunSink;
  private readonly enableFallbacks: boolean;

  constructor(opts: ClaudeClientOptions = {}) {
    this.anthropic = opts.anthropic ?? new Anthropic();
    this.sink = opts.sink ?? (() => undefined);
    this.enableFallbacks = opts.enableFallbacks ?? false;
  }

  async structured<T extends z.ZodType>(
    input: StructuredCallInput<T>,
  ): Promise<StructuredCallResult<z.output<T>>> {
    const model = input.model ?? MODELS.primary;
    const effort = input.effort ?? "medium";
    const started = Date.now();
    const inputHash = hashInput([input.system, input.user, input.promptVersion]);
    const jsonSchema = z.toJSONSchema(input.schema, { target: "draft-2020-12" });

    const base: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: input.maxTokens ?? 16_000,
      system: [
        { type: "text", text: input.system, cache_control: { type: "ephemeral", ttl: "1h" } },
      ],
      messages: [{ role: "user", content: input.user }],
      output_config: {
        effort,
        format: { type: "json_schema", schema: jsonSchema as Record<string, unknown> },
      },
    };

    let raw: Anthropic.Beta.BetaMessage;
    try {
      raw = this.enableFallbacks
        ? await this.anthropic.beta.messages.create({
            ...base,
            betas: [FALLBACK_BETA],
            fallbacks: "default",
          } as Anthropic.Beta.MessageCreateParamsNonStreaming)
        : await this.anthropic.beta.messages.create(base);
    } catch (err) {
      await this.sink({
        job: input.job,
        promptVersion: input.promptVersion,
        model,
        effort,
        inputHash,
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
        costUsd: 0,
        latencyMs: Date.now() - started,
        stopReason: null,
        output: null,
        error: describeError(err),
        tenantId: input.tenantId,
        dealId: input.dealId,
      });
      throw err;
    }

    const usage: TokenUsage = {
      inputTokens: raw.usage.input_tokens,
      outputTokens: raw.usage.output_tokens,
      cacheReadTokens: raw.usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: raw.usage.cache_creation_input_tokens ?? 0,
    };
    const record: AiRunRecord = {
      job: input.job,
      promptVersion: input.promptVersion,
      model: raw.model,
      effort,
      inputHash,
      usage,
      costUsd: estimateCostUsd(raw.model, usage),
      latencyMs: Date.now() - started,
      stopReason: raw.stop_reason,
      output: null,
      error: null,
      tenantId: input.tenantId,
      dealId: input.dealId,
    };

    if (raw.stop_reason === "refusal") {
      const details = raw.stop_details;
      const category = details && "category" in details ? (details.category ?? null) : null;
      const explanation =
        details && "explanation" in details ? (details.explanation ?? null) : null;
      record.error = `refusal:${category ?? "unknown"}`;
      await this.sink(record);
      throw new AiRefusalError(category, explanation);
    }
    if (raw.stop_reason === "max_tokens") {
      record.error = "max_tokens";
      await this.sink(record);
      throw new AiOutputError("output truncated at max_tokens; raise maxTokens", "");
    }

    const text = raw.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    let parsed: z.output<T>;
    try {
      parsed = input.schema.parse(JSON.parse(text));
    } catch (err) {
      record.error = `invalid_output: ${describeError(err)}`;
      await this.sink(record);
      throw new AiOutputError(`structured output failed validation: ${describeError(err)}`, text);
    }

    record.output = parsed;
    await this.sink(record);
    return { data: parsed, record, raw };
  }
}

export function describeError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return `rate_limited: ${err.message}`;
  if (err instanceof Anthropic.AuthenticationError) return `auth: ${err.message}`;
  if (err instanceof Anthropic.BadRequestError) return `bad_request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return `connection: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `api_${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

/** Helper: wrap a PDF buffer as a document content block. */
export function pdfBlock(data: Buffer, title?: string): Anthropic.Beta.BetaContentBlockParam {
  return {
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: data.toString("base64") },
    ...(title ? { title } : {}),
  };
}

export function textBlock(text: string): Anthropic.Beta.BetaContentBlockParam {
  return { type: "text", text };
}
