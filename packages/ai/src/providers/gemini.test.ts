import { ApiError, FileState, ThinkingLevel, type GenerateContentResponse } from "@google/genai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiOutputError, AiRefusalError, type AiRunRecord } from "../llm";
import { estimateCostUsd } from "../models";
import { FunderReplySchema } from "../schemas/funderReply";
import {
  GeminiClient,
  geminiResponseSchema,
  geminiThinkingConfig,
  geminiUsage,
  type GeminiSdk,
} from "./gemini";

const schema = z.object({ answer: z.number() }).strict();

function response(overrides: Partial<GenerateContentResponse> & { text?: string } = {}) {
  const { text = JSON.stringify({ answer: 42 }), ...rest } = overrides;
  return {
    text,
    modelVersion: "gemini-3.1-pro-preview",
    candidates: [{ finishReason: "STOP", content: { parts: [{ text }] } }],
    usageMetadata: {
      promptTokenCount: 1_500,
      cachedContentTokenCount: 500,
      candidatesTokenCount: 100,
      thoughtsTokenCount: 50,
      totalTokenCount: 1_650,
    },
    ...rest,
  } as unknown as GenerateContentResponse;
}

function sdkWith(generate: ReturnType<typeof vi.fn>, files?: Partial<GeminiSdk["files"]>) {
  return {
    models: { generateContent: generate },
    files: { upload: vi.fn(), get: vi.fn(), ...files },
  } as unknown as GeminiSdk;
}

const call = {
  job: "A8_INBOUND_PARSING" as const,
  promptVersion: "test.v1",
  system: "stable instructions",
  user: [{ type: "text" as const, text: "question" }],
  schema,
};

afterEach(() => {
  delete process.env.MCA_AI_MODEL_PRIMARY;
  delete process.env.MCA_AI_MODEL_FAST;
});

describe("GeminiClient.structured", () => {
  it("sends system instruction, JSON schema and thinking config; parses and records usage", async () => {
    const generate = vi.fn().mockResolvedValue(response());
    const records: AiRunRecord[] = [];
    const client = new GeminiClient({ ai: sdkWith(generate), sink: (r) => void records.push(r) });

    const res = await client.structured(call);

    expect(res.data.answer).toBe(42);
    const params = generate.mock.calls[0]![0];
    expect(params.model).toBe("gemini-3.1-pro-preview");
    expect(params.contents).toEqual([{ role: "user", parts: [{ text: "question" }] }]);
    expect(params.config).toMatchObject({
      systemInstruction: "stable instructions",
      responseMimeType: "application/json",
      maxOutputTokens: 16_000,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM, includeThoughts: false },
    });
    expect(params.config.responseJsonSchema).toMatchObject({
      type: "object",
      properties: { answer: { type: "number" } },
      required: ["answer"],
    });

    expect(records).toHaveLength(1);
    const r = records[0]!;
    expect(r.provider).toBe("gemini");
    expect(r.usage).toEqual({
      inputTokens: 1_000,
      outputTokens: 150,
      cacheReadTokens: 500,
      cacheWriteTokens: 0,
    });
    expect(r.costUsd).toBe(estimateCostUsd("gemini-3.1-pro-preview", r.usage));
    expect(r.error).toBeNull();
    expect(r.stopReason).toBe("STOP");
  });

  it("uses the fast tier model when asked", async () => {
    const generate = vi.fn().mockResolvedValue(response());
    const client = new GeminiClient({ ai: sdkWith(generate) });
    await client.structured({ ...call, tier: "fast" });
    expect(generate.mock.calls[0]![0].model).toBe("gemini-3-flash-preview");
  });

  it("honours model overrides from the environment", async () => {
    process.env.MCA_AI_MODEL_PRIMARY = "gemini-2.5-flash";
    const generate = vi.fn().mockResolvedValue(response());
    const client = new GeminiClient({ ai: sdkWith(generate) });
    await client.structured({ ...call, effort: "high" });
    const params = generate.mock.calls[0]![0];
    expect(params.model).toBe("gemini-2.5-flash");
    expect(params.config.thinkingConfig).toEqual({ thinkingBudget: 16384, includeThoughts: false });
  });

  it("sends small PDFs inline with a title part", async () => {
    const generate = vi.fn().mockResolvedValue(response());
    const client = new GeminiClient({ ai: sdkWith(generate) });
    const pdf = Buffer.from("%PDF-1.7 small");
    await client.structured({
      ...call,
      user: [
        { type: "pdf", data: pdf, title: "Document 0: July.pdf" },
        { type: "text", text: "extract" },
      ],
    });
    expect(generate.mock.calls[0]![0].contents[0].parts).toEqual([
      { text: "[Document 0: July.pdf]" },
      { inlineData: { data: pdf.toString("base64"), mimeType: "application/pdf" } },
      { text: "extract" },
    ]);
  });

  it("uploads PDFs through the Files API above the inline limit and waits for ACTIVE", async () => {
    const generate = vi.fn().mockResolvedValue(response());
    const upload = vi.fn().mockResolvedValue({ name: "files/abc", state: FileState.PROCESSING });
    const get = vi.fn().mockResolvedValue({
      name: "files/abc",
      state: FileState.ACTIVE,
      uri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
      mimeType: "application/pdf",
    });
    const client = new GeminiClient({
      ai: sdkWith(generate, { upload, get }),
      inlineLimitBytes: 4,
      sleep: async () => undefined,
    });
    await client.structured({
      ...call,
      user: [{ type: "pdf", data: Buffer.from("%PDF-1.7 big"), title: "Aug.pdf" }],
    });
    expect(upload).toHaveBeenCalledOnce();
    expect(upload.mock.calls[0]![0].config).toEqual({
      mimeType: "application/pdf",
      displayName: "Aug.pdf",
    });
    expect(get).toHaveBeenCalledWith({ name: "files/abc" });
    expect(generate.mock.calls[0]![0].contents[0].parts[1]).toEqual({
      fileData: {
        fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc",
        mimeType: "application/pdf",
      },
    });
  });

  it("maps a SAFETY finish to AiRefusalError and records it", async () => {
    const records: AiRunRecord[] = [];
    const generate = vi.fn().mockResolvedValue(
      response({
        text: "",
        candidates: [{ finishReason: "SAFETY", finishMessage: "blocked" }],
      } as unknown as Partial<GenerateContentResponse>),
    );
    const client = new GeminiClient({ ai: sdkWith(generate), sink: (r) => void records.push(r) });
    await expect(client.structured(call)).rejects.toBeInstanceOf(AiRefusalError);
    expect(records[0]!.error).toBe("refusal:SAFETY");
  });

  it("maps a blocked prompt to AiRefusalError", async () => {
    const generate = vi.fn().mockResolvedValue(
      response({
        text: "",
        candidates: [],
        promptFeedback: { blockReason: "PROHIBITED_CONTENT" },
      } as unknown as Partial<GenerateContentResponse>),
    );
    const client = new GeminiClient({ ai: sdkWith(generate) });
    await expect(client.structured(call)).rejects.toMatchObject({
      name: "AiRefusalError",
      category: "PROHIBITED_CONTENT",
    });
  });

  it("maps MAX_TOKENS to AiOutputError", async () => {
    const generate = vi.fn().mockResolvedValue(
      response({
        text: '{"ans',
        candidates: [{ finishReason: "MAX_TOKENS" }],
      } as unknown as Partial<GenerateContentResponse>),
    );
    const client = new GeminiClient({ ai: sdkWith(generate) });
    await expect(client.structured(call)).rejects.toThrow(/max_tokens/);
  });

  it("rejects output that fails the Zod schema", async () => {
    const records: AiRunRecord[] = [];
    const generate = vi.fn().mockResolvedValue(response({ text: '{"answer":"forty-two"}' }));
    const client = new GeminiClient({ ai: sdkWith(generate), sink: (r) => void records.push(r) });
    await expect(client.structured(call)).rejects.toBeInstanceOf(AiOutputError);
    expect(records[0]!.error).toMatch(/^invalid_output/);
  });

  it("retries 429 and 5xx, then succeeds", async () => {
    const generate = vi
      .fn()
      .mockRejectedValueOnce(new ApiError({ message: "quota", status: 429 }))
      .mockRejectedValueOnce(new ApiError({ message: "unavailable", status: 503 }))
      .mockResolvedValue(response());
    const client = new GeminiClient({ ai: sdkWith(generate), sleep: async () => undefined });
    const res = await client.structured(call);
    expect(res.data.answer).toBe(42);
    expect(generate).toHaveBeenCalledTimes(3);
  });

  it("does not retry a 400 and records the error", async () => {
    const records: AiRunRecord[] = [];
    const generate = vi
      .fn()
      .mockRejectedValue(new ApiError({ message: "bad schema", status: 400 }));
    const client = new GeminiClient({
      ai: sdkWith(generate),
      sink: (r) => void records.push(r),
      sleep: async () => undefined,
    });
    await expect(client.structured(call)).rejects.toBeInstanceOf(ApiError);
    expect(generate).toHaveBeenCalledOnce();
    expect(records[0]!.error).toBe("bad_request: bad schema");
  });

  it("fails clearly when no API key is configured", async () => {
    const saved = { g: process.env.GEMINI_API_KEY, o: process.env.GOOGLE_API_KEY };
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    try {
      await expect(new GeminiClient().structured(call)).rejects.toThrow(/GEMINI_API_KEY/);
    } finally {
      if (saved.g) process.env.GEMINI_API_KEY = saved.g;
      if (saved.o) process.env.GOOGLE_API_KEY = saved.o;
    }
  });
});

describe("Gemini helpers", () => {
  it("maps effort to thinking per model family", () => {
    expect(geminiThinkingConfig("gemini-3-flash-preview", "low").thinkingLevel).toBe(
      ThinkingLevel.LOW,
    );
    expect(geminiThinkingConfig("gemini-3.1-pro-preview", "max").thinkingLevel).toBe(
      ThinkingLevel.HIGH,
    );
    expect(geminiThinkingConfig("gemini-2.5-flash", "low").thinkingBudget).toBe(1024);
    expect(geminiThinkingConfig("gemini-2.5-flash-lite", "xhigh").thinkingBudget).toBe(-1);
  });

  it("strips keywords Gemini rejects but keeps field names that collide with them", () => {
    const js = geminiResponseSchema(
      z
        .object({
          pattern: z.string().regex(/^\d{4}$/),
          nested: z.object({ a: z.number() }).strict(),
        })
        .strict(),
    ) as Record<string, unknown>;
    const text = JSON.stringify(js);
    expect(text).not.toContain("$schema");
    expect(text).not.toContain("additionalProperties");
    expect(text).not.toContain('"pattern":"');
    expect((js.properties as Record<string, unknown>).pattern).toEqual({ type: "string" });
  });

  it("produces a usable schema for the real A8 output", () => {
    const js = geminiResponseSchema(FunderReplySchema) as { properties: Record<string, unknown> };
    expect(Object.keys(js.properties)).toContain("offers");
    expect(JSON.stringify(js)).not.toContain("additionalProperties");
  });

  it("treats missing usage metadata as zero", () => {
    expect(geminiUsage({} as GenerateContentResponse)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });

  it("prices Gemini 3.1 Pro with the long-context tier above 200K prompt tokens", () => {
    const short = estimateCostUsd("gemini-3.1-pro-preview", {
      inputTokens: 100_000,
      outputTokens: 10_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    const long = estimateCostUsd("gemini-3.1-pro-preview", {
      inputTokens: 300_000,
      outputTokens: 10_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(short).toBeCloseTo(0.2 + 0.12, 6);
    expect(long).toBeCloseTo(1.2 + 0.18, 6);
    // version-suffixed ids echo back from the API and still resolve
    expect(
      estimateCostUsd("gemini-3-flash-preview-0925", {
        inputTokens: 1_000_000,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      }),
    ).toBe(0.5);
  });
});
