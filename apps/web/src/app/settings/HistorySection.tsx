import { enqueueJob, getPrisma, type MailboxConnection } from "@mca/db";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth";

interface ImportState {
  total?: number;
  done?: number;
  startedAt?: string;
  finishedAt?: string;
  imported?: { submissions?: number; replies?: number; positions?: number };
}

async function restartImport(form: FormData) {
  "use server";
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "MANAGER") return;
  const prisma = getPrisma();
  const id = String(form.get("mailboxId"));
  const m = await prisma.mailboxConnection.findFirst({
    where: { id, tenantId: user.tenantId, purpose: "history" },
  });
  if (!m) return;
  // Safe to repeat: every email is stored once (by its Message-ID).
  await prisma.mailboxConnection.update({ where: { id }, data: { importState: { reset: true } } });
  await enqueueJob(prisma, {
    tenantId: user.tenantId,
    type: "HISTORY_IMPORT",
    payload: { mailboxId: id },
    dedupeKey: `history:${id}`,
  });
  revalidatePath("/settings");
}

/** Mailboxes the CRM learns from (read-only): past deals, lender answers, positions. */
export function HistorySection({
  mailboxes,
  canEdit,
}: {
  mailboxes: MailboxConnection[];
  canEdit: boolean;
}) {
  return (
    <section className="panel">
      <h2>Learn from past email</h2>
      <p className="small muted">
        Connect a team mailbox that was CC&apos;d on past submissions (e.g. jonas@). The CRM reads
        it once, read-only: every &quot;New Deal Submission&quot; becomes a deal with its lenders
        and positions, and lender replies (approved, declined and why, offers, funded) are read by
        AI. The results feed the <a href="/lenders">Lenders</a> page and the lender ranking on each
        deal. Nothing is ever sent from this mailbox.
      </p>
      {mailboxes.length === 0 ? <p className="empty">None connected.</p> : null}
      <ul>
        {mailboxes.map((m) => {
          const s = (m.importState ?? {}) as ImportState;
          const status = s.finishedAt
            ? `done ${new Date(s.finishedAt).toLocaleString("en-US")} · ${s.total ?? 0} emails`
            : s.total
              ? `reading… ${s.done ?? 0} of ${s.total} emails`
              : "starting…";
          return (
            <li key={m.id}>
              {m.email} — {status}
              {s.imported ? (
                <span className="small muted">
                  {" "}
                  · {s.imported.submissions ?? 0} submissions, {s.imported.replies ?? 0} lender
                  replies, {s.imported.positions ?? 0} positions blocks
                </span>
              ) : null}
              {canEdit && s.finishedAt ? (
                <form action={restartImport} className="inline">
                  <input type="hidden" name="mailboxId" value={m.id} />
                  <button type="submit">Read again</button>
                </form>
              ) : null}
            </li>
          );
        })}
      </ul>
      {canEdit ? (
        <p>
          <a className="button" href="/api/google/connect?purpose=history">
            Connect a mailbox to learn from
          </a>
        </p>
      ) : (
        <p className="small muted">An admin connects it.</p>
      )}
    </section>
  );
}
