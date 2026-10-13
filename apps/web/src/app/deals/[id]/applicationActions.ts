"use server";

import { encryptSecret, enqueueJob, getPrisma, type EntityType } from "@mca/db";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  READING_PLACEHOLDER,
  applicationFileBase,
  applicationUploadToPdf,
} from "@/server/ascendApplication";
import { requireUser } from "@/server/auth";
import { storeDealFile } from "@/server/documents";
import { inlineBudgetMs, requireEnv } from "@/server/env";
import { tenantMailbox } from "@/server/google";
import { runDueJobs } from "@/server/jobs/runner";

const back = (dealId: string, params: Record<string, string>) =>
  `/deals/${dealId}?${new URLSearchParams(params).toString()}#ascend-application`;

const ENTITY_TYPES = ["LLC", "CORP", "S_CORP", "SOLE_PROP", "PARTNERSHIP", "NONPROFIT", "OTHER"];

class InputError extends Error {}

function reader(form: FormData) {
  const text = (k: string) => String(form.get(k) ?? "").trim() || null;
  const money = (k: string) => {
    const v = text(k);
    if (v === null) return null;
    const n = Number(v.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0) throw new InputError(`Check the number in "${k}".`);
    return n;
  };
  const date = (k: string, what: string) => {
    const v = text(k);
    if (v === null) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))
      throw new InputError(`${what}: use a full date.`);
    return v;
  };
  const state = (k: string) => {
    const v = text(k);
    if (v === null) return null;
    if (!/^[A-Za-z]{2}$/.test(v)) throw new InputError("State: use the 2-letter code (e.g. FL).");
    return v.toUpperCase();
  };
  const digits = (k: string, n: number, what: string) => {
    const v = text(k);
    if (v === null) return null;
    const d = v.replace(/\D/g, "");
    if (d.length !== n) throw new InputError(`${what}: ${n} digits.`);
    return d;
  };
  return { text, money, date, state, digits };
}

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
    const key = requireEnv("PII_ENCRYPTION_KEY");
    const r = reader(form);
    const legalName = r.text("legalName");
    if (!legalName) throw new InputError("Business legal name is required.");
    const entity = r.text("entityType");
    if (entity && !ENTITY_TYPES.includes(entity)) throw new InputError("Pick an entity type.");
    const ein = r.digits("ein", 9, "EIN");
    const startDate = r.date("startDate", "Business start date");
    const email = r.text("email")?.toLowerCase() ?? null;

    await prisma.merchant.update({
      where: { id: deal.merchantId },
      data: {
        legalName,
        dba: r.text("dba"),
        entityType: (entity as EntityType | null) ?? null,
        ...(ein
          ? {
              einEncrypted: encryptSecret(`${ein.slice(0, 2)}-${ein.slice(2)}`, key),
              einLast4: ein.slice(-4),
            }
          : {}),
        startDate: startDate ? new Date(startDate) : null,
        industry: r.text("industry"),
        phone: r.text("phone"),
        email,
        website: r.text("website"),
        addressLine1: r.text("line1"),
        city: r.text("city"),
        state: r.state("state"),
        postalCode: r.text("postalCode"),
      },
    });
    await prisma.deal.update({
      where: { id: dealId },
      data: {
        requestedAmount: r.money("amount"),
        useOfFunds: r.text("useOfFunds"),
        statedMonthlyRevenue: r.money("monthlyRevenue"),
      },
    });

    for (const i of [0, 1]) {
      const firstName = r.text(`firstName-${i}`);
      const lastName = r.text(`lastName-${i}`);
      const ownerId = r.text(`ownerId-${i}`);
      const existing = deal.merchant.owners.find((o) => o.id === ownerId);
      if (!firstName || !lastName) {
        if (existing || r.text(`ssn-${i}`) || r.text(`email-${i}`))
          throw new InputError(`Owner ${i + 1}: first and last name are required.`);
        continue;
      }
      const ssn = r.digits(`ssn-${i}`, 9, `Owner ${i + 1} SSN`);
      const dob = r.date(`dob-${i}`, `Owner ${i + 1} date of birth`);
      const pct = r.money(`pct-${i}`);
      if (pct !== null && pct > 100) throw new InputError(`Owner ${i + 1}: ownership over 100%.`);
      const score = r.money(`score-${i}`);
      const data = {
        firstName,
        lastName,
        ownershipPct: pct,
        email: r.text(`email-${i}`)?.toLowerCase() ?? null,
        phone: r.text(`phone-${i}`),
        addressLine1: r.text(`line1-${i}`),
        city: r.text(`city-${i}`),
        state: r.state(`state-${i}`),
        postalCode: r.text(`postalCode-${i}`),
        ficoEstimate: score === null ? null : Math.round(score),
        ...(ssn
          ? {
              ssnEncrypted: encryptSecret(
                `${ssn.slice(0, 3)}-${ssn.slice(3, 5)}-${ssn.slice(5)}`,
                key,
              ),
              ssnLast4: ssn.slice(-4),
            }
          : {}),
        ...(dob ? { dobEncrypted: encryptSecret(dob, key) } : {}),
      };
      if (existing) await prisma.owner.update({ where: { id: existing.id }, data });
      else
        await prisma.owner.create({
          data: {
            merchantId: deal.merchantId,
            isPrimary: deal.merchant.owners.length === 0 && i === 0,
            ...data,
          },
        });
    }
    await prisma.dealEvent.create({
      data: { dealId, type: "application_edited", actorType: "user", actorId: user.id },
    });
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
