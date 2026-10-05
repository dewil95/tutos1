import { analyseStatements, ClaudeClient, type AiRunRecord } from "@mca/ai";
import { getPrisma, type Prisma, type PrismaClient } from "@mca/db";
import type { Job } from "bullmq";
import type { StatementAnalysisJob } from "../queues";

/** Persist every Claude call to the AiRun table. */
export function aiRunSink(prisma: PrismaClient) {
  return async (r: AiRunRecord) => {
    await prisma.aiRun.create({
      data: {
        tenantId: r.tenantId ?? null,
        dealId: r.dealId ?? null,
        job: r.job,
        promptVersion: r.promptVersion,
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
        output: r.output === null ? undefined : (r.output as object),
        error: r.error,
      },
    });
  };
}

/** Object storage read; S3 client is wired in Phase 1. */
export type DocumentFetcher = (storageKey: string) => Promise<Buffer>;

export async function processStatementAnalysis(
  job: Job<StatementAnalysisJob>,
  deps: { fetchDocument: DocumentFetcher; prisma?: PrismaClient; client?: ClaudeClient },
): Promise<void> {
  const prisma = deps.prisma ?? getPrisma();
  const client =
    deps.client ?? new ClaudeClient({ sink: aiRunSink(prisma), enableFallbacks: true });
  const { tenantId, dealId, documentIds } = job.data;

  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: { merchant: { include: { owners: true } } },
  });
  const docs = await prisma.document.findMany({ where: { id: { in: documentIds }, dealId } });
  if (docs.length === 0) throw new Error(`no documents found for deal ${dealId}`);

  const funders = await prisma.funder.findMany({ where: { tenantId, isActive: true } });
  const funderDescriptors = Object.fromEntries(funders.map((f) => [f.name, f.achDescriptors]));

  const files = await Promise.all(
    docs.map(async (d) => ({ data: await deps.fetchDocument(d.storageKey), fileName: d.fileName })),
  );

  const primaryOwner = deal.merchant.owners.find((o) => o.isPrimary) ?? deal.merchant.owners[0];
  const tib = deal.merchant.startDate
    ? Math.floor((Date.now() - deal.merchant.startDate.getTime()) / (30.44 * 86_400_000))
    : null;

  const result = await analyseStatements(client, {
    files,
    funderDescriptors,
    tenantId,
    dealId,
    merchant: {
      businessName: deal.merchant.legalName,
      industry: deal.merchant.industry,
      naics: deal.merchant.naics,
      state: deal.merchant.state,
      timeInBusinessMonths: tib,
      requestedAmount: deal.requestedAmount ? Number(deal.requestedAmount) : null,
      useOfFunds: deal.useOfFunds,
      ficoEstimate: primaryOwner?.ficoEstimate ?? null,
    },
  });

  await prisma.$transaction(async (tx) => {
    const analysis = await tx.bankAnalysis.create({
      data: {
        dealId,
        documentIds,
        monthlyRows: result.extraction.months,
        metrics: result.metrics as unknown as Prisma.InputJsonObject,
        paperGrade: result.preUnderwriting.suggestedGrade,
        redFlags: result.preUnderwriting.redFlags,
        maxAdvanceEstimate: result.preUnderwriting.maxAdvanceEstimate.high,
        summary: result.preUnderwriting.processorSummary,
      },
    });
    await tx.position.deleteMany({ where: { dealId, confirmedById: null } });
    await tx.position.createMany({
      data: result.positions.positions.map((p) => ({
        dealId,
        descriptor: p.descriptor,
        funderGuess: p.funderGuess,
        frequency: p.frequency,
        paymentAmount: p.paymentAmount,
        firstSeen: new Date(p.firstSeen),
        lastSeen: new Date(p.lastSeen),
        estimatedBalance: p.estimatedRemainingBalance,
        confidence: p.confidence,
        isActive: p.isActive,
      })),
    });
    await tx.deal.update({
      where: { id: dealId },
      data: {
        stage: "PRE_UNDERWRITING",
        stageChangedAt: new Date(),
        paperGrade: result.ruleGrade.grade,
      },
    });
    await tx.dealEvent.create({
      data: {
        dealId,
        type: "statement_analysis_completed",
        actorType: "ai",
        payload: {
          bankAnalysisId: analysis.id,
          ruleGrade: result.ruleGrade.grade,
          aiGrade: result.preUnderwriting.suggestedGrade,
          activePositions: result.positions.activePositionCount,
          costUsd: result.totalCostUsd,
        },
      },
    });
  });
}
