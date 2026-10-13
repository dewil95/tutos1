"use server";

import { enqueueJob, getPrisma } from "@mca/db";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { READING_PLACEHOLDER, applicationUploadToPdf } from "@/server/ascendApplication";
import { requireUser } from "@/server/auth";
import { storeDealFile } from "@/server/documents";
import { inlineBudgetMs } from "@/server/env";
import { MailboxNotConnectedError, tenantMailbox } from "@/server/google";
import { runDueJobs } from "@/server/jobs/runner";

const isFile = (f: FormDataEntryValue): f is File => f instanceof File && f.size > 0;
/**
 * "New deal from an application": the merchant's application from another company is saved
 * to Drive as team-only (it is never sent to lenders), AI reads it into the merchant, owners
 * and request, and the deal page then produces Ascend's own application from those fields.
 */
export async function createDealFromApplication(form: FormData) {
  const user = await requireUser();
  const prisma = getPrisma();
  const read = async (f: File) => ({
    name: f.name,
    type: f.type,
    data: Buffer.from(await f.arrayBuffer()),
  });
  const appFiles = await Promise.all(form.getAll("application").filter(isFile).map(read));
  const statements = await Promise.all(form.getAll("statements").filter(isFile).map(read));

  let target: string;
  try {
    if (appFiles.length === 0) throw new Error("Choose the merchant's application file.");
    const app = await applicationUploadToPdf(appFiles);
    let mailbox;
    try {
      mailbox = await tenantMailbox(prisma, user.tenantId);
    } catch (err) {
      if (err instanceof MailboxNotConnectedError) {
        throw new Error("Connect Google Drive first (Settings → Connect funding@).");
      }
      throw err;
    }

    const merchant = await prisma.merchant.create({
      data: { tenantId: user.tenantId, legalName: READING_PLACEHOLDER },
    });
    const deal = await prisma.deal.create({
      data: {
        tenantId: user.tenantId,
        merchantId: merchant.id,
        ownerId: user.id,
        source: "application_upload",
        stage: statements.length ? "DOCS_RECEIVED" : "DOCS_REQUESTED",
      },
    });
    const doc = await storeDealFile(prisma, mailbox, {
      tenantId: user.tenantId,
      dealId: deal.id,
      merchantId: merchant.id,
      file: { fileName: app.fileName, mimeType: "application/pdf", data: app.data },
      type: "APPLICATION",
      uploadedVia: "staff",
      uploadedById: user.id,
      autoProcess: false,
    });
    // Another company's form: kept for the team, never packaged for a lender.
    await prisma.document.update({ where: { id: doc.id }, data: { internalOnly: true } });
    const jobId = await enqueueJob(prisma, {
      tenantId: user.tenantId,
      type: "APPLICATION_READ",
      payload: { documentId: doc.id, newDeal: true },
      dedupeKey: `appread:${doc.id}`,
    });
    for (const s of statements) {
      await storeDealFile(prisma, mailbox, {
        tenantId: user.tenantId,
        dealId: deal.id,
        merchantId: merchant.id,
        file: { fileName: s.name, mimeType: s.type || "application/pdf", data: s.data },
        type: "BANK_STATEMENT",
        uploadedVia: "staff",
        uploadedById: user.id,
      });
    }
    await prisma.dealEvent.create({
      data: {
        dealId: deal.id,
        type: "application_uploaded",
        actorType: "user",
        actorId: user.id,
        payload: { documentId: doc.id, statements: statements.length },
      },
    });
    after(() =>
      runDueJobs(prisma, { budgetMs: inlineBudgetMs(), ids: [jobId] }).then(() => undefined),
    );
    target = `/deals/${deal.id}?reading=1`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    target = `/deals/new?${new URLSearchParams({ error: message })}`;
  }
  redirect(target);
}
