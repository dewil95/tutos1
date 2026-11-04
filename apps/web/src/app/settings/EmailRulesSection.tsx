import { getPrisma } from "@mca/db";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";
import { DEFAULT_RULES, ensureRules } from "@/server/email/rules";

async function saveRule(form: FormData) {
  "use server";
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "MANAGER") return;
  const num = (k: string, min: number, max: number) =>
    Math.min(max, Math.max(min, Math.round(Number(form.get(k)) || 0)));
  await getPrisma().emailRule.updateMany({
    where: { id: String(form.get("id")), tenantId: user.tenantId },
    data: {
      enabled: form.get("enabled") === "on",
      delayHours: num("delayHours", 0, 24 * 14),
      maxSends: num("maxSends", 1, 10),
      subject: String(form.get("subject") ?? "").slice(0, 200),
      body: String(form.get("body") ?? "").slice(0, 4000),
    },
  });
  revalidatePath("/settings");
}

/**
 * Lender emails sent with one click from the deal page: on/off and wording. Nothing is sent
 * automatically. Placeholders like {{business}} are filled per deal.
 */
export async function EmailRulesSection({
  tenantId,
  canEdit,
}: {
  tenantId: string;
  canEdit: boolean;
}) {
  const rules = await ensureRules(getPrisma(), tenantId);
  return (
    <section className="panel">
      <h2>Lender email templates</h2>
      <p className="small muted">
        The CRM sends no automatic emails to lenders or merchants: besides shopping the file, these
        go out only when someone clicks send on the deal page. Dry-run mode writes them to the deal
        timeline instead of sending. Placeholders: {"{{business}}"}, {"{{amount}}"}, {"{{factor}}"},{" "}
        {"{{term}}"}, {"{{merchantEmail}}"}, {"{{subject}}"}.
      </p>
      {DEFAULT_RULES.map((d) => {
        const r = rules.find((x) => x.kind === d.kind);
        if (!r) return null;
        return (
          <details key={r.id} className="rule">
            <summary>
              <strong>{d.label}</strong>{" "}
              <span className={`tag ${r.enabled ? "on" : ""}`}>
                {r.enabled ? "one click" : "off"}
              </span>
              <div className="small muted">{d.description}</div>
            </summary>
            <form action={saveRule} className="stack small">
              <input type="hidden" name="id" value={r.id} />
              <div className="row">
                <label>
                  <input
                    type="checkbox"
                    name="enabled"
                    defaultChecked={r.enabled}
                    disabled={!canEdit}
                  />{" "}
                  On
                </label>
                <input type="hidden" name="delayHours" value={r.delayHours} />
                <input type="hidden" name="maxSends" value={r.maxSends} />
              </div>
              <label className="field">
                Subject
                <input name="subject" defaultValue={r.subject} disabled={!canEdit} />
              </label>
              <label className="field">
                Body
                <textarea name="body" rows={7} defaultValue={r.body} disabled={!canEdit} />
              </label>
              {canEdit ? <button type="submit">Save</button> : null}
            </form>
          </details>
        );
      })}
    </section>
  );
}
