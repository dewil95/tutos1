import { getPrisma, type User } from "@mca/db";
import { allowedEmailDomain } from "@/server/env";
import { addTeamMember, setTeamMemberActive } from "./teamActions";

const ROLE_LABELS: [User["role"], string][] = [
  ["ADMIN", "Admin"],
  ["MANAGER", "Manager"],
  ["CLOSER", "Closer"],
  ["OPENER", "Opener"],
  ["PROCESSOR", "Processor"],
  ["READ_ONLY", "Read only"],
];
const label = (r: User["role"]) => ROLE_LABELS.find(([v]) => v === r)?.[1] ?? r;

/** Who can sign in to the CRM (admins and managers add or switch off teammates). */
export async function TeamSection({ me }: { me: User }) {
  const members = await getPrisma().user.findMany({
    where: { tenantId: me.tenantId },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });
  const canEdit = me.role === "ADMIN" || me.role === "MANAGER";
  const domain = allowedEmailDomain();
  return (
    <section className="panel">
      <h2>Team ({members.filter((m) => m.isActive).length} can sign in)</h2>
      <p className="small muted">
        Anyone listed here signs in with their @{domain} Google account.
        {canEdit ? "" : " Ask an admin to add or switch off a teammate."}
      </p>
      <table className="small">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id} className={m.isActive ? "" : "muted"}>
              <td>
                {m.name}
                {m.id === me.id ? " (you)" : ""}
                {m.isActive ? "" : " (off)"}
              </td>
              <td>{m.email}</td>
              <td>{label(m.role)}</td>
              <td>
                {canEdit && m.id !== me.id ? (
                  <form action={setTeamMemberActive} className="inline">
                    <input type="hidden" name="id" value={m.id} />
                    <input type="hidden" name="active" value={m.isActive ? "off" : "on"} />
                    <button type="submit">{m.isActive ? "Switch off" : "Switch on"}</button>
                  </form>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {canEdit ? (
        <form action={addTeamMember} className="row">
          <label className="field">
            Name
            <input name="name" required />
          </label>
          <label className="field">
            Email (@{domain})
            <input name="email" type="email" required placeholder={`name@${domain}`} />
          </label>
          <label className="field">
            Role
            <select name="role" defaultValue="PROCESSOR">
              {ROLE_LABELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Add teammate</button>
        </form>
      ) : null}
    </section>
  );
}
