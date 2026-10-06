import { runPositionDetection, type StatementExtraction } from "@mca/ai";
import { enqueueJob, type ClaimedJob, type Prisma, type PrismaClient } from "@mca/db";
import { computeBankMetrics, gradePaper, scrubStatements, type ScrubRow } from "@mca/domain";
import { llmClient } from "../ai";
import { PermanentJobError } from "./errors";
import { STATEMENT_TYPES } from "./statementExtract";

export interface StatementScrubPayload {
  dealId: string;
}

const MAX_MONTHS = 6;

/** Rows from every extracted statement on the deal: newest file wins a duplicated month. */
export function collectRows(
  docs: { id: string; fileName: string; createdAt: Date; extraction: unknown }[],
): { rows: ScrubRow[]; sourceByMonth: Record<string, string> } {
  const byKey = new Map<string, { row: ScrubRow; docId: string; at: number }>();
  for (const d of docs) {
    const ex = d.extraction as StatementExtraction | null;
    for (const m of ex?.months ?? []) {
      const key = `${m.month}|${m.accountLast4 ?? "?"}`;
      const prev = byKey.get(key);
      if (!prev || prev.at < d.createdAt.getTime()) {
        byKey.set(key, { row: m as ScrubRow, docId: d.id, at: d.createdAt.getTime() });
      }
    }
  }
  const all = [...byKey.values()].sort((a, b) => b.row.month.localeCompare(a.row.month));
  const keepMonths = [...new Set(all.map((x) => x.row.month))].slice(0, MAX_MONTHS);
  const kept = all.filter((x) => keepMonths.includes(x.row.month));
  return {
    rows: kept.map((x) => x.row),
    sourceByMonth: Object.fromEntries(
      kept.map((x) => [`${x.row.month}|${x.row.accountLast4 ?? "?"}`, x.docId]),
    ),
  };
}

/**
 * Bank scrub, step 2 of 2: deterministic checks over all extracted months (balance math, gaps,
 * NSFs, negative days, holdback burden, stacking), metrics + rule grade, and A2 positions.
 * Then queues the internal AI Risk Report.
 */
export async function handleStatementScrub(prisma: PrismaClient, job: ClaimedJob): Promise<void> {
  const { dealId } = job.payload as unknown as StatementScrubPayload;
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { merchant: { include: { owners: true } } },
  });
  if (!deal) throw new PermanentJobError(`deal ${dealId} not found`);
  const docs = await prisma.document.findMany({
    where: { dealId, type: { in: [...STATEMENT_TYPES] }, extractedAt: { not: null } },
    select: { id: true, fileName: true, createdAt: true, extraction: true, fraudFlags: true },
  });
  const { rows, sourceByMonth } = collectRows(docs);
  if (rows.length === 0)
    throw new PermanentJobError("no statement months were extracted on this deal");

  const report = scrubStatements(rows, { asOf: new Date() });
  const metrics = computeBankMetrics(rows);
  const funders = await prisma.funder.findMany({
    where: { tenantId: deal.tenantId, isActive: true },
  });
  const positions = await runPositionDetection(llmClient(prisma), {
    months: rows as unknown as StatementExtraction["months"],
    funderDescriptors: Object.fromEntries(funders.map((f) => [f.name, f.achDescriptors])),
    tenantId: deal.tenantId,
    dealId,
  });
  const tib = deal.merchant.startDate
    ? Math.floor((Date.now() - deal.merchant.startDate.getTime()) / (30.44 * 86_400_000))
    : null;
  const owner = deal.merchant.owners.find((o) => o.isPrimary) ?? deal.merchant.owners[0];
  const ruleGrade = gradePaper({
    metrics,
    ficoEstimate: owner?.ficoEstimate ?? null,
    timeInBusinessMonths: tib,
    existingPositions: positions.data.activePositionCount,
  });

  const files = docs.map((d) => {
    const f = (d.fraudFlags ?? {}) as {
      metadata?: { flags?: { code: string; message: string }[]; producer?: string | null };
      qa?: {
        findings?: { issue: string; severity: string; page: number | null; evidence: string }[];
        looksAuthentic?: boolean;
      };
    };
    return {
      documentId: d.id,
      fileName: d.fileName,
      metadataFlags: f.metadata?.flags ?? [],
      producer: f.metadata?.producer ?? null,
      visualFindings: f.qa?.findings ?? [],
      looksAuthentic: f.qa?.looksAuthentic ?? null,
    };
  });

  await prisma.$transaction(async (tx) => {
    const analysis = await tx.bankAnalysis.create({
      data: {
        dealId,
        documentIds: docs.map((d) => d.id),
        monthlyRows: rows as unknown as Prisma.InputJsonArray,
        metrics: metrics as unknown as Prisma.InputJsonObject,
        paperGrade: ruleGrade.grade,
        redFlags: report.flags as unknown as Prisma.InputJsonArray,
        scrub: { report, files, sourceByMonth, ruleGrade } as unknown as Prisma.InputJsonObject,
      },
    });
    await tx.position.deleteMany({ where: { dealId, confirmedById: null } });
    await tx.position.createMany({
      data: positions.data.positions.map((p) => ({
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
    const current = (deal.submissionPositions ?? []) as unknown[];
    const lines = positions.data.positions
      .filter((p) => p.isActive)
      .map((p) => ({
        funder: p.funderGuess ?? p.descriptor,
        balance: p.estimatedRemainingBalance,
      }));
    await tx.deal.update({
      where: { id: dealId },
      data: {
        paperGrade: ruleGrade.grade,
        ...(current.length === 0 && lines.length ? { submissionPositions: lines } : {}),
        ...(["INTAKE", "DOCS_REQUESTED", "DOCS_RECEIVED"].includes(deal.stage)
          ? { stage: "PRE_UNDERWRITING", stageChangedAt: new Date() }
          : {}),
      },
    });
    await tx.dealEvent.create({
      data: {
        dealId,
        type: "bank_scrub_completed",
        actorType: "ai",
        payload: {
          bankAnalysisId: analysis.id,
          grade: ruleGrade.grade,
          critical: report.flags.filter((f) => f.severity === "critical").length,
          warnings: report.flags.filter((f) => f.severity === "warning").length,
          activePositions: positions.data.activePositionCount,
        },
      },
    });
  });
  // Next: the internal Risk Report built on this scrub.
  await enqueueJob(prisma, {
    tenantId: deal.tenantId,
    type: "RISK_REPORT",
    payload: { dealId },
    dedupeKey: `risk:${dealId}`,
  });
}
