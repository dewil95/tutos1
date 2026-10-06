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

/** Automated emails: on/off, timing and wording. Placeholders like {{business}} are filled per deal. */
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
      <h2>Email automation</h2>
      <p className="small muted">
        Checked every 2 minutes. Merchant emails skip merchants marked &quot;no automated
        emails&quot;. Dry-run mode writes them to the deal timeline instead of sending.
        Placeholders: {"{{business}}"}, {"{{contact}}"}, {"{{missing}}"}, {"{{stips}}"},{" "}
        {"{{amount}}"}, {"{{factor}}"}, {"{{term}}"}, {"{{merchantEmail}}"}, {"{{broker}}"}.
      </p>
      {DEFAULT_RULES.map((d) => {
        const r = rules.find((x) => x.kind === d.kind);
        if (!r) return null;
        return (
          <details key={r.id} className="rule">
            <summary>
              <strong>{d.label}</strong>{" "}
              <span className={`tag ${r.enabled ? "on" : ""}`}>
                {r.enabled ? (r.requiresApproval ? "one click" : "automatic") : "off"}
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
                {!r.requiresApproval ? (
                  <>
                    <label className="field">
                      Wait (hours)
                      <input
                        name="delayHours"
                        type="number"
                        min={0}
                        defaultValue={r.delayHours}
                        size={4}
                        disabled={!canEdit}
                      />
                    </label>
                    <label className="field">
                      Max sends
                      <input
                        name="maxSends"
                        type="number"
                        min={1}
                        max={10}
                        defaultValue={r.maxSends}
                        size={3}
                        disabled={!canEdit}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <input type="hidden" name="delayHours" value={r.delayHours} />
                    <input type="hidden" name="maxSends" value={r.maxSends} />
                  </>
                )}
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
