import { getPrisma, type Prisma } from "@mca/db";
import { revalidatePath } from "next/cache";
import { SIGNATURE_CONSENT } from "@/server/ascendApplication";
import { requireUser } from "@/server/auth";

async function saveApplicationWording(form: FormData) {
  "use server";
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "MANAGER") return;
  const prisma = getPrisma();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
  const settings = (tenant.settings ?? {}) as Record<string, unknown>;
  const consent =
    String(form.get("consent") ?? "")
      .trim()
      .slice(0, 4000) || undefined;
  await prisma.tenant.update({
    where: { id: user.tenantId },
    data: {
      settings: JSON.parse(
        JSON.stringify({ ...settings, application: { consent } }),
      ) as Prisma.InputJsonObject,
    },
  });
  revalidatePath("/settings");
}

/** Wording printed above the merchant's signature on the downloaded Ascend application. */
export async function ApplicationSection({
  tenantId,
  canEdit,
}: {
  tenantId: string;
  canEdit: boolean;
}) {
  const tenant = await getPrisma().tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const current = (tenant.settings as { application?: { consent?: string } } | null)?.application
    ?.consent;
  return (
    <section className="panel">
      <h2>Ascend application</h2>
      <p className="small muted">
        Authorization printed above the merchant&apos;s signature on the application you download
        from a deal. Paste the wording from Ascend&apos;s current application; leave empty to use
        the default.
      </p>
      <form action={saveApplicationWording} className="stack">
        <textarea
          name="consent"
          rows={6}
          defaultValue={current ?? ""}
          placeholder={SIGNATURE_CONSENT}
          disabled={!canEdit}
        />
        {canEdit ? (
          <p>
            <button type="submit">Save wording</button>
          </p>
        ) : null}
      </form>
    </section>
  );
}
