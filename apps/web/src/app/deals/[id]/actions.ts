"use server";

import { enqueueJob, getPrisma, type DocumentType } from "@mca/db";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { storeDealFile } from "@/server/documents";
import { tenantMailbox } from "@/server/google";
import { runDueJobs } from "@/server/jobs/runner";
import { ensureRules, renderTemplate } from "@/server/email/rules";
import { sendTracked } from "@/server/email/send";
import { emailDryRun } from "@/server/env";
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

async function threadContext(dealId: string, submissionId: string, tenantId: string) {
  const prisma = getPrisma();
  const sub = await prisma.submission.findFirstOrThrow({
    where: { id: submissionId, dealId, deal: { tenantId } },
    include: { deal: { include: { merchant: true, tenant: true } }, funder: true },
  });
  return { prisma, sub, from: sub.deal.tenant.fromAddress ?? "funding@example.invalid" };
}

/** "Please send contracts for $X at F for N days to <merchant>", DL/VC attached, in the lender's thread. */
export async function requestContracts(dealId: string, form: FormData) {
  const user = await requireUser();
  let target: string;
  try {
    const { prisma, sub, from } = await threadContext(
      dealId,
      String(form.get("submissionId")),
      user.tenantId,
    );
    const rule = (await ensureRules(prisma, user.tenantId)).find(
      (r) => r.kind === "CONTRACT_REQUEST",
    );
    if (!rule?.enabled) throw new Error("Contract requests are turned off in Settings.");
    const amount = Number(String(form.get("amount")).replace(/[$,\s]/g, ""));
    const factor = Number(form.get("factor"));
    const termDays = Number(form.get("termDays"));
    const merchantEmail = String(form.get("merchantEmail") ?? "").trim();
    if (!(amount > 0) || !(factor >= 1) || !(termDays > 0) || !merchantEmail.includes("@")) {
      throw new Error("Fill in amount, factor, term and the merchant's email.");
    }
    const ids = form.getAll("documentIds").map(String);
    const docs = await prisma.document.findMany({
      where: {
        id: { in: ids },
        dealId,
        internalOnly: false,
        type: { in: ["VOIDED_CHECK", "DRIVERS_LICENSE"] },
      },
    });
    const attachments = [];
    if (docs.length && !emailDryRun()) {
      const mailbox = await tenantMailbox(prisma, user.tenantId);
      for (const d of docs) {
        attachments.push({
          fileName: d.fileName,
          mimeType: d.mimeType,
          data: await mailbox.drive.download(d.driveFileId),
        });
      }
    }
    const vars = {
      business: sub.deal.merchant.dba ?? sub.deal.merchant.legalName,
      amount: `$${amount.toLocaleString("en-US")}`,
      factor: String(factor),
      term: `${termDays} days`,
      merchantEmail,
    };
    await sendTracked(prisma, {
      tenantId: user.tenantId,
      dealId,
      kind: "CONTRACT_REQUEST",
      target: sub.id,
      from,
      to: sub.toAddresses,
      cc: sub.ccAddresses,
      subject: renderTemplate(rule.subject, vars),
      text: renderTemplate(rule.body, vars),
      attachments: emailDryRun()
        ? docs.map((d) => ({ fileName: d.fileName, mimeType: d.mimeType, data: Buffer.alloc(0) }))
        : attachments,
      threadId: sub.gmailThreadId,
      replyToGmailId: sub.gmailMessageId,
      userId: user.id,
    });
    await prisma.deal.update({
      where: { id: dealId },
      data: {
        soldAmount: amount,
        soldFactor: factor,
        soldTermDays: termDays,
        stage: "OFFER_ACCEPTED",
        stageChangedAt: new Date(),
      },
    });
    if (merchantEmail && !sub.deal.merchant.email) {
      await prisma.merchant.update({
        where: { id: sub.deal.merchantId },
        data: { email: merchantEmail.toLowerCase() },
      });
    }
    target = back(dealId, { sent: `Contract request sent to ${sub.funder.name}` });
  } catch (err) {
    target = back(dealId, { error: err instanceof Error ? err.message : String(err) });
  }
  revalidatePath(`/deals/${dealId}`);
  redirect(target);
}

/** One-click reply confirming the lender's clawback policy (required before commission is paid). */
export async function confirmClawback(dealId: string, form: FormData) {
  const user = await requireUser();
  let target: string;
  try {
    const { prisma, sub, from } = await threadContext(
      dealId,
      String(form.get("submissionId")),
      user.tenantId,
    );
    const rule = (await ensureRules(prisma, user.tenantId)).find(
      (r) => r.kind === "CLAWBACK_CONFIRM",
    );
    if (!rule?.enabled) throw new Error("Clawback confirmations are turned off in Settings.");
    const activity = await prisma.activity.findFirstOrThrow({
      where: { id: String(form.get("activityId")), dealId, tenantId: user.tenantId },
    });
    const vars = {
      business: sub.deal.merchant.dba ?? sub.deal.merchant.legalName,
      subject: (activity.subject ?? "").replace(/^\s*(re:\s*)+/i, ""),
    };
    await sendTracked(prisma, {
      tenantId: user.tenantId,
      dealId,
      kind: "CLAWBACK_CONFIRM",
      target: activity.id,
      from,
      // Answer whoever sent the funded email, in its thread.
      to: [activity.fromAddress ?? sub.toAddresses[0]!],
      cc: sub.ccAddresses,
      subject: renderTemplate(rule.subject, vars),
      text: renderTemplate(rule.body, vars),
      threadId: activity.threadId,
      replyToGmailId: activity.externalId?.startsWith("dry-run") ? null : activity.externalId,
      userId: user.id,
    });
    await prisma.commission.updateMany({
      where: {
        dealId,
        funderName: sub.funder.name,
        notes: { contains: "confirming the clawback" },
      },
      data: { notes: `Clawback policy confirmed ${new Date().toISOString().slice(0, 10)}.` },
    });
    target = back(dealId, { sent: `Clawback confirmation sent to ${sub.funder.name}` });
  } catch (err) {
    target = back(dealId, { error: err instanceof Error ? err.message : String(err) });
  }
  revalidatePath(`/deals/${dealId}`);
  redirect(target);
}

/** Merchant asked not to receive automated reminders (missing docs, stip chases). */
export async function setEmailOptOut(dealId: string, form: FormData) {
  const user = await requireUser();
  const prisma = getPrisma();
  const deal = await prisma.deal.findFirstOrThrow({
    where: { id: dealId, tenantId: user.tenantId },
  });
  await prisma.merchant.update({
    where: { id: deal.merchantId },
    data: { emailOptOut: form.get("optOut") === "on" },
  });
  revalidatePath(`/deals/${dealId}`);
}
