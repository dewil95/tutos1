import type {
  ApplicationSignature,
  Document,
  WhatsAppConversation,
  WhatsAppMessage,
} from "@mca/db";
import { formatPhone } from "@/server/whatsapp/questions";
import { whatsappSettings } from "@/server/whatsapp/config";
import { replyOnWhatsApp, resumeBot, takeOverChat } from "./whatsappActions";

const STATUS: Record<string, string> = {
  ACTIVE: "Bot is filling the application",
  READING: "Reading the merchant's application",
  SECURE_FORM: "Waiting for SSN / DOB on the private page",
  REVIEW: "Merchant is reviewing the application",
  SIGN_NAME: "Waiting for the typed signature",
  SIGN_CONFIRM: "Waiting for “I agree, sign”",
  SIGNED: "Signed",
  HANDOFF: "A person has the chat",
  ABANDONED: "Merchant went quiet (24 h)",
};

const EVENT: Record<string, string> = {
  read_done: "Application read",
  secure_done: "SSN / DOB received on the private page",
  nudge: "Reminder check",
  handoff: "Handed to a person",
  resume: "Handed back to the bot",
};

const when = (d: Date) =>
  d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "short",
    timeStyle: "short",
  });

/** The merchant's WhatsApp application chat, the signature proof and the take-over controls. */
export function WhatsAppPanel(p: {
  dealId: string;
  conv: WhatsAppConversation;
  messages: WhatsAppMessage[];
  source: Document | null;
  signature: ApplicationSignature | null;
}) {
  const { conv } = p;
  const windowOpen =
    conv.lastInboundAt && Date.now() - conv.lastInboundAt.getTime() < 24 * 3_600_000;
  return (
    <section className="panel" id="whatsapp">
      <h2>WhatsApp application</h2>
      <p className="row">
        <span
          className={`pill ${conv.status === "SIGNED" ? "approved" : ["HANDOFF", "ABANDONED"].includes(conv.status) ? "stips_requested" : "sent"}`}
        >
          {STATUS[conv.status] ?? conv.status}
        </span>
        <span className="mono small">{formatPhone(conv.phone)}</span>
        {conv.language ? (
          <span className="small muted">{conv.language === "es" ? "Spanish" : "English"}</span>
        ) : null}
        {!whatsappSettings().enabled ? (
          <span className="tag">Test mode: replies are logged, not sent</span>
        ) : null}
      </p>
      {p.source ? (
        <p className="small">
          Fields read from{" "}
          {p.source.driveWebViewLink ? (
            <a href={p.source.driveWebViewLink} target="_blank" rel="noreferrer">
              {p.source.fileName}
            </a>
          ) : (
            p.source.fileName
          )}{" "}
          <span className="muted">
            — the merchant's other application, internal only, never sent to lenders.
          </span>
        </p>
      ) : null}
      {p.signature ? (
        <details className="small">
          <summary>
            Signed by <b>{p.signature.signerName}</b> on {when(p.signature.signedAt)} ET · Ref{" "}
            <span className="mono">{p.signature.id}</span>
          </summary>
          <p className="muted">
            Typed name and “I agree, sign” tap from {formatPhone(p.signature.phone)} (messages{" "}
            <span className="mono">{p.signature.nameMessageId ?? "—"}</span>,{" "}
            <span className="mono">{p.signature.agreeMessageId ?? "—"}</span>). PDF SHA-256{" "}
            <span className="mono">{p.signature.pdfSha256.slice(0, 16)}…</span>
          </p>
          <p>{p.signature.consentText}</p>
        </details>
      ) : null}

      <div className="chat">
        {p.messages.length === 0 ? <p className="empty">No messages yet.</p> : null}
        {[...p.messages].reverse().map((m) =>
          m.direction === "event" ? (
            <span key={m.id} className="event">
              {EVENT[m.kind] ?? m.kind} · {when(m.createdAt)}
            </span>
          ) : (
            <div
              key={m.id}
              className={`msg ${m.direction === "out" ? "out" : ""} ${m.status === "failed" ? "failed" : ""}`}
            >
              {m.kind === "document" || m.kind === "image" ? (
                <b>
                  {m.direction === "out" ? "📄 " : "📎 "}
                  {m.fileName ?? m.kind}
                </b>
              ) : null}
              {m.text && m.kind !== "image" ? (
                <>
                  {m.kind === "document" ? <br /> : null}
                  {m.text}
                </>
              ) : null}
              <span className="when">
                {when(m.createdAt)}
                {m.status === "dry_run" ? " · not sent (test mode)" : ""}
                {m.status === "failed" ? ` · failed: ${m.error ?? ""}` : ""}
              </span>
            </div>
          ),
        )}
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        {conv.status === "HANDOFF" ? (
          <form action={resumeBot.bind(null, p.dealId)} className="inline">
            <button type="submit">Hand back to the bot</button>
          </form>
        ) : conv.status !== "SIGNED" ? (
          <form action={takeOverChat.bind(null, p.dealId)} className="inline">
            <button type="submit">Take over the chat</button>
          </form>
        ) : null}
      </div>
      {windowOpen ? (
        <form
          action={replyOnWhatsApp.bind(null, p.dealId)}
          className="row"
          style={{ marginTop: 10 }}
        >
          <input name="text" placeholder="Reply to the merchant on WhatsApp" style={{ flex: 1 }} />
          <button type="submit" className="primary">
            Send
          </button>
        </form>
      ) : (
        <p className="small muted">
          WhatsApp only allows replies within 24 hours of the merchant's last message.
        </p>
      )}
    </section>
  );
}
