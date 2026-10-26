"use server";

import { getPrisma } from "@mca/db";
import { after } from "next/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { applicationUploadToPdf } from "@/server/ascendApplication";
import { InputError, writeApplicationForm } from "@/server/applicationForm";
import { sendTracked } from "@/server/email/send";
import { inlineBudgetMs } from "@/server/env";
import { runDueJobs } from "@/server/jobs/runner";
import {
  clientIp,
  findWebApplication,
  publicStartAllowed,
  signWebApplication,
  startPublicApplication,
  storeStatements,
  type Lang,
  type UploadedFile,
} from "@/server/webApplication";
import { copyFor, type ErrorCode } from "./copy";

const FILE_TYPES = /^(application\/pdf|image\/(jpe?g|png))$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isFile = (f: FormDataEntryValue): f is File => f instanceof File && f.size > 0;
const read = async (f: File): Promise<UploadedFile> => ({
  name: f.name.slice(0, 200),
  type: f.type,
  data: Buffer.from(await f.arrayBuffer()),
});
const langOf = (v: FormDataEntryValue | null): Lang => (v === "es" ? "es" : "en");
const page = (token: string, params: Record<string, string> = {}) => {
  const q = new URLSearchParams(params).toString();
  return `/application/${encodeURIComponent(token)}${q ? `?${q}` : ""}`;
};

async function tenantId(): Promise<string> {
  const tenant = await getPrisma().tenant.findFirst({
    where: { slug: process.env.TENANT_SLUG ?? "ascend" },
    select: { id: true },
  });
  if (!tenant) throw new Error("no tenant");
  return tenant.id;
}

/** Public start page: files in, deal created, merchant sent to their private page. */
export async function startApplication(form: FormData) {
  const lang = langOf(form.get("lang"));
  const fail = (error: ErrorCode) =>
    redirect(`/application?${new URLSearchParams({ lang, error })}`);
  // Bots fill every field, people never see this one.
  if (String(form.get("company_website") ?? "")) fail("honeypot");
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  if (!EMAIL.test(email) || email.length > 200) fail("email");
  const phone =
    String(form.get("phone") ?? "")
      .trim()
      .slice(0, 40) || null;
  const appFiles = await Promise.all(form.getAll("application").filter(isFile).map(read));
  const statements = await Promise.all(form.getAll("statements").filter(isFile).map(read));
  if ([...appFiles, ...statements].some((f) => !FILE_TYPES.test(f.type))) fail("files");

  const prisma = getPrisma();
  const ip = clientIp(await headers());
  if (!(await publicStartAllowed(prisma, ip))) fail("limit");

  let token: string;
  try {
    const application = appFiles.length ? await applicationUploadToPdf(appFiles) : null;
    const tid = await tenantId();
    const started = await startPublicApplication(prisma, {
      tenantId: tid,
      application,
      statements: statements.filter((f) => f.type === "application/pdf"),
      email,
      phone,
      lang,
      ip,
    });
    token = started.token;
    const jobId = started.readJobId;
    after(async () => {
      if (jobId) await runDueJobs(prisma, { budgetMs: inlineBudgetMs(), ids: [jobId] });
      await emailLink(prisma, { tenantId: tid, dealId: started.dealId, email, token, lang });
    });
  } catch (err) {
    console.error("[application] start failed", err);
    return fail("failed");
  }
  redirect(page(token));
}

/** The merchant gets their link by email too, so they can come back (dry-run aware). */
async function emailLink(
  prisma: ReturnType<typeof getPrisma>,
  x: { tenantId: string; dealId: string; email: string; token: string; lang: Lang },
) {
  try {
    const tenant = await prisma.tenant.findUnique({ where: { id: x.tenantId } });
    const base = process.env.APP_URL;
    if (!tenant?.fromAddress || !base) return;
    const link = `${base}${page(x.token)}`;
    const es = x.lang === "es";
    await sendTracked(prisma, {
      tenantId: x.tenantId,
      dealId: x.dealId,
      kind: "web_application_link",
      target: x.email,
      from: tenant.fromAddress,
      to: [x.email],
      cc: [],
      subject: es ? "Su solicitud de Ascend Fund" : "Your Ascend Fund application",
      text: es
        ? `Gracias por su solicitud. Para revisarla y firmarla, use este enlace privado (vence en 14 días):\n\n${link}\n\nNo comparta este enlace.\n\nAscend Fund`
        : `Thank you for applying. To review and sign your application, use this private link (it expires in 14 days):\n\n${link}\n\nPlease don't share this link.\n\nAscend Fund`,
    });
  } catch (err) {
    console.error(`[application ${x.dealId}] link email failed`, err);
  }
}

export type SaveResult = { error: string } | undefined;

/** The merchant saved their details: same checks and writes as the deal page. */
export async function saveDetails(token: string, form: FormData): Promise<SaveResult> {
  const prisma = getPrisma();
  const row = await findWebApplication(prisma, token);
  const t = copyFor(row?.lang);
  if (!row) return { error: t.errors.expired };
  if (row.signedAt) return { error: t.errors.signed };
  try {
    const deal = await prisma.deal.findUniqueOrThrow({
      where: { id: row.dealId },
      include: { merchant: { include: { owners: true } } },
    });
    // Owner slots only ever point at this merchant's own owners.
    for (const i of [0, 1]) {
      const id = String(form.get(`ownerId-${i}`) ?? "");
      if (id && !deal.merchant.owners.some((o) => o.id === id)) form.set(`ownerId-${i}`, "");
    }
    await writeApplicationForm(prisma, deal, form, { advances: true });
    await prisma.dealEvent.create({
      data: {
        dealId: row.dealId,
        type: "application_edited",
        actorType: "merchant",
        payload: { channel: "web" },
      },
    });
  } catch (err) {
    if (err instanceof InputError) return { error: err.message };
    console.error(`[application ${row.dealId}] save failed`, err);
    return { error: t.errors.failed };
  }
  redirect(page(token, { step: "review" }));
}

/** More bank statements from the merchant's page. */
export async function addStatements(token: string, form: FormData) {
  const prisma = getPrisma();
  const row = await findWebApplication(prisma, token);
  if (!row) redirect(page(token));
  const files = await Promise.all(form.getAll("statements").filter(isFile).map(read));
  if (files.some((f) => f.type !== "application/pdf")) redirect(page(token, { error: "files" }));
  let n = 0;
  try {
    n = await storeStatements(prisma, { tenantId: row.tenantId, dealId: row.dealId }, files);
  } catch (err) {
    console.error(`[application ${row.dealId}] statements failed`, err);
    redirect(page(token, { error: "failed" }));
  }
  redirect(page(token, { added: String(n) }));
}

/** English / Spanish switch on the merchant's page. */
export async function switchLanguage(token: string, lang: string) {
  const prisma = getPrisma();
  const row = await findWebApplication(prisma, token);
  if (row) {
    await prisma.webApplication.update({
      where: { id: row.id },
      data: { lang: lang === "es" ? "es" : "en" },
    });
  }
  redirect(page(token));
}

export async function sign(token: string, form: FormData) {
  const prisma = getPrisma();
  const h = await headers();
  let result: Awaited<ReturnType<typeof signWebApplication>>;
  try {
    result = await signWebApplication(prisma, token, {
      name: String(form.get("name") ?? ""),
      agreed: form.get("agree") === "yes",
      fingerprint: String(form.get("fingerprint") ?? ""),
      ip: clientIp(h),
      userAgent: h.get("user-agent"),
    });
  } catch (err) {
    // Nothing was signed (the link is released again); the merchant can simply retry.
    console.error("[application] signing failed", err);
    redirect(page(token, { step: "review", error: "failed" }));
  }
  if (!result.ok) {
    redirect(
      page(token, {
        step: result.error === "missing" ? "details" : "review",
        error: result.error,
      }),
    );
  }
  redirect(page(token, { signed: "1" }));
}
