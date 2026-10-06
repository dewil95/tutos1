import { createLlmClient, type AiRunRecord, type LlmClient } from "@mca/ai";
import type { PrismaClient } from "@mca/db";

/** Persists every model call (Gemini by default) to the AiRun table for cost and eval reporting. */
export function aiRunSink(prisma: PrismaClient) {
  return async (r: AiRunRecord) => {
    await prisma.aiRun.create({
      data: {
        tenantId: r.tenantId ?? null,
        dealId: r.dealId ?? null,
        job: r.job,
        promptVersion: r.promptVersion,
        // Model ids are provider-specific (gemini-… / claude-…), so the provider is implied.
        model: r.model,
        effort: r.effort,
        inputHash: r.inputHash,
        inputTokens: r.usage.inputTokens,
        outputTokens: r.usage.outputTokens,
        cacheReadTokens: r.usage.cacheReadTokens,
        cacheWriteTokens: r.usage.cacheWriteTokens,
        costUsd: r.costUsd,
        latencyMs: r.latencyMs,
        stopReason: r.stopReason,
        output: r.output === null || r.output === undefined ? undefined : (r.output as object),
        error: r.error,
      },
    });
  };
}

export function llmClient(prisma: PrismaClient): LlmClient {
  return createLlmClient({ sink: aiRunSink(prisma) });
}
