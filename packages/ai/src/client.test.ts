import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiOutputError, AiRefusalError, ClaudeClient, type AiRunRecord } from "./client";
import { estimateCostUsd } from "./models";
import { MonthlyRowSchema, StatementExtractionSchema } from "./schemas/statement";

function fakeMessage(overrides: Partial<Anthropic.Beta.BetaMessage>): Anthropic.Beta.BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text: JSON.stringify({ answer: 42 }), citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 1_000,
      output_tokens: 100,
      cache_read_input_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_creation: null,
      server_tool_use: null,
      service_tier: null,
      inference_geo: null,
      speed: null,
      iterations: null,
    },
    container: null,
    context_management: null,
    ...overrides,
  } as Anthropic.Beta.BetaMessage;
}

function clientWith(message: Anthropic.Beta.BetaMessage, sink: (r: AiRunRecord) => void) {
  const create = vi.fn().mockResolvedValue(message);
  const anthropic = { beta: { messages: { create } } } as unknown as Anthropic;
  return { client: new ClaudeClient({ anthropic, sink }), create };
}

const schema = z.object({ answer: z.number() }).strict();

describe("ClaudeClient.structured", () => {
  it("parses structured output, records usage and cost, and caches the system prompt", async () => {
    const records: AiRunRecord[] = [];
    const { client, create } = clientWith(fakeMessage({}), (r) => records.push(r));

    const res = await client.structured({
      job: "A2_POSITION_DETECTION",
      promptVersion: "test.v1",
      system: "stable instructions",
      user: [{ type: "text", text: "question" }],
      schema,
    });

    expect(res.data.answer).toBe(42);
    expect(records).toHaveLength(1);
    expect(records[0]!.usage.cacheReadTokens).toBe(500);
    expect(records[0]!.costUsd).toBe(estimateCostUsd("claude-opus-5-5", records[0]!.usage));
    expect(records[0]!.error).toBeNull();

    const params = create.mock.calls[0]![0] as Anthropic.Beta.MessageCreateParamsNonStreaming;
    expect(params.model).toBe("claude-opus-5-5");
    expect(Array.isArray(params.system) && params.system[0]).toMatchObject({
      cache_control: { type: "ephemeral", ttl: "1h" },
    });
    expect(params.output_config).toMatchObject({
      effort: "medium",
      format: { type: "json_schema" },
    });
    expect((params as unknown as Record<string, unknown>).fallbacks).toBeUndefined();
  });

  it("sends the fallback beta when enabled", async () => {
    const create = vi.fn().mockResolvedValue(fakeMessage({}));
    const anthropic = { beta: { messages: { create } } } as unknown as Anthropic;
    const client = new ClaudeClient({ anthropic, enableFallbacks: true });
    await client.structured({
      job: "A2_POSITION_DETECTION",
      promptVersion: "test.v1",
      system: "s",
      user: [{ type: "text", text: "q" }],
      schema,
    });
    const params = create.mock.calls[0]![0] as Record<string, unknown>;
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
  });

  it("surfaces refusals as AiRefusalError and still records the run", async () => {
    const records: AiRunRecord[] = [];
    const { client } = clientWith(
      fakeMessage({
        stop_reason: "refusal",
        content: [],
        stop_details: { type: "refusal", category: "general_harms", explanation: "nope" },
      } as unknown as Partial<Anthropic.Beta.BetaMessage>),
      (r) => records.push(r),
    );
    await expect(
      client.structured({
        job: "A3_PRE_UNDERWRITING",
        promptVersion: "test.v1",
        system: "s",
        user: [{ type: "text", text: "q" }],
        schema,
      }),
    ).rejects.toBeInstanceOf(AiRefusalError);
    expect(records[0]!.error).toBe("refusal:general_harms");
  });

  it("rejects output that fails the schema", async () => {
    const records: AiRunRecord[] = [];
    const { client } = clientWith(
      fakeMessage({ content: [{ type: "text", text: '{"answer":"forty-two"}', citations: null }] }),
      (r) => records.push(r),
    );
    await expect(
      client.structured({
        job: "A1_STATEMENT_EXTRACTION",
        promptVersion: "test.v1",
        system: "s",
        user: [{ type: "text", text: "q" }],
        schema,
      }),
    ).rejects.toBeInstanceOf(AiOutputError);
    expect(records[0]!.error).toMatch(/invalid_output/);
  });
});

describe("schemas", () => {
  it("accepts a well-formed monthly row and rejects a bad month key", () => {
    const row = {
      month: "2026-08",
      bankName: "Chase",
      accountLast4: "1234",
      beginningBalance: 1000,
      endingBalance: 1200,
      totalDeposits: 50000,
      depositCount: 40,
      totalWithdrawals: 49800,
      nonRevenueDeposits: 0,
      nonRevenueDepositNotes: [],
      averageDailyBalance: 5000,
      nsfCount: 0,
      overdraftFeeCount: 0,
      negativeDays: 0,
      minDailyBalance: 300,
      isComplete: true,
      recurringDebits: [],
      evidence: [],
      confidence: 0.9,
    };
    expect(MonthlyRowSchema.parse(row).month).toBe("2026-08");
    expect(() => MonthlyRowSchema.parse({ ...row, month: "Aug 2026" })).toThrow();
    expect(
      StatementExtractionSchema.parse({ documents: [], months: [row], warnings: [] }).months,
    ).toHaveLength(1);
  });

  it("produces a JSON schema with additionalProperties:false at the root", () => {
    const js = z.toJSONSchema(StatementExtractionSchema, { target: "draft-2020-12" }) as {
      additionalProperties?: boolean;
    };
    expect(js.additionalProperties).toBe(false);
  });
});

describe("estimateCostUsd", () => {
  it("prices Opus 5.5 at $4/$20 per MTok with cache reads at $0.20", () => {
    expect(
      estimateCostUsd("claude-opus-5-5", {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
        cacheReadTokens: 1_000_000,
        cacheWriteTokens: 0,
      }),
    ).toBe(24.2);
  });
});
