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
    where: { id: { in: documentIds }, dealId, tenantId: user.tenantId, type: "BANK_STATEMENT" },
    select: { id: true },
  });
  if (docs.length === 0)
    redirect(back(dealId, { error: "Tick at least one bank statement to scrub." }));
  // Re-read the ticked statements (e.g. after fixing a file type), then scrub the whole deal.
  await prisma.document.updateMany({
    where: { id: { in: docs.map((d) => d.id) } },
    data: { extractedAt: null },
  });
  const jobIds: string[] = [];
  for (const d of docs) {
    jobIds.push(
      await enqueueJob(prisma, {
        tenantId: user.tenantId,
        type: "STATEMENT_EXTRACT",
        payload: { documentId: d.id },
        dedupeKey: `extract:${d.id}`,
      }),
    );
  }
  after(() => runDueJobs(prisma, { budgetMs: 55_000, ids: jobIds }).then(() => undefined));
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

const MERCHANT_FIELDS = new Set([
  "legalName",
  "dba",
  "entityType",
  "naics",
  "industry",
  "startDate",
  "website",
  "phone",
  "email",
  "addressLine1",
  "city",
  "state",
  "postalCode",
]);

/** Settles one application-vs-saved difference: apply the application value or keep ours. */
export async function resolveConflict(dealId: string, form: FormData) {
  const user = await requireUser();
  const prisma = getPrisma();
  const deal = await prisma.deal.findFirstOrThrow({
    where: { id: dealId, tenantId: user.tenantId },
  });
  const field = String(form.get("field"));
  const app = (deal.applicationData ?? {}) as {
    conflicts?: { field: string; fromApplication: string }[];
  };
  const conflict = app.conflicts?.find((c) => c.field === field);
  if (conflict && form.get("choice") === "application") {
    const name = field.replace(/^merchant\./, "");
    if (field.startsWith("merchant.") && MERCHANT_FIELDS.has(name)) {
      const value =
        name === "startDate" ? new Date(conflict.fromApplication) : conflict.fromApplication;
      await prisma.merchant.update({ where: { id: deal.merchantId }, data: { [name]: value } });
    }
  }
  await prisma.deal.update({
    where: { id: dealId },
    data: {
      applicationData: {
        ...app,
        conflicts: (app.conflicts ?? []).filter((c) => c.field !== field),
      },
    },
  });
  revalidatePath(`/deals/${dealId}`);
}

export async function verifyScrub(dealId: string, form: FormData) {
  const user = await requireUser();
  await getPrisma().bankAnalysis.updateMany({
    where: { id: String(form.get("analysisId")), dealId, deal: { tenantId: user.tenantId } },
    data: { verifiedById: user.id, verifiedAt: new Date() },
  });
  revalidatePath(`/deals/${dealId}`);
}

export async function regenerateRiskReport(dealId: string) {
  const user = await requireUser();
  const prisma = getPrisma();
  await prisma.deal.findFirstOrThrow({ where: { id: dealId, tenantId: user.tenantId } });
  const jobId = await enqueueJob(prisma, {
    tenantId: user.tenantId,
    type: "RISK_REPORT",
    payload: { dealId },
    dedupeKey: `risk:${dealId}`,
  });
  after(() => runDueJobs(prisma, { budgetMs: 55_000, ids: [jobId] }).then(() => undefined));
  redirect(back(dealId, { risk: "1" }));
}
