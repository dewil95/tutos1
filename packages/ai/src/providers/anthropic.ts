import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  AiOutputError,
  AiRefusalError,
  ZERO_USAGE,
  hashInput,
  type AiRunRecord,
  type AiRunSink,
  type ContentPart,
  type LlmClient,
  type StructuredCallInput,
  type StructuredCallResult,
} from "../llm";
import { estimateCostUsd, modelFor, type TokenUsage } from "../models";

/** Beta flag for the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export interface ClaudeClientOptions {
  anthropic?: Anthropic;
  sink?: AiRunSink;
  /** Default false: fallbacks need the beta header; set true in prod on the Claude API. */
  enableFallbacks?: boolean;
}

function toAnthropicBlocks(parts: ContentPart[]): Anthropic.Beta.BetaContentBlockParam[] {
  return parts.map((p) =>
    p.type === "text"
      ? { type: "text", text: p.text }
      : {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: p.data.toString("base64"),
          },
          ...(p.title ? { title: p.title } : {}),
        },
  );
}

/**
 * Alternative LlmClient on the Anthropic Claude API (MCA_AI_PROVIDER=anthropic). Same contract
 * as GeminiClient: Zod-validated structured output, AiRun record per call, typed errors.
 */
export class ClaudeClient implements LlmClient {
  readonly provider = "anthropic" as const;
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
    const model = input.model ?? modelFor("anthropic", input.tier ?? "primary");
    const effort = input.effort ?? "medium";
    const started = Date.now();
    const inputHash = hashInput([input.system, input.user, input.promptVersion]);
    const jsonSchema = z.toJSONSchema(input.schema, { target: "draft-2020-12" });
    const base = {
      job: input.job,
      promptVersion: input.promptVersion,
      provider: this.provider,
      effort,
      inputHash,
      tenantId: input.tenantId,
      dealId: input.dealId,
    };

    const params: Anthropic.Beta.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: input.maxTokens ?? 16_000,
      system: [
        { type: "text", text: input.system, cache_control: { type: "ephemeral", ttl: "1h" } },
      ],
      messages: [{ role: "user", content: toAnthropicBlocks(input.user) }],
      output_config: {
        effort,
        format: { type: "json_schema", schema: jsonSchema as Record<string, unknown> },
      },
    };

    let raw: Anthropic.Beta.BetaMessage;
    try {
      raw = this.enableFallbacks
        ? await this.anthropic.beta.messages.create({
            ...params,
            betas: [FALLBACK_BETA],
            fallbacks: "default",
          } as Anthropic.Beta.MessageCreateParamsNonStreaming)
        : await this.anthropic.beta.messages.create(params);
    } catch (err) {
      await this.sink({
        ...base,
        model,
        usage: ZERO_USAGE,
        costUsd: 0,
        latencyMs: Date.now() - started,
        stopReason: null,
        output: null,
        error: describeAnthropicError(err),
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
      ...base,
      model: raw.model,
      usage,
      costUsd: estimateCostUsd(raw.model, usage),
      latencyMs: Date.now() - started,
      stopReason: raw.stop_reason,
      output: null,
      error: null,
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
      record.error = `invalid_output: ${describeAnthropicError(err)}`;
      await this.sink(record);
      throw new AiOutputError(
        `structured output failed validation: ${describeAnthropicError(err)}`,
        text,
      );
    }

    record.output = input.redactForLog ? input.redactForLog(parsed) : parsed;
    await this.sink(record);
    return { data: parsed, record, raw };
  }
}

export function describeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.RateLimitError) return `rate_limited: ${err.message}`;
  if (err instanceof Anthropic.AuthenticationError) return `auth: ${err.message}`;
  if (err instanceof Anthropic.BadRequestError) return `bad_request: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return `connection: ${err.message}`;
  if (err instanceof Anthropic.APIError) return `api_${err.status}: ${err.message}`;
  if (err instanceof Error) return err.message;
  return String(err);
}
