import { analyseStatements } from "@mca/ai";
import type { ClaimedJob, Prisma, PrismaClient } from "@mca/db";
import { llmClient } from "../ai";
import { tenantMailbox } from "../google";
import { PermanentJobError } from "./errors";

export interface StatementAnalysisPayload {
  dealId: string;
  documentIds: string[];
}

/** A1 → metrics → A2 → A3 on the deal's statements, read from Google Drive. */
export async function handleStatementAnalysis(
  prisma: PrismaClient,
  job: ClaimedJob,
): Promise<void> {
  const { dealId, documentIds } = job.payload as unknown as StatementAnalysisPayload;
  const tenantId = job.tenantId;

  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { merchant: { include: { owners: true } } },
  });
  if (!deal) throw new PermanentJobError(`deal ${dealId} not found`);
  const docs = await prisma.document.findMany({ where: { id: { in: documentIds }, dealId } });
  if (docs.length === 0) throw new PermanentJobError(`no documents found for deal ${dealId}`);

  const mailbox = await tenantMailbox(prisma, tenantId);
  const files = [];
  for (const d of docs)
    files.push({ data: await mailbox.drive.download(d.driveFileId), fileName: d.fileName });

  const funders = await prisma.funder.findMany({ where: { tenantId, isActive: true } });
  const funderDescriptors = Object.fromEntries(funders.map((f) => [f.name, f.achDescriptors]));
  const primaryOwner = deal.merchant.owners.find((o) => o.isPrimary) ?? deal.merchant.owners[0];
  const tib = deal.merchant.startDate
    ? Math.floor((Date.now() - deal.merchant.startDate.getTime()) / (30.44 * 86_400_000))
    : null;

  const result = await analyseStatements(llmClient(prisma), {
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
    // Pre-fill the submission email's positions block when the rep has not typed one.
    const current = (deal.submissionPositions ?? []) as unknown[];
    const positions = result.positions.positions
      .filter((p) => p.isActive)
      .map((p) => ({
        funder: p.funderGuess ?? p.descriptor,
        balance: p.estimatedRemainingBalance,
      }));
    await tx.deal.update({
      where: { id: dealId },
      data: {
        paperGrade: result.ruleGrade.grade,
        ...(current.length === 0 && positions.length ? { submissionPositions: positions } : {}),
        ...(deal.stage === "INTAKE" || deal.stage === "DOCS_RECEIVED"
          ? { stage: "PRE_UNDERWRITING", stageChangedAt: new Date() }
          : {}),
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
