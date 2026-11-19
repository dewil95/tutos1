import { runDocumentQa, runStatementExtraction, type StatementExtraction } from "@mca/ai";
import { inspectPdf } from "@mca/connectors";
import { enqueueJob, type ClaimedJob, type Prisma, type PrismaClient } from "@mca/db";
import { llmClient } from "../ai";
import { queueDocumentWork } from "../documents";
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

  const verdict = classifyExtraction(a1.data);
  if (verdict.kind === "unreadable") {
    // Fails at once (no retry: the file is what it is). The deal page lists it as unreadable
    // and "Re-run bank scrub" tries again after the file is fixed; the scrub goes on without it.
    await queueScrubWhenReady(prisma, doc.tenantId, doc.dealId, doc.id);
    throw new PermanentJobError(`The AI found no monthly figures in ${doc.fileName}`);
  }

  const months = a1.data.months;
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const updated = await prisma.document.update({
    where: { id: doc.id },
    data: {
      extraction: a1.data as unknown as Prisma.InputJsonObject,
      fraudFlags: { metadata, qa: qa?.data ?? null } as unknown as Prisma.InputJsonObject,
      extractedAt: new Date(),
      ...(verdict.kind === "statement"
        ? {
            periodStart: first ? new Date(`${first.month}-01T00:00:00Z`) : null,
            periodEnd: last ? endOfMonth(last.month) : null,
            bankName: first?.bankName ?? null,
            accountLast4: first?.accountLast4 ?? null,
          }
        : { type: verdict.type }),
    },
  });
  if (verdict.kind === "reclassified") {
    // Filed under what it really is, on the record; an application goes on to be read.
    await prisma.dealEvent.create({
      data: {
        dealId: doc.dealId,
        type: "document_reclassified",
        actorType: "ai",
        payload: { documentId: doc.id, fileName: doc.fileName, from: doc.type, to: verdict.type },
      },
    });
    if (verdict.type === "APPLICATION") await queueDocumentWork(prisma, updated);
  }
  await queueScrubWhenReady(prisma, doc.tenantId, doc.dealId, doc.id);
}

/**
 * What A1 made of a file sent as a bank statement: a statement with monthly figures; a file
 * that is really something else (filed as that); or a statement the model could not read
 * (no monthly figures, or nothing recognised), which must be reported, never silently dropped.
 */
export function classifyExtraction(
  data: Pick<StatementExtraction, "months" | "documents">,
):
  | { kind: "statement" }
  | { kind: "reclassified"; type: "APPLICATION" | "OTHER" }
  | { kind: "unreadable" } {
  const found = data.documents[0]?.type;
  const saysStatement = data.documents.some((d) => d.type === "BANK_STATEMENT");
  if (saysStatement && data.months.length > 0) return { kind: "statement" };
  if (!saysStatement && found)
    return { kind: "reclassified", type: found === "APPLICATION" ? "APPLICATION" : "OTHER" };
  return { kind: "unreadable" };
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
