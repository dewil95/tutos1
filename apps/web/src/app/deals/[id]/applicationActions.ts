"use server";

import { enqueueJob, getPrisma } from "@mca/db";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import {
  READING_PLACEHOLDER,
  applicationFileBase,
  applicationUploadToPdf,
} from "@/server/ascendApplication";
import { requireUser } from "@/server/auth";
import { storeDealFile } from "@/server/documents";
import { fileAscendApplication } from "@/server/applicationFile";
import { InputError, writeApplicationForm } from "@/server/applicationForm";
import { sendTracked } from "@/server/email/send";
import {
  applyUploadSignature,
  clientIp,
  createWebApplication,
  signWebApplication,
} from "@/server/webApplication";
import { TEXT } from "@/app/application/copy";
import { inlineBudgetMs } from "@/server/env";
import { tenantMailbox } from "@/server/google";
import { runDueJobs } from "@/server/jobs/runner";

const back = (dealId: string, params: Record<string, string>) =>
  `/deals/${dealId}?${new URLSearchParams(params).toString()}#ascend-application`;

/** Saves the application fields typed or corrected on the deal page. */
export async function saveApplicationDetails(dealId: string, form: FormData) {
  const user = await requireUser();
  const prisma = getPrisma();
  let target: string;
  try {
    const deal = await prisma.deal.findFirstOrThrow({
      where: { id: dealId, tenantId: user.tenantId },
      include: { merchant: { include: { owners: true } } },
    });
    await writeApplicationForm(prisma, deal, form);
    await prisma.dealEvent.create({
      data: { dealId, type: "application_edited", actorType: "user", actorId: user.id },
    });
    await fileAscendApplication(prisma, user.tenantId, dealId);
    target = back(dealId, { saved: "1" });
  } catch (err) {
    if (!(err instanceof InputError)) console.error(`[deal ${dealId}] save application`, err);
    target = back(dealId, { error: err instanceof Error ? err.message : String(err) });
  }
  revalidatePath(`/deals/${dealId}`);
  redirect(target);
}

/**
 * The merchant signed Ascend's application: the signed copy is filed as the deal's
 * application, which the ship panel ticks for lenders by default.
 */
export async function uploadSignedApplication(dealId: string, form: FormData) {
  const user = await requireUser();
  const prisma = getPrisma();
  let target: string;
  try {
    const deal = await prisma.deal.findFirstOrThrow({
      where: { id: dealId, tenantId: user.tenantId },
      include: { merchant: true },
    });
    const files = await Promise.all(
      form
        .getAll("signed")
        .filter((f): f is File => f instanceof File && f.size > 0)
        .map(async (f) => ({
          name: f.name,
          type: f.type,
          data: Buffer.from(await f.arrayBuffer()),
        })),
    );
    if (files.length === 0) throw new Error("Choose the signed application.");
    const pdf = await applicationUploadToPdf(files);
    const name =
      deal.merchant.legalName === READING_PLACEHOLDER
        ? null
        : (deal.merchant.dba ?? deal.merchant.legalName);
    const mailbox = await tenantMailbox(prisma, user.tenantId);
    const doc = await storeDealFile(prisma, mailbox, {
      tenantId: user.tenantId,
      dealId,
      merchantId: deal.merchantId,
      // The house file name lenders already know.
      file: {
        fileName: `${applicationFileBase(name)}.pdf`,
        mimeType: "application/pdf",
        data: pdf.data,
      },
      type: "APPLICATION",
      uploadedVia: "staff",
      uploadedById: user.id,
      // The fields are already in the CRM; reading the signed copy again would only cost money.
      autoProcess: false,
    });
    if (doc.internalOnly) throw new Error("That file is the other company's application.");
    await prisma.dealEvent.create({
      data: {
        dealId,
        type: "application_signed",
        actorType: "user",
        actorId: user.id,
        payload: { channel: "upload", documentId: doc.id },
      },
    });
    target = back(dealId, { signed: "1" });
  } catch (err) {
    target = back(dealId, { error: err instanceof Error ? err.message : String(err) });
  }
  revalidatePath(`/deals/${dealId}`);
  redirect(target);
}

/** Reads the uploaded application again (after a failure, or a better scan). */
export async function rereadApplication(dealId: string, form: FormData) {
  const user = await requireUser();
  const prisma = getPrisma();
  const documentId = String(form.get("documentId"));
  const doc = await prisma.document.findFirst({
    where: { id: documentId, dealId, tenantId: user.tenantId },
  });
  if (!doc) redirect(back(dealId, { error: "File not found." }));
  const deal = await prisma.deal.findUniqueOrThrow({
    where: { id: dealId },
    include: { merchant: { select: { legalName: true } } },
  });
  const jobId = await enqueueJob(prisma, {
    tenantId: user.tenantId,
    type: "APPLICATION_READ",
    payload: {
      documentId: doc.id,
      newDeal: deal.merchant.legalName === READING_PLACEHOLDER,
    },
    dedupeKey: `appread:${doc.id}`,
  });
  after(() =>
    runDueJobs(prisma, { budgetMs: inlineBudgetMs(), ids: [jobId] }).then(() => undefined),
  );
  redirect(back(dealId, { reading: "1" }));
}

/**
 * A private link for the merchant to check, complete and e-sign Ascend's application
 * (/application/<token>). Emailed to the owner when asked (test mode only logs the email).
 */
export async function createSigningLink(dealId: string, form: FormData) {
  const user = await requireUser();
  const prisma = getPrisma();
  const deal = await prisma.deal.findFirstOrThrow({
    where: { id: dealId, tenantId: user.tenantId },
    include: {
      merchant: { include: { owners: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } } },
      tenant: true,
    },
  });
  const token = await createWebApplication(prisma, {
    tenantId: user.tenantId,
    dealId,
    origin: "team",
  });
  const params: Record<string, string> = { signlink: token };
  const to = deal.merchant.owners[0]?.email ?? deal.merchant.email;
  if (form.get("email") === "yes") {
    if (!to || !deal.tenant.fromAddress || !process.env.APP_URL) {
      params.error = "No email on the application (or no sending mailbox): send the link yourself.";
    } else {
      try {
        const first = deal.merchant.owners[0]?.firstName;
        const { dryRun } = await sendTracked(prisma, {
          tenantId: user.tenantId,
          dealId,
          kind: "web_application_link",
          audience: "merchant",
          target: to,
          from: deal.tenant.fromAddress,
          to: [to],
          cc: [],
          subject: "Please review and sign your funding application",
          text: `Hi${first ? ` ${first}` : ""},\n\nYour funding application is ready. Please check the details, add anything missing and sign online with this private link (it expires in 14 days):\n\n${process.env.APP_URL}/application/${token}\n\nPlease don't share this link.`,
          userId: user.id,
        });
        params.emailed = dryRun ? `dry-run:${to}` : to;
      } catch (err) {
        console.error(`[deal ${dealId}] signing link email`, err);
        params.error = "The email could not be sent: send the link yourself.";
      }
    }
  }
  await prisma.dealEvent.create({
    data: { dealId, type: "signing_link_created", actorType: "user", actorId: user.id },
  });
  redirect(back(dealId, params));
}

/**
 * The merchant signs Ascend's application right on the deal page (they are with the team): same
 * checks and proof as the online signing page, through a team link that is used at once.
 */
export async function signHereNow(dealId: string, form: FormData) {
  const user = await requireUser();
  const prisma = getPrisma();
  const h = await headers();
  // Signed from step 2 of New deal: errors go back there.
  const fail = (error: string) =>
    form.get("from") === "new"
      ? `/deals/new?${new URLSearchParams({ deal: dealId, error })}`
      : back(dealId, { error });
  let target: string;
  try {
    await prisma.deal.findFirstOrThrow({ where: { id: dealId, tenantId: user.tenantId } });
    const token = await createWebApplication(prisma, {
      tenantId: user.tenantId,
      dealId,
      origin: "team",
    });
    const result = await signWebApplication(prisma, token, {
      name: "",
      agreed: form.get("agree") === "yes",
      drawing: String(form.get("drawing") ?? "") || null,
      fingerprint: String(form.get("fingerprint") ?? ""),
      ip: clientIp(h),
      userAgent: h.get("user-agent"),
    });
    target = result.ok ? back(dealId, { signed: "1" }) : fail(TEXT.en.errors[result.error]);
  } catch (err) {
    console.error(`[deal ${dealId}] sign here`, err);
    target = fail("Signing failed. Nothing was signed: try again.");
  }
  revalidatePath(`/deals/${dealId}`);
  redirect(target);
}

/**
 * The merchant signed at upload, before Ascend's application was filled in: once the team has
 * checked the filled application, that signature goes on it.
 */
export async function applySignatureAtUpload(dealId: string, form: FormData) {
  const user = await requireUser();
  const prisma = getPrisma();
  const fromNew = form.get("from") === "new";
  const fail = (error: string) =>
    fromNew
      ? `/deals/new?${new URLSearchParams({ deal: dealId, error })}`
      : back(dealId, { error });
  let target: string;
  try {
    await prisma.deal.findFirstOrThrow({ where: { id: dealId, tenantId: user.tenantId } });
    const result = await applyUploadSignature(prisma, user.tenantId, dealId);
    if (result.ok) {
      await prisma.dealEvent.create({
        data: {
          dealId,
          type: "upload_signature_applied",
          actorType: "user",
          actorId: user.id,
        },
      });
    }
    target = result.ok
      ? back(dealId, { signed: "1" })
      : result.error === "none"
        ? fail("There is no signature from the upload to apply.")
        : fail(TEXT.en.errors[result.error]);
  } catch (err) {
    console.error(`[deal ${dealId}] apply upload signature`, err);
    target = fail("Applying the signature failed. Nothing was signed: try again.");
  }
  revalidatePath(`/deals/${dealId}`);
  redirect(target);
}
