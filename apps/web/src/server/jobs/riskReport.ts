import { runRiskNarrative, type RiskNarrative } from "@mca/ai";
import { renderReportPdf, type PositionLine } from "@mca/connectors";
import type { ClaimedJob, Prisma, PrismaClient } from "@mca/db";
import {
  estimateAdvanceRange,
  riskScore,
  type AdvanceEstimate,
  type BankMetrics,
  type PaperGrade,
  type RiskScore,
  type ScrubReport,
} from "@mca/domain";
import { llmClient } from "../ai";
import { dealSubfolder, ensureDealFolder, tenantMailbox } from "../google";
import { dealProfile, lenderHistory, lenderRows } from "../lenders";
import { PermanentJobError } from "./errors";

export interface RiskReportPayload {
  dealId: string;
}

export interface StoredRiskReport {
  generatedAt: string;
  bankAnalysisId: string;
  grade: string;
  risk: RiskScore;
  advance: AdvanceEstimate | null;
  lenders: { name: string; score: number; reasons: string[] }[];
  integrityIssues: string[];
  narrative: RiskNarrative;
  pdfDocumentId: string | null;
}

interface StoredScrub {
  report: ScrubReport;
  files: {
    fileName: string;
    metadataFlags: { message: string }[];
    visualFindings: { severity: string; evidence: string; page: number | null }[];
  }[];
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Internal AI Risk Report: score, grade, advance range and lender ranking are computed in code;
 * Gemini writes the explanation. Saved on the deal and as a PDF in the deal's Drive "Internal"
 * folder, which can never be ticked for a lender package.
 */
export async function handleRiskReport(prisma: PrismaClient, job: ClaimedJob): Promise<void> {
  const { dealId } = job.payload as unknown as RiskReportPayload;
  const deal = await prisma.deal.findUnique({
    where: { id: dealId },
    include: { merchant: true, tenant: true, positions: { where: { isActive: true } } },
  });
  if (!deal) throw new PermanentJobError(`deal ${dealId} not found`);
  const analysis = await prisma.bankAnalysis.findFirst({
    where: { dealId },
    orderBy: { createdAt: "desc" },
  });
  if (!analysis?.scrub) throw new PermanentJobError("run the bank scrub before the risk report");

  const metrics = analysis.metrics as unknown as BankMetrics;
  const scrub = analysis.scrub as unknown as StoredScrub;
  const integrityIssues = scrub.files.flatMap((f) => [
    ...f.metadataFlags.map((x) => `${f.fileName}: ${x.message}`),
    ...f.visualFindings
      .filter((x) => x.severity !== "info")
      .map((x) => `${f.fileName}${x.page ? ` p.${x.page}` : ""}: ${x.evidence}`),
  ]);
  const tib = deal.merchant.startDate
    ? Math.floor((Date.now() - deal.merchant.startDate.getTime()) / (30.44 * 86_400_000))
    : null;
  const risk = riskScore({
    metrics,
    scrub: scrub.report,
    activePositions: deal.positions.length,
    timeInBusinessMonths: tib,
    integrityIssues: integrityIssues.length,
  });
  const grade = (analysis.paperGrade ?? deal.paperGrade ?? "C") as PaperGrade;
  const advance = metrics.avgMonthlyTrueRevenue
    ? estimateAdvanceRange({
        avgMonthlyDeposits: metrics.avgMonthlyTrueRevenue,
        annualRevenue: metrics.annualisedTrueRevenue,
        position: deal.positions.length + 1,
        paperGrade: grade,
      })
    : null;

  const funders = await prisma.funder.findMany({
    where: { tenantId: deal.tenantId, isActive: true },
    include: { programs: { where: { isActive: true } } },
  });
  const submitted = await prisma.submission.findMany({
    where: { deal: { merchantId: deal.merchantId }, status: { not: "WITHDRAWN" } },
    select: { funderId: true },
  });
  const ranked = lenderRows({
    funders,
    tenant: deal.tenant,
    history: await lenderHistory(prisma, deal.tenantId, grade),
    alreadySubmitted: new Set(submitted.map((s) => s.funderId)),
    profile: dealProfile({
      paperGrade: grade,
      avgMonthlyTrueRevenue: metrics.avgMonthlyTrueRevenue,
      startDate: deal.merchant.startDate,
      existingPositions: deal.positions.length,
      requestedAmount: deal.requestedAmount ? Number(deal.requestedAmount) : null,
      state: deal.merchant.state,
      naics: deal.merchant.naics,
    }),
  });
  const lenders = ranked
    .filter((r) => r.eligible && !r.already && !r.problem)
    .slice(0, 5)
    .map((r) => ({ name: r.funder.name, score: r.score, reasons: r.reasons }));

  // Facts for the model: business facts only, never SSN/DOB/EIN or owner names.
  const facts = {
    merchant: {
      business: deal.merchant.dba ?? deal.merchant.legalName,
      industry: deal.merchant.industry,
      state: deal.merchant.state,
      monthsInBusiness: tib,
      requestedAmount: deal.requestedAmount ? Number(deal.requestedAmount) : null,
      useOfFunds: deal.useOfFunds,
    },
    riskScore: risk,
    paperGrade: grade,
    metrics,
    scrubFlags: scrub.report.flags.map((f) => `${f.severity}: ${f.message}`),
    existingAdvances: scrub.report.financing,
    detectedPositions: deal.positions.map((p) => ({
      lender: p.funderGuess ?? p.descriptor,
      payment: Number(p.paymentAmount),
      frequency: p.frequency,
      estimatedBalance: p.estimatedBalance ? Number(p.estimatedBalance) : null,
    })),
    positionsListedByMerchant: deal.submissionPositions as unknown as PositionLine[],
    integrityHints: integrityIssues,
    suggestedAdvance: advance,
    rankedLenders: lenders,
  };
  const { data: narrative } = await runRiskNarrative(llmClient(prisma), {
    facts,
    tenantId: deal.tenantId,
    dealId,
  });

  const name = deal.merchant.dba ?? deal.merchant.legalName;
  const pdfDocumentId = await savePdf(prisma, deal.tenantId, dealId, deal.merchantId, name, {
    risk,
    grade,
    advance,
    lenders,
    integrityIssues,
    narrative,
    scrub: scrub.report,
    metrics,
  }).catch((err: unknown) => {
    // The report on the deal page is what matters; a Drive hiccup must not lose it.
    console.warn(
      `[risk report pdf] ${dealId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  });

  const stored: StoredRiskReport = {
    generatedAt: new Date().toISOString(),
    bankAnalysisId: analysis.id,
    grade,
    risk,
    advance,
    lenders,
    integrityIssues,
    narrative,
    pdfDocumentId,
  };
  await prisma.$transaction([
    prisma.deal.update({
      where: { id: dealId },
      data: { riskReport: stored as unknown as Prisma.InputJsonObject, riskReportAt: new Date() },
    }),
    prisma.dealEvent.create({
      data: {
        dealId,
        type: "risk_report_generated",
        actorType: "ai",
        payload: { score: risk.score, level: risk.level, grade },
      },
    }),
  ]);
}

async function savePdf(
  prisma: PrismaClient,
  tenantId: string,
  dealId: string,
  merchantId: string,
  name: string,
  r: {
    risk: RiskScore;
    grade: string;
    advance: AdvanceEstimate | null;
    lenders: StoredRiskReport["lenders"];
    integrityIssues: string[];
    narrative: RiskNarrative;
    scrub: ScrubReport;
    metrics: BankMetrics;
  },
): Promise<string> {
  const date = new Date().toISOString().slice(0, 10);
  const pdf = await renderReportPdf({
    title: `Risk Report - ${name}`,
    subtitle: `${date} - score ${r.risk.score}/100 (${r.risk.level.replace("_", " ").toLowerCase()}) - paper grade ${r.grade}`,
    footer: "INTERNAL - Ascend Fund team only - never send to lenders or the merchant",
    sections: [
      { heading: r.narrative.headline, lines: [r.narrative.summary] },
      {
        heading: "Top risks",
        lines: r.narrative.topRisks.map((x) => `- [${x.severity}] ${x.title}: ${x.detail}`),
      },
      { heading: "Strengths", lines: r.narrative.mitigants.map((m) => `- ${m}`) },
      {
        heading: "Score deductions",
        lines: r.risk.deductions.length
          ? r.risk.deductions.map((d) => `- -${d.points}: ${d.reason}`)
          : ["- none"],
      },
      {
        heading: "Bank statements",
        table: [
          ["Month", "Deposits", "True revenue", "ADB", "NSF", "Neg. days"],
          ...r.scrub.months.map((m) => [
            m.month,
            money(m.deposits),
            money(m.trueRevenue),
            money(m.averageDailyBalance),
            String(m.nsfCount),
            String(m.negativeDays),
          ]),
        ],
      },
      {
        heading: "Scrub flags and document checks",
        lines: [
          ...r.scrub.flags.map((f) => `- [${f.severity}] ${f.message}`),
          ...r.integrityIssues.map((i) => `- [check] ${i}`),
        ],
      },
      {
        heading: "Suggested structure (rule of thumb)",
        lines: r.advance
          ? [
              `${money(r.advance.low)} - ${money(r.advance.high)}, factor ${r.advance.factorLow}-${r.advance.factorHigh}, ${r.advance.termMonthsLow}-${r.advance.termMonthsHigh} months`,
            ]
          : ["Not enough revenue data."],
      },
      {
        heading: "Lenders to try first",
        lines: [
          r.narrative.lenderStrategy,
          ...r.lenders.map(
            (l) =>
              `- ${l.name} (fit ${l.score})${l.reasons.length ? `: ${l.reasons.join(", ")}` : ""}`,
          ),
        ],
      },
      {
        heading: "Questions for the merchant",
        lines: r.narrative.questionsForMerchant.map((q) => `- ${q}`),
      },
    ],
  });

  const mailbox = await tenantMailbox(prisma, tenantId);
  const folderId = await ensureDealFolder(prisma, mailbox, dealId);
  const fileName = `Risk Report - ${name} - ${date}.pdf`;
  const stored = await mailbox.drive.upload(
    { fileName, mimeType: "application/pdf", data: pdf },
    await dealSubfolder(mailbox, folderId, "Internal"),
  );
  const doc = await prisma.document.create({
    data: {
      tenantId,
      dealId,
      merchantId,
      type: "OTHER",
      internalOnly: true,
      driveFileId: stored.id,
      driveWebViewLink: stored.webViewLink,
      fileName,
      mimeType: "application/pdf",
      sizeBytes: pdf.length,
      sha256: `risk-report-${dealId}-${Date.now()}`,
      uploadedVia: "system",
    },
  });
  return doc.id;
}
