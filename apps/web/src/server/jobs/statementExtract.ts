import { runDocumentQa, runStatementExtraction, type StatementExtraction } from "@mca/ai";
import { inspectPdf } from "@mca/connectors";
import { enqueueJob, type ClaimedJob, type Prisma, type PrismaClient } from "@mca/db";
import { llmClient } from "../ai";
import { tenantMailbox } from "../google";
import { PermanentJobError } from "./errors";

export interface StatementExtractPayload {
  documentId: string;
}

export const STATEMENT_TYPES = ["BANK_STATEMENT"] as const;

/**
 * Bank scrub, step 1 of 2, one statement per job so each run fits a serverless request:
 * A1 extracts the month (Gemini), the file's PDF history is checked, and A4 looks for visual
 * signs of editing. When the deal's last statement finishes, the scrub job is queued.
 */
export async function handleStatementExtract(prisma: PrismaClient, job: ClaimedJob): Promise<void> {
  const { documentId } = job.payload as unknown as StatementExtractPayload;
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc?.dealId) throw new PermanentJobError(`document ${documentId} is not on a deal`);

  const mailbox = await tenantMailbox(prisma, doc.tenantId);
  const data = await mailbox.drive.download(doc.driveFileId);
  const client = llmClient(prisma);
  const file = { data, fileName: doc.fileName };
  const isPdf = doc.mimeType === "application/pdf";

  const [a1, metadata, qa] = await Promise.all([
    runStatementExtraction(client, {
      files: [file],
      effort: "medium",
      tenantId: doc.tenantId,
      dealId: doc.dealId,
    }),
    isPdf ? inspectPdf(data) : Promise.resolve(null),
    // The integrity check is a second opinion; its failure must not block the scrub.
    runDocumentQa(client, { file, tenantId: doc.tenantId, dealId: doc.dealId }).catch(
      (err: unknown) => {
        console.warn(`[A4] ${doc.id}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      },
    ),
  ]);

  const months = a1.data.months;
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const isStatement =
    a1.data.documents.some((d) => d.type === "BANK_STATEMENT") && months.length > 0;

  await prisma.document.update({
    where: { id: doc.id },
    data: {
      extraction: a1.data as unknown as Prisma.InputJsonObject,
      fraudFlags: { metadata, qa: qa?.data ?? null } as unknown as Prisma.InputJsonObject,
      extractedAt: new Date(),
      ...(isStatement
        ? {
            periodStart: first ? new Date(`${first.month}-01T00:00:00Z`) : null,
            periodEnd: last ? endOfMonth(last.month) : null,
            bankName: first?.bankName ?? null,
            accountLast4: first?.accountLast4 ?? null,
          }
        : { type: a1.data.documents[0]?.type === "APPLICATION" ? "APPLICATION" : "OTHER" }),
    },
  });
  await queueScrubWhenReady(prisma, doc.tenantId, doc.dealId, doc.id);
}

function endOfMonth(month: string): Date {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0));
}

/** Queues the deal's scrub once no other statement on it is still being read. */
export async function queueScrubWhenReady(
  prisma: PrismaClient,
  tenantId: string,
  dealId: string,
  justFinished?: string,
): Promise<string | null> {
  const pending = await prisma.document.findMany({
    where: {
      dealId,
      type: { in: [...STATEMENT_TYPES] },
      extractedAt: null,
      id: { not: justFinished },
    },
    select: { id: true },
  });
  if (pending.length) {
    const live = await prisma.job.count({
      where: {
        dedupeKey: { in: pending.map((d) => `extract:${d.id}`) },
        status: { in: ["QUEUED", "RUNNING"] },
      },
    });
    if (live > 0) return null; // the last one to finish queues the scrub
  }
  return enqueueJob(prisma, {
    tenantId,
    type: "STATEMENT_SCRUB",
    payload: { dealId },
    dedupeKey: `scrub:${dealId}`,
  });
}

export type ExtractedStatement = StatementExtraction;
