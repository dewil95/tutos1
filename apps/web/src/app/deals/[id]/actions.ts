"use server";

import { enqueueJob, getPrisma, type DocumentType } from "@mca/db";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { storeDealFile } from "@/server/documents";
import { tenantMailbox } from "@/server/google";
import { runDueJobs } from "@/server/jobs/runner";
import { parsePositions, queueSubmissions } from "@/server/submissions";

const back = (dealId: string, params: Record<string, string>) =>
  `/deals/${dealId}?${new URLSearchParams(params).toString()}`;

/** One click → one email per selected lender (queued, then sent right after the response). */
export async function sendToLenders(dealId: string, form: FormData) {
  const user = await requireUser();
  const prisma = getPrisma();
  let target: string;
  try {
    const plan = await queueSubmissions(prisma, {
      tenantId: user.tenantId,
      userId: user.id,
      dealId,
      funderIds: form.getAll("funderIds").map(String),
      documentIds: form.getAll("documentIds").map(String),
      positions: parsePositions(String(form.get("positions") ?? "")),
      note: String(form.get("note") ?? "").trim() || null,
    });
    after(() => runDueJobs(prisma, { budgetMs: 50_000, ids: plan.jobIds }).then(() => undefined));
    target = back(dealId, {
      queued: String(plan.jobIds.length),
      ...(plan.skipped.length
        ? { skipped: plan.skipped.map((s) => `${s.funderName}: ${s.reason}`).join("; ") }
        : {}),
    });
  } catch (err) {
    target = back(dealId, { error: err instanceof Error ? err.message : String(err) });
  }
  revalidatePath(`/deals/${dealId}`);
  redirect(target);
}

/** Upload from the deal page straight into the deal's Google Drive folder. */
export async function uploadFiles(dealId: string, form: FormData) {
  const user = await requireUser();
  const prisma = getPrisma();
  let target: string;
  try {
    const deal = await prisma.deal.findFirstOrThrow({
      where: { id: dealId, tenantId: user.tenantId },
    });
    const mailbox = await tenantMailbox(prisma, user.tenantId);
    const type = String(form.get("type") ?? "") as DocumentType | "";
    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new Error("Choose at least one file.");
    for (const f of files) {
      await storeDealFile(prisma, mailbox, {
        tenantId: user.tenantId,
        dealId,
        merchantId: deal.merchantId,
        file: {
          fileName: f.name,
          mimeType: f.type || "application/octet-stream",
          data: Buffer.from(await f.arrayBuffer()),
        },
        uploadedVia: "staff",
        uploadedById: user.id,
        type: type || undefined,
      });
    }
    target = back(dealId, { uploaded: String(files.length) });
  } catch (err) {
    target = back(dealId, { error: err instanceof Error ? err.message : String(err) });
  }
  revalidatePath(`/deals/${dealId}`);
  redirect(target);
}

export async function relabelDocument(dealId: string, form: FormData) {
  const user = await requireUser();
  const id = String(form.get("documentId"));
  const type = String(form.get("type")) as DocumentType;
  await getPrisma().document.updateMany({
    where: { id, dealId, tenantId: user.tenantId },
    data: { type },
  });
  revalidatePath(`/deals/${dealId}`);
}

/** Runs A1→A2→A3 on the selected statements (Gemini) to pre-fill grade and positions. */
export async function analyseDealStatements(dealId: string, form: FormData) {
  const user = await requireUser();
  const prisma = getPrisma();
  const documentIds = form.getAll("documentIds").map(String);
  const docs = await prisma.document.findMany({
    where: {
      id: { in: documentIds },
      dealId,
      tenantId: user.tenantId,
      type: { in: ["BANK_STATEMENT", "MTD_STATEMENT"] },
    },
    select: { id: true },
  });
  if (docs.length === 0)
    redirect(back(dealId, { error: "Select at least one bank statement to analyse." }));
  const jobId = await enqueueJob(prisma, {
    tenantId: user.tenantId,
    type: "STATEMENT_ANALYSIS",
    payload: { dealId, documentIds: docs.map((d) => d.id) },
    dedupeKey: `analysis:${dealId}`,
  });
  after(() => runDueJobs(prisma, { budgetMs: 55_000, ids: [jobId] }).then(() => undefined));
  redirect(back(dealId, { analysing: "1" }));
}

/** Retry a lender whose send failed (job FAILED, submission still DRAFT). */
export async function retrySubmission(dealId: string, form: FormData) {
  const user = await requireUser();
  const prisma = getPrisma();
  const id = String(form.get("submissionId"));
  const sub = await prisma.submission.findFirst({
    where: { id, dealId, status: "DRAFT", deal: { tenantId: user.tenantId } },
  });
  if (sub) {
    const jobId = await enqueueJob(prisma, {
      tenantId: user.tenantId,
      type: "SEND_SUBMISSION",
      payload: { submissionId: sub.id },
      dedupeKey: `send:${sub.id}`,
    });
    after(() => runDueJobs(prisma, { budgetMs: 50_000, ids: [jobId] }).then(() => undefined));
  }
  redirect(back(dealId, { queued: "1" }));
}
