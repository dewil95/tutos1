import { getPrisma } from "@mca/db";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";

async function createDeal(form: FormData) {
  "use server";
  const user = await requireUser();
  const prisma = getPrisma();
  const text = (k: string) => String(form.get(k) ?? "").trim() || null;
  const legalName = text("legalName");
  if (!legalName) redirect("/deals/new?error=Business+name+is+required");
  const amount = Number(String(form.get("requestedAmount") ?? "").replace(/[$,\s]/g, ""));
  const merchant = await prisma.merchant.create({
    data: {
      tenantId: user.tenantId,
      legalName,
      dba: text("dba"),
      email: text("email")?.toLowerCase() ?? null,
      phone: text("phone"),
      state: text("state")?.toUpperCase().slice(0, 2) ?? null,
      industry: text("industry"),
    },
  });
  const deal = await prisma.deal.create({
    data: {
      tenantId: user.tenantId,
      merchantId: merchant.id,
      ownerId: user.id,
      requestedAmount: Number.isFinite(amount) && amount > 0 ? amount : null,
      stage: "DOCS_REQUESTED",
    },
  });
  redirect(`/deals/${deal.id}`);
}

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  await requireUser();
  const { error } = await searchParams;
  return (
    <section className="panel narrow">
      <h1>New deal</h1>
      {error ? <p className="notice error">{error}</p> : null}
      <form action={createDeal} className="stack">
        <label className="field">
          Business legal name *
          <input name="legalName" required />
        </label>
        <label className="field">
          DBA (used in the email subject if set)
          <input name="dba" />
        </label>
        <label className="field">
          Merchant email (their attachments get filed automatically)
          <input name="email" type="email" />
        </label>
        <label className="field">
          Phone
          <input name="phone" />
        </label>
        <div className="row">
          <label className="field">
            State
            <input name="state" maxLength={2} size={3} />
          </label>
          <label className="field">
            Industry
            <input name="industry" />
          </label>
          <label className="field">
            Requested amount
            <input name="requestedAmount" inputMode="decimal" />
          </label>
        </div>
        <button type="submit" className="primary">
          Create deal
        </button>
      </form>
    </section>
  );
}
