import {
  ApiError,
  FileState,
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Part,
  type ThinkingConfig,
} from "@google/genai";
import { z } from "zod";
import {
  AiOutputError,
  AiRefusalError,
  ZERO_USAGE,
  hashInput,
  stripSchemaKeys,
  withRetry,
  type AiRunRecord,
  type AiRunSink,
  type ContentPart,
  type LlmClient,
  type StructuredCallInput,
  type StructuredCallResult,
} from "../llm";
import { estimateCostUsd, modelFor, type Effort, type TokenUsage } from "../models";

/** The two SDK surfaces the client uses; injectable for tests. */
export type GeminiSdk = Pick<GoogleGenAI, "models" | "files">;

export interface GeminiClientOptions {
  ai?: GeminiSdk;
  apiKey?: string;
  sink?: AiRunSink;
  /** Above this many PDF bytes per request, PDFs are uploaded via the Files API. */
  inlineLimitBytes?: number;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Inline request bodies are capped around 20 MB; keep headroom for base64 growth + text. */
const DEFAULT_INLINE_LIMIT = 14 * 1024 * 1024;

/**
 * Keywords removed before sending a schema as `responseJsonSchema`. Validation is not lost:
 * every response is re-validated with the full Zod schema (strict objects, regexes, bounds).
 */
const GEMINI_DROP_KEYS = new Set(["$schema", "$id", "additionalProperties", "pattern"]);

const REFUSAL_FINISH = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "LANGUAGE",
]);

export function geminiThinkingConfig(model: string, effort: Effort): ThinkingConfig {
  // Gemini 2.x models take a token budget; Gemini 3+ take a discrete level.
  if (/^gemini-2(\.|-)/.test(model)) {
    const budget = { low: 1024, medium: 4096, high: 16384, xhigh: -1, max: -1 }[effort];
    return { thinkingBudget: budget, includeThoughts: false };
  }
  const level =
    effort === "low"
      ? ThinkingLevel.LOW
      : effort === "medium"
        ? ThinkingLevel.MEDIUM
        : ThinkingLevel.HIGH;
  return { thinkingLevel: level, includeThoughts: false };
}

export function geminiResponseSchema(schema: z.ZodType): unknown {
  return stripSchemaKeys(z.toJSONSchema(schema, { target: "draft-2020-12" }), GEMINI_DROP_KEYS);
}

export function isRetryableGeminiError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 429 || err.status >= 500;
  // undici surfaces dropped connections as TypeError("fetch failed")
  return err instanceof TypeError && /fetch failed|network|socket/i.test(err.message);
}

export function describeGeminiError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return `rate_limited: ${err.message}`;
    if (err.status === 401 || err.status === 403) return `auth: ${err.message}`;
    if (err.status === 400) return `bad_request: ${err.message}`;
    return `api_${err.status}: ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * LlmClient backed by the Gemini API (`@google/genai`). Structured output via
 * `responseJsonSchema`, PDFs inline or through the Files API, effort mapped to thinking.
 */
export class GeminiClient implements LlmClient {
  readonly provider = "gemini" as const;
  private sdk: GeminiSdk | undefined;
  private readonly apiKey: string | undefined;
  private readonly sink: AiRunSink;
  private readonly inlineLimitBytes: number;
  private readonly maxAttempts: number;
  private readonly sleep: ((ms: number) => Promise<void>) | undefined;

  constructor(opts: GeminiClientOptions = {}) {
    this.sdk = opts.ai;
    this.apiKey = opts.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    this.sink = opts.sink ?? (() => undefined);
    this.inlineLimitBytes = opts.inlineLimitBytes ?? DEFAULT_INLINE_LIMIT;
    this.maxAttempts = opts.maxAttempts ?? 3;
    this.sleep = opts.sleep;
  }

  /** Created lazily so importing the package never requires an API key. */
  private get ai(): GeminiSdk {
    if (!this.sdk) {
      if (!this.apiKey) throw new Error("GEMINI_API_KEY is not set");
      this.sdk = new GoogleGenAI({ apiKey: this.apiKey });
    }
    return this.sdk;
  }

  async structured<T extends z.ZodType>(
    input: StructuredCallInput<T>,
  ): Promise<StructuredCallResult<z.output<T>>> {
    const model = input.model ?? modelFor("gemini", input.tier ?? "primary");
    const effort = input.effort ?? "medium";
    const started = Date.now();
    const inputHash = hashInput([input.system, input.user, input.promptVersion]);
    const base = {
      job: input.job,
      promptVersion: input.promptVersion,
      provider: this.provider,
      effort,
      inputHash,
      tenantId: input.tenantId,
      dealId: input.dealId,
    };

    const config: GenerateContentConfig = {
      systemInstruction: input.system,
      responseMimeType: "application/json",
      responseJsonSchema: geminiResponseSchema(input.schema),
      maxOutputTokens: input.maxTokens ?? 16_000,
      thinkingConfig: geminiThinkingConfig(model, effort),
    };

    let raw: GenerateContentResponse;
    try {
      const parts = await this.toParts(input.user);
      raw = await withRetry(
        () =>
          this.ai.models.generateContent({
            model,
            contents: [{ role: "user", parts }],
            config,
          }),
        {
          attempts: this.maxAttempts,
          baseDelayMs: 1000,
          isRetryable: isRetryableGeminiError,
          ...(this.sleep ? { sleep: this.sleep } : {}),
        },
      );
    } catch (err) {
      await this.sink({
        ...base,
        model,
        usage: ZERO_USAGE,
        costUsd: 0,
        latencyMs: Date.now() - started,
        stopReason: null,
        output: null,
        error: describeGeminiError(err),
      });
      throw err;
    }

    const usage = geminiUsage(raw);
    const servedModel = raw.modelVersion || model;
    const candidate = raw.candidates?.[0];
    const finish = candidate?.finishReason ?? null;
    const record: AiRunRecord = {
      ...base,
      model: servedModel,
      usage,
      costUsd: estimateCostUsd(servedModel, usage),
      latencyMs: Date.now() - started,
      stopReason: finish ?? (raw.promptFeedback?.blockReason ? "PROMPT_BLOCKED" : null),
      output: null,
      error: null,
    };

    const blockReason = raw.promptFeedback?.blockReason;
    if (blockReason || (finish && REFUSAL_FINISH.has(finish))) {
      const category = blockReason ?? finish ?? "unknown";
      record.error = `refusal:${category}`;
      await this.sink(record);
      throw new AiRefusalError(
        category,
        raw.promptFeedback?.blockReasonMessage ?? candidate?.finishMessage ?? null,
      );
    }
    if (finish === "MAX_TOKENS") {
      record.error = "max_tokens";
      await this.sink(record);
      throw new AiOutputError("output truncated at max_tokens; raise maxTokens", raw.text ?? "");
    }

    const text = raw.text ?? "";
    let parsed: z.output<T>;
    try {
      parsed = input.schema.parse(JSON.parse(text));
    } catch (err) {
      const msg = describeGeminiError(err);
      record.error = `invalid_output: ${msg}`;
      await this.sink(record);
      throw new AiOutputError(`structured output failed validation: ${msg}`, text);
    }

    record.output = parsed;
    await this.sink(record);
    return { data: parsed, record, raw };
  }

  /** Text stays inline; PDFs go inline unless the request would get too large. */
  private async toParts(content: ContentPart[]): Promise<Part[]> {
    const pdfBytes = content.reduce((n, c) => n + (c.type === "pdf" ? c.data.length : 0), 0);
    const useFilesApi = pdfBytes > this.inlineLimitBytes;
    const parts: Part[] = [];
    for (const c of content) {
      if (c.type === "text") {
        parts.push({ text: c.text });
        continue;
      }
      if (c.title) parts.push({ text: `[${c.title}]` });
      if (!useFilesApi) {
        parts.push({
          inlineData: { data: c.data.toString("base64"), mimeType: "application/pdf" },
        });
      } else {
        parts.push(await this.uploadPdf(c.data, c.title));
      }
    }
    return parts;
  }

  private async uploadPdf(data: Buffer, title?: string): Promise<Part> {
    const blob = new Blob([new Uint8Array(data)], { type: "application/pdf" });
    let file = await this.ai.files.upload({
      file: blob,
      config: { mimeType: "application/pdf", ...(title ? { displayName: title } : {}) },
    });
    // PDFs are usually ACTIVE immediately; poll briefly if the API is still processing.
    for (let i = 0; i < 30 && file.state === FileState.PROCESSING && file.name; i++) {
      await (this.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))))(1000);
      file = await this.ai.files.get({ name: file.name });
    }
    if (file.state === FileState.FAILED || !file.uri) {
      throw new Error(`Gemini file upload failed for ${title ?? "PDF"}`);
    }
    return { fileData: { fileUri: file.uri, mimeType: file.mimeType ?? "application/pdf" } };
  }
}

export function geminiUsage(raw: GenerateContentResponse): TokenUsage {
  const u = raw.usageMetadata;
  const cached = u?.cachedContentTokenCount ?? 0;
  return {
    inputTokens: Math.max(0, (u?.promptTokenCount ?? 0) - cached),
    outputTokens: (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0),
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  };
}
