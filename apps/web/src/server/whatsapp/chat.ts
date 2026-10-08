import { runChatAnswer, type LlmClient } from "@mca/ai";
import type { InboundWhatsApp, WhatsAppButton, WhatsAppClient } from "@mca/connectors";
import {
  decryptSecret,
  encryptSecret,
  enqueueJob,
  type ClaimedJob,
  type Prisma,
  type PrismaClient,
  type WhatsAppConversation,
  type WhatsAppMessage,
} from "@mca/db";
import { llmClient } from "../ai";
import { classifyFileName, storeDealFile } from "../documents";
import { requireEnv } from "../env";
import { tenantMailbox, type Mailbox } from "../google";
import { whatsappClient, whatsappSettings } from "./config";
import { COPY, tr } from "./copy";
import { consentFor, renderApplication, signApplication } from "./finish";
import {
  allFieldsAsk,
  emptyDraft,
  FIELDS,
  fieldByKey,
  formatPhone,
  maskPhone,
  nameMatches,
  normalizeName,
  SKIP_WORDS,
  type Draft,
  type FieldDef,
  type FieldStatus,
  type Lang,
} from "./questions";
import { createSecureToken } from "./secureForm";

/**
 * The WhatsApp application bot. A merchant sends another company's signed application (or
 * answers questions); the bot fills Ascend's application, asks only what is missing, collects
 * SSN/DOB through a private link, shows the filled PDF and takes a typed-name signature.
 *
 * Every inbound message and every background result (PDF read, secure form, nudge) is a
 * WhatsAppMessage row processed in order by one WHATSAPP_MESSAGE job per conversation, so this
 * file is the only writer of conversation state.
 */

export interface WaDeps {
  /** Sends replies; null = dry run (replies are only written to the chat log). */
  sender: WhatsAppClient | null;
  /** Downloads the merchant's files (needs the token, also in dry run). */
  media: Pick<WhatsAppClient, "downloadMedia"> | null;
  mailbox: () => Promise<Mailbox>;
  llm: () => LlmClient;
  appUrl: string;
  now: () => Date;
}

export function defaultDeps(prisma: PrismaClient, tenantId: string): WaDeps {
  const client = whatsappClient();
  return {
    sender: whatsappSettings().enabled ? client : null,
    media: client,
    mailbox: () => tenantMailbox(prisma, tenantId),
    llm: () => llmClient(prisma),
    appUrl: (process.env.APP_URL ?? "").replace(/\/$/, ""),
    now: () => new Date(),
  };
}

/** Conversation bookkeeping kept in WhatsAppConversation.fieldState. */
export interface ChatMeta {
  fields: Record<string, FieldStatus>;
  asked: string[];
  mode?: "pdf" | "questions";
  /** Files that may be the merchant's application, waiting for the PDF reader. */
  candidates: string[];
  examined: string[];
  /** The other company's application the fields were read from (internal only). */
  sourceDocId?: string;
  statementsAsked?: boolean;
  /** Status before ABANDONED, restored when the merchant writes again. */
  before?: string;
}

export interface OwnerPii {
  ssn: string | null;
  dob: string | null;
}

export interface Ctx {
  prisma: PrismaClient;
  deps: WaDeps;
  c: WhatsAppConversation;
  draft: Draft;
  meta: ChatMeta;
  pii: OwnerPii[];
  lang: Lang;
}

const ACTIVE_STATES = ["ACTIVE", "READING", "SECURE_FORM", "REVIEW", "SIGN_NAME", "SIGN_CONFIRM"];
const MONTH = 30 * 24 * 3_600_000;
const piiKey = () => requireEnv("PII_ENCRYPTION_KEY");

// --- inbound (webhook) ------------------------------------------------------------

/**
 * Stores webhook messages (a repeated WhatsApp id is ignored) and queues one job per
 * conversation. Returns the job ids so the webhook can run them right away.
 */
export async function receiveWhatsApp(
  prisma: PrismaClient,
  tenantId: string,
  msgs: InboundWhatsApp[],
  now = new Date(),
): Promise<string[]> {
  const jobs = new Set<string>();
  for (const m of msgs) {
    if (await prisma.whatsAppMessage.findUnique({ where: { waMessageId: m.messageId } })) continue;
    const latest = await prisma.whatsAppConversation.findFirst({
      where: { tenantId, phone: m.from },
      orderBy: { createdAt: "desc" },
    });
    // A finished chat older than a month starts a new application.
    const stale =
      latest &&
      ["SIGNED", "HANDOFF"].includes(latest.status) &&
      now.getTime() - latest.updatedAt.getTime() > MONTH;
    const conv =
      latest && !stale
        ? latest
        : await prisma.whatsAppConversation.create({
            data: {
              tenantId,
              phone: m.from,
              step: "lang",
              fieldState: { fields: {}, asked: [], candidates: [], examined: [] },
            },
          });
    try {
      await prisma.whatsAppMessage.create({
        data: {
          tenantId,
          conversationId: conv.id,
          direction: "in",
          waMessageId: m.messageId,
          kind: m.kind,
          text: m.text,
          buttonId: m.buttonId,
          mediaId: m.mediaId,
          mimeType: m.mimeType,
          fileName: m.fileName,
          createdAt: m.timestamp > now ? now : m.timestamp,
        },
      });
    } catch (err) {
      if ((err as { code?: string }).code === "P2002") continue; // same message, two deliveries
      throw err;
    }
    await prisma.whatsAppConversation.update({
      where: { id: conv.id },
      data: { lastInboundAt: now, nudgeCount: 0 },
    });
    jobs.add(await queueChat(prisma, conv));
  }
  return [...jobs];
}

export function queueChat(
  prisma: PrismaClient,
  conv: { id: string; tenantId: string },
  runAt?: Date,
): Promise<string> {
  return enqueueJob(prisma, {
    tenantId: conv.tenantId,
    type: "WHATSAPP_MESSAGE",
    payload: { conversationId: conv.id },
    dedupeKey: `wa:${conv.id}`,
    runAt,
  });
}

/** Background results (PDF read, secure form, nudges, rep actions) enter the chat as events. */
export async function addChatEvent(
  prisma: PrismaClient,
  conv: { id: string; tenantId: string },
  kind: string,
  text: string | null = null,
): Promise<string> {
  await prisma.whatsAppMessage.create({
    data: { tenantId: conv.tenantId, conversationId: conv.id, direction: "event", kind, text },
  });
  return queueChat(prisma, conv);
}

// --- job ---------------------------------------------------------------------------

/**
 * Runs the chat right away after a webhook or the secure form: first the given jobs, then any
 * WhatsApp work they queued (reading the PDF, the reply after it), within one function call.
 */
export async function runChatNow(prisma: PrismaClient, ids: string[]): Promise<void> {
  const { runDueJobs } = await import("../jobs/runner");
  const started = Date.now();
  if (ids.length) await runDueJobs(prisma, { budgetMs: 45_000, ids });
  const left = 50_000 - (Date.now() - started);
  if (left > 5_000) {
    await runDueJobs(prisma, {
      budgetMs: left,
      types: ["WHATSAPP_MESSAGE", "WHATSAPP_APP_READ"],
    });
  }
}

export interface WhatsAppMessagePayload {
  conversationId: string;
}

export async function handleWhatsAppMessage(prisma: PrismaClient, job: ClaimedJob): Promise<void> {
  const { conversationId } = job.payload as unknown as WhatsAppMessagePayload;
  const conv = await prisma.whatsAppConversation.findUnique({ where: { id: conversationId } });
  if (!conv) return;
  await processConversation(prisma, defaultDeps(prisma, conv.tenantId), conversationId, {
    lastAttempt: job.attempts >= job.maxAttempts,
  });
}

/** Handles the conversation's unprocessed messages and events, oldest first. */
export async function processConversation(
  prisma: PrismaClient,
  deps: WaDeps,
  conversationId: string,
  opts: { lastAttempt?: boolean } = {},
): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const m = await prisma.whatsAppMessage.findFirst({
      where: { conversationId, direction: { in: ["in", "event"] }, processedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    if (!m) return;
    const x = loadCtx(
      prisma,
      deps,
      await prisma.whatsAppConversation.findUniqueOrThrow({
        where: { id: conversationId },
      }),
    );
    try {
      await handle(x, m);
    } catch (err) {
      if (!opts.lastAttempt) throw err; // the runner retries with backoff
      // Out of retries: a person takes over instead of the merchant waiting on a stuck bot.
      const error = err instanceof Error ? err.message : String(err);
      await prisma.whatsAppMessage.update({ where: { id: m.id }, data: { error } });
      await handoff(x, COPY.failed);
    }
    await save(x);
    await prisma.whatsAppMessage.update({
      where: { id: m.id },
      data: { processedAt: deps.now() },
    });
  }
}

function loadCtx(prisma: PrismaClient, deps: WaDeps, c: WhatsAppConversation): Ctx {
  const meta = {
    fields: {},
    asked: [],
    candidates: [],
    examined: [],
    ...((c.fieldState ?? {}) as Partial<ChatMeta>),
  } as ChatMeta;
  const answers = c.answers as Partial<Draft>;
  const draft: Draft = {
    business: answers.business ?? {},
    request: answers.request ?? {},
    owners: answers.owners?.length ? answers.owners : [{}],
  };
  const pii = c.piiEncrypted
    ? (JSON.parse(decryptSecret(c.piiEncrypted, piiKey())) as OwnerPii[])
    : [];
  return { prisma, deps, c, draft, meta, pii, lang: (c.language as Lang) ?? "en" };
}

async function save(x: Ctx): Promise<void> {
  x.c = await x.prisma.whatsAppConversation.update({
    where: { id: x.c.id },
    data: {
      status: x.c.status,
      step: x.c.step,
      language: x.c.language,
      answers: x.draft as unknown as Prisma.InputJsonObject,
      fieldState: x.meta as unknown as Prisma.InputJsonObject,
      piiEncrypted: x.pii.length ? encryptSecret(JSON.stringify(x.pii), piiKey()) : null,
      pendingSignerName: x.c.pendingSignerName,
      pendingNameMessageId: x.c.pendingNameMessageId,
      dealId: x.c.dealId,
      nudgeCount: x.c.nudgeCount,
    },
  });
}

// --- outbound ----------------------------------------------------------------------

type Send = (s: WhatsAppClient) => Promise<{ messageId: string }>;

async function out(
  x: Ctx,
  kind: string,
  text: string,
  send: Send,
  fileName?: string,
): Promise<void> {
  let status = "dry_run";
  let waMessageId: string | null = null;
  let error: string | null = null;
  if (x.deps.sender) {
    try {
      waMessageId = (await send(x.deps.sender)).messageId;
      status = "sent";
    } catch (err) {
      status = "failed";
      error = err instanceof Error ? err.message : String(err);
      console.error(`[whatsapp ${x.c.id}] send failed: ${error}`);
    }
  }
  await x.prisma.whatsAppMessage.create({
    data: {
      tenantId: x.c.tenantId,
      conversationId: x.c.id,
      direction: "out",
      kind,
      text,
      fileName: fileName ?? null,
      waMessageId,
      status,
      error,
      processedAt: x.deps.now(),
    },
  });
}

export const say = (x: Ctx, text: string) =>
  out(x, "text", text, (s) => s.sendText(x.c.phone, text));

export const ask = (x: Ctx, text: string, buttons: WhatsAppButton[]) =>
  out(x, "button", `${text}\n[${buttons.map((b) => b.title).join("] [")}]`, (s) =>
    s.sendButtons(x.c.phone, text, buttons),
  );

export const sendFile = (x: Ctx, file: { fileName: string; data: Buffer }, caption: string) =>
  out(
    x,
    "document",
    caption,
    (s) => s.sendDocument(x.c.phone, { ...file, mimeType: "application/pdf" }, caption),
    file.fileName,
  );

/** A rep's reply typed on the deal page, sent and logged like the bot's own messages. */
export async function sendRepReply(
  prisma: PrismaClient,
  deps: WaDeps,
  conv: WhatsAppConversation,
  text: string,
): Promise<void> {
  const x = loadCtx(prisma, deps, conv);
  await say(x, text);
}

// --- handling ----------------------------------------------------------------------

const t = <T>(x: Ctx, v: Record<Lang, T>) => tr(v, x.lang);
const btn = (id: string, title: string): WhatsAppButton => ({ id, title });
const isAny = (s: string, words: string[]) => words.includes(s);

async function handle(x: Ctx, m: WhatsAppMessage): Promise<void> {
  if (m.direction === "event") return onEvent(x, m);

  const text = (m.text ?? "").trim();
  const low = normalizeName(text);
  const status = x.c.status;

  if (status === "HANDOFF") return; // a rep answers from the deal page
  if (status === "ABANDONED") x.c.status = x.meta.before ?? "ACTIVE";
  if (status === "SIGNED") {
    if (m.kind === "document" || m.kind === "image") {
      await storeMedia(x, m, "statement");
      return say(x, t(x, COPY.fileAdded));
    }
    if (m.kind === "button") return; // e.g. a second tap on "I agree, sign"
    return handoff(x, COPY.handoff);
  }
  if (
    m.kind === "text" &&
    isAny(low, ["agent", "agente", "human", "humano", "persona", "representative", "representante"])
  ) {
    return handoff(x, COPY.handoff);
  }
  if (m.kind === "document" || m.kind === "image") return onMedia(x, m);
  if (m.kind === "other") return say(x, t(x, COPY.unsupported));

  if (x.c.step === "lang" || !x.c.language) return onLanguage(x, m, low);
  switch (x.c.status) {
    case "READING":
      return say(x, t(x, COPY.reading));
    case "SECURE_FORM":
      if (isAny(low, ["link", "enlace", "new link", "nuevo enlace"])) return sendSecureLink(x);
      return say(x, t(x, COPY.secureRemind));
    case "REVIEW":
      return onReview(x, m, low);
    case "SIGN_NAME":
      return onSignName(x, m, text);
    case "SIGN_CONFIRM":
      return onSignConfirm(x, m, text, low);
  }
  if (x.c.step === "docs") return onDocsStep(x, m, low);
  if (x.c.step === "statements") return onStatementsStep(x, m, low);
  if (x.c.step === "fix") return onFixStep(x, text);
  const field = x.c.step ? fieldByKey(x.c.step) : undefined;
  if (field) return onAnswer(x, m, field, text, low);
  return next(x);
}

async function onEvent(x: Ctx, m: WhatsAppMessage): Promise<void> {
  switch (m.kind) {
    case "read_done":
      return onReadDone(x, JSON.parse(m.text ?? "{}") as ReadResult);
    case "secure_done": {
      const got = JSON.parse(decryptSecret(m.text ?? "", piiKey())) as OwnerPii;
      x.pii[0] = got;
      if (x.c.status !== "SECURE_FORM") return;
      x.c.status = "ACTIVE";
      return next(x);
    }
    case "nudge":
      return onNudge(x);
    case "handoff":
      x.c.status = "HANDOFF";
      return;
    case "resume":
      if (x.c.status !== "HANDOFF") return;
      x.c.status = "ACTIVE";
      return resume(x);
  }
}

/** Back from a person to the bot: continue from wherever the application is. */
async function resume(x: Ctx): Promise<void> {
  if (!x.c.language) {
    x.c.step = "lang";
    return ask(x, COPY.welcome, [btn("lang_en", "English"), btn("lang_es", "Español")]);
  }
  if (!x.meta.mode) {
    x.c.step = "docs";
    if (unexamined(x).length) return startReading(x);
    return ask(x, t(x, COPY.askDocs), [btn("questions", t(x, COPY.questionsButton))]);
  }
  if (
    x.c.dealId &&
    (await x.prisma.applicationSignature.count({ where: { dealId: x.c.dealId } }))
  ) {
    x.c.status = "SIGNED";
    return;
  }
  return next(x);
}

async function onLanguage(x: Ctx, m: WhatsAppMessage, low: string): Promise<void> {
  const pick =
    m.buttonId === "lang_en" || isAny(low, ["1", "english", "ingles", "en"])
      ? "en"
      : m.buttonId === "lang_es" || isAny(low, ["2", "espanol", "spanish", "es"])
        ? "es"
        : null;
  if (!pick) {
    return ask(x, COPY.welcome, [btn("lang_en", "English"), btn("lang_es", "Español")]);
  }
  x.c.language = pick;
  x.lang = pick;
  x.c.step = "docs";
  if (unexamined(x).length) return startReading(x);
  return ask(x, t(x, COPY.askDocs), [btn("questions", t(x, COPY.questionsButton))]);
}

async function onDocsStep(x: Ctx, m: WhatsAppMessage, low: string): Promise<void> {
  if (m.buttonId === "questions" || /question|pregunta/.test(low)) {
    await ensureDeal(x);
    x.meta.mode = "questions";
    x.meta.fields = allFieldsAsk();
    await say(x, t(x, COPY.startQuestions));
    return next(x);
  }
  return ask(x, t(x, COPY.askDocs), [btn("questions", t(x, COPY.questionsButton))]);
}

// --- files -------------------------------------------------------------------------

const unexamined = (x: Ctx) => x.meta.candidates.filter((id) => !x.meta.examined.includes(id));

async function onMedia(x: Ctx, m: WhatsAppMessage): Promise<void> {
  const lookingForApp = !x.meta.sourceDocId && x.meta.mode !== "questions";
  const isPdf = m.mimeType === "application/pdf";
  const statementByName = isPdf && classifyFileName(m.fileName ?? "").type === "BANK_STATEMENT";

  if (lookingForApp && !statementByName && (isPdf || m.kind === "image")) {
    const doc = await storeMedia(x, m, "candidate");
    if (!doc) return say(x, t(x, COPY.unsupported));
    if (!x.meta.candidates.includes(doc.id)) x.meta.candidates.push(doc.id);
    if (!x.c.language) {
      x.c.step = "lang";
      return ask(x, COPY.welcome, [btn("lang_en", "English"), btn("lang_es", "Español")]);
    }
    if (x.c.status !== "READING") return startReading(x, m.kind === "image");
    return;
  }

  const doc = await storeMedia(x, m, "statement");
  if (!doc) return say(x, t(x, COPY.unsupported));
  if (!x.c.language) return; // language buttons already went out with the first message
  if (x.c.step === "statements") {
    const n = await statementCount(x);
    return ask(x, t(x, COPY.gotStatements)(n), [btn("statements_done", t(x, COPY.done))]);
  }
  return say(x, t(x, doc.type === "BANK_STATEMENT" ? COPY.statementNoted : COPY.fileAdded));
}

const EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

/** Downloads the file from WhatsApp and saves it in the deal's Drive folder. */
async function storeMedia(x: Ctx, m: WhatsAppMessage, role: "candidate" | "statement") {
  if (!m.mediaId) return null;
  if (!x.deps.media) throw new Error("WHATSAPP_TOKEN is not set; cannot download the file");
  await ensureDeal(x);
  const file = await x.deps.media.downloadMedia(m.mediaId);
  const mimeType = (m.mimeType ?? file.mimeType).split(";")[0]!.trim();
  const ext = EXT[mimeType];
  const fileName =
    m.fileName ??
    `WhatsApp ${m.kind} ${x.deps.now().toISOString().slice(0, 10)} ${m.id.slice(-4)}.${ext ?? "bin"}`;
  const pdf = mimeType === "application/pdf";
  const doc = await storeDealFile(x.prisma, await x.deps.mailbox(), {
    tenantId: x.c.tenantId,
    dealId: x.c.dealId!,
    merchantId: (await dealMerchant(x)) ?? null,
    file: { fileName, mimeType, data: file.data },
    uploadedVia: "whatsapp",
    // Candidates wait for the reader; statements start extraction and the bank scrub.
    type: role === "candidate" ? "OTHER" : pdf ? "BANK_STATEMENT" : undefined,
    autoProcess: role === "statement",
  });
  await x.prisma.whatsAppMessage.update({ where: { id: m.id }, data: { documentId: doc.id } });
  return doc;
}

async function dealMerchant(x: Ctx): Promise<string | null> {
  if (!x.c.dealId) return null;
  const d = await x.prisma.deal.findUnique({
    where: { id: x.c.dealId },
    select: { merchantId: true },
  });
  return d?.merchantId ?? null;
}

const statementCount = (x: Ctx) =>
  x.c.dealId
    ? x.prisma.document.count({ where: { dealId: x.c.dealId, type: "BANK_STATEMENT" } })
    : Promise.resolve(0);

/** Draft deal for this chat (placeholder merchant until the application is signed). */
export async function ensureDeal(x: Ctx): Promise<string> {
  if (x.c.dealId) return x.c.dealId;
  const merchant = await x.prisma.merchant.create({
    data: { tenantId: x.c.tenantId, legalName: `WhatsApp ${maskPhone(x.c.phone)}` },
  });
  const deal = await x.prisma.deal.create({
    data: {
      tenantId: x.c.tenantId,
      merchantId: merchant.id,
      source: "whatsapp",
      externalRef: `wa:${x.c.id}`,
      stage: "INTAKE",
    },
  });
  await x.prisma.dealEvent.create({
    data: {
      dealId: deal.id,
      type: "whatsapp_started",
      actorType: "system",
      payload: { conversationId: x.c.id, phone: maskPhone(x.c.phone) },
    },
  });
  x.c.dealId = deal.id;
  return deal.id;
}

async function startReading(x: Ctx, waitForMorePhotos = false): Promise<void> {
  x.c.status = "READING";
  x.c.step = null;
  await enqueueJob(x.prisma, {
    tenantId: x.c.tenantId,
    type: "WHATSAPP_APP_READ",
    payload: { conversationId: x.c.id, candidates: unexamined(x) },
    dedupeKey: `waread:${x.c.id}`,
    // Photos of a multi-page form arrive one by one; give them a moment before reading.
    runAt: waitForMorePhotos ? new Date(x.deps.now().getTime() + 20_000) : undefined,
  });
  return say(x, t(x, COPY.reading));
}

/** What the PDF reader hands back to the chat (see read.ts). */
export interface ReadResult {
  examined: string[];
  sourceDocId: string | null;
  draft?: Draft;
  fields?: Record<string, FieldStatus>;
  /** Encrypted OwnerPii[] from the application. */
  pii?: string | null;
}

async function onReadDone(x: Ctx, r: ReadResult): Promise<void> {
  for (const id of r.examined) if (!x.meta.examined.includes(id)) x.meta.examined.push(id);
  // Keep what was read even if a person took the chat over meanwhile.
  if (r.sourceDocId && !x.meta.sourceDocId) {
    x.meta.mode = "pdf";
    x.meta.sourceDocId = r.sourceDocId;
    x.draft = r.draft ?? emptyDraft();
    x.meta.fields = r.fields ?? allFieldsAsk();
    x.pii = r.pii ? (JSON.parse(decryptSecret(r.pii, piiKey())) as OwnerPii[]) : [];
  }
  if (x.c.status !== "READING") return;
  x.c.status = "ACTIVE";
  if (!x.meta.sourceDocId) {
    // Photos or files that came in while reading get their turn.
    if (unexamined(x).length) return startReading(x);
    x.c.step = "docs";
    return ask(x, t(x, COPY.readNone), [btn("questions", t(x, COPY.questionsButton))]);
  }
  const open = FIELDS.filter((f) => x.meta.fields[f.key] !== "ok").length;
  await say(x, `${t(x, COPY.readDone)}${open ? ` ${t(x, COPY.fewMore)(open)}` : ""}`);
  return next(x);
}

// --- questions ---------------------------------------------------------------------

/** Asks the next open field, then SSN/DOB link, statements, review. */
export async function next(x: Ctx): Promise<void> {
  const f = FIELDS.find((d) => ["ask", "confirm"].includes(x.meta.fields[d.key] ?? "ok"));
  if (f) return prompt(x, f);
  if (!x.pii[0]?.ssn || !x.pii[0]?.dob) return sendSecureLink(x);
  if (!x.meta.statementsAsked && (await statementCount(x)) === 0) {
    x.meta.statementsAsked = true;
    x.c.step = "statements";
    x.c.status = "ACTIVE";
    return ask(x, t(x, COPY.askStatements), [
      btn("statements_done", t(x, COPY.done)),
      btn("statements_later", t(x, COPY.later)),
    ]);
  }
  return review(x);
}

async function prompt(x: Ctx, f: FieldDef): Promise<void> {
  x.c.status = "ACTIVE";
  x.c.step = f.key;
  if (!x.meta.asked.includes(f.key)) x.meta.asked.push(f.key);
  if (x.meta.fields[f.key] === "confirm") {
    return ask(x, t(x, COPY.confirm)(t(x, f.label), f.show(f.get(x.draft))), [
      btn("yes", t(x, COPY.yes)),
      btn("change", t(x, COPY.change)),
    ]);
  }
  return say(x, t(x, f.ask));
}

const YES = ["yes", "y", "si", "correct", "correcto", "ok", "okay", "yep", "sip"];
const NO = ["no", "change", "cambiar", "wrong", "incorrecto"];

async function onAnswer(
  x: Ctx,
  m: WhatsAppMessage,
  f: FieldDef,
  text: string,
  low: string,
): Promise<void> {
  if (isAny(low, ["back", "atras", "volver"])) {
    const i = x.meta.asked.indexOf(f.key);
    const prev = i > 0 ? fieldByKey(x.meta.asked[i - 1]!) : undefined;
    if (!prev) return say(x, t(x, f.ask));
    x.meta.fields[prev.key] = "ask";
    return prompt(x, prev);
  }
  if (x.meta.fields[f.key] === "confirm") {
    if (m.buttonId === "yes" || isAny(low, YES)) {
      x.meta.fields[f.key] = "ok";
      return next(x);
    }
    if (m.buttonId === "change" || isAny(low, NO)) {
      x.meta.fields[f.key] = "ask";
      return say(x, t(x, f.ask));
    }
    // Anything else is taken as the corrected value.
  }
  if (SKIP_WORDS.test(low) && f.key !== "request.existingAdvances") {
    if (!f.skippable) return say(x, `${t(x, COPY.required)}\n\n${t(x, f.ask)}`);
    x.meta.fields[f.key] = "ok";
    return next(x);
  }

  let parsed = f.parse(text);
  let viaAi = false;
  if (!parsed.ok && f.ai && text.length <= 500) {
    try {
      const { data } = await runChatAnswer(x.deps.llm(), {
        question: f.ask[x.lang],
        kind: f.ai,
        reply: text,
        tenantId: x.c.tenantId,
        dealId: x.c.dealId ?? undefined,
      });
      parsed = f.fromAi(data);
      viaAi = parsed.ok;
    } catch (err) {
      console.error(`[whatsapp ${x.c.id}] answer reader failed`, err);
    }
  }
  if (!parsed.ok) return say(x, `${t(x, COPY.notUnderstood)}\n\n${t(x, f.ask)}`);

  let value = parsed.value;
  if (value === "__whatsapp__") value = formatPhone(x.c.phone);
  if (value === "__business__") value = x.draft.business.email;
  f.set(x.draft, value);
  // Values the AI interpreted are read back once so the merchant can correct them.
  x.meta.fields[f.key] = viaAi ? "confirm" : "ok";
  return next(x);
}

async function onStatementsStep(x: Ctx, m: WhatsAppMessage, low: string): Promise<void> {
  if (
    m.buttonId === "statements_done" ||
    m.buttonId === "statements_later" ||
    isAny(low, ["done", "listo", "later", "despues", "ya", "next", "siguiente"])
  ) {
    x.c.step = null;
    return next(x);
  }
  return ask(x, t(x, COPY.askStatements), [
    btn("statements_done", t(x, COPY.done)),
    btn("statements_later", t(x, COPY.later)),
  ]);
}

async function sendSecureLink(x: Ctx): Promise<void> {
  x.c.status = "SECURE_FORM";
  x.c.step = null;
  const token = await createSecureToken(x.prisma, x.c, x.deps.now());
  return say(x, t(x, COPY.secureLink)(`${x.deps.appUrl}/apply/${token}`));
}

// --- review and signature -----------------------------------------------------------

async function review(x: Ctx): Promise<void> {
  x.c.status = "REVIEW";
  x.c.step = null;
  const preview = await renderApplication(x, { masked: true });
  await sendFile(x, preview, t(x, COPY.reviewCaption));
  return ask(x, t(x, COPY.reviewAsk), [
    btn("review_ok", t(x, COPY.looksGood)),
    btn("review_fix", t(x, COPY.fixSomething)),
  ]);
}

const fixList = (x: Ctx) =>
  `${t(x, COPY.fixList)}\n${FIELDS.map((f, i) => `${i + 1} ${t(x, f.label)}`).join("\n")}`;

async function onReview(x: Ctx, m: WhatsAppMessage, low: string): Promise<void> {
  if (m.buttonId === "review_ok" || isAny(low, [...YES, "looks good", "todo bien"])) {
    x.c.status = "SIGN_NAME";
    return say(x, t(x, COPY.consent)(await consentFor(x), ownerName(x)));
  }
  x.c.status = "ACTIVE";
  x.c.step = "fix";
  return say(x, fixList(x));
}

async function onFixStep(x: Ctx, text: string): Promise<void> {
  const n = Number(text.replace(/\D/g, ""));
  const f = Number.isInteger(n) && n >= 1 ? FIELDS[n - 1] : undefined;
  if (!f) return say(x, fixList(x));
  x.meta.fields[f.key] = "ask";
  return prompt(x, f);
}

export const ownerName = (x: Ctx) =>
  `${x.draft.owners[0]?.firstName ?? ""} ${x.draft.owners[0]?.lastName ?? ""}`.trim();

async function onSignName(x: Ctx, m: WhatsAppMessage, text: string): Promise<void> {
  if (!nameMatches(text, x.draft.owners[0] ?? {})) {
    return say(x, t(x, COPY.nameMismatch)(ownerName(x)));
  }
  x.c.status = "SIGN_CONFIRM";
  x.c.pendingSignerName = text.replace(/\s+/g, " ").trim();
  x.c.pendingNameMessageId = m.waMessageId;
  return ask(x, t(x, COPY.confirmSign)(x.c.pendingSignerName), [
    btn("sign", t(x, COPY.agreeSign)),
    btn("sign_cancel", t(x, COPY.cancel)),
  ]);
}

async function onSignConfirm(x: Ctx, m: WhatsAppMessage, text: string, low: string): Promise<void> {
  if (m.buttonId === "sign" || isAny(low, ["i agree", "i agree sign", "acepto", "acepto firmar"])) {
    await signApplication(x, { agreeMessageId: m.waMessageId });
    return;
  }
  if (m.buttonId === "sign_cancel" || isAny(low, ["cancel", "cancelar"])) {
    x.c.pendingSignerName = null;
    x.c.pendingNameMessageId = null;
    return review(x);
  }
  return onSignName(x, m, text);
}

export async function handoff(x: Ctx, msg: Record<Lang, string>): Promise<void> {
  x.c.status = "HANDOFF";
  x.c.step = null;
  if (x.c.dealId) {
    await x.prisma.dealEvent.create({
      data: {
        dealId: x.c.dealId,
        type: "whatsapp_handoff",
        actorType: "system",
        payload: { conversationId: x.c.id },
      },
    });
  }
  return say(x, t(x, msg));
}

// --- reminders --------------------------------------------------------------------

const HOUR = 3_600_000;
const NUDGE_AFTER_HOURS = [2, 20];

async function onNudge(x: Ctx): Promise<void> {
  if (!ACTIVE_STATES.includes(x.c.status) || x.c.status === "READING" || !x.c.lastInboundAt) return;
  const idle = (x.deps.now().getTime() - x.c.lastInboundAt.getTime()) / HOUR;
  const due = NUDGE_AFTER_HOURS[x.c.nudgeCount];
  // Someone who only said hello and never picked a language is not chased.
  if (due !== undefined && idle >= due && idle < 24 && x.c.language) {
    x.c.nudgeCount += 1;
    return say(x, t(x, COPY.nudge));
  }
  // After a day the free reply window is closed; the team follows up instead.
  if (idle >= 24) {
    x.meta.before = x.c.status;
    x.c.status = "ABANDONED";
    if (x.c.dealId) {
      await x.prisma.dealEvent.create({
        data: {
          dealId: x.c.dealId,
          type: "whatsapp_abandoned",
          actorType: "system",
          payload: { conversationId: x.c.id },
        },
      });
    }
  }
}

/**
 * Cron: queues a nudge check for chats waiting on the merchant, and re-queues chats with
 * unprocessed messages (a message that arrived while its job was finishing).
 */
export async function handleWhatsAppNudges(prisma: PrismaClient, job: ClaimedJob): Promise<void> {
  const now = new Date();
  const waiting = await prisma.whatsAppConversation.findMany({
    where: {
      tenantId: job.tenantId,
      status: { in: ["ACTIVE", "SECURE_FORM", "REVIEW", "SIGN_NAME", "SIGN_CONFIRM"] },
      lastInboundAt: { lte: new Date(now.getTime() - NUDGE_AFTER_HOURS[0]! * HOUR) },
    },
    select: { id: true, tenantId: true, nudgeCount: true, lastInboundAt: true },
    take: 200,
  });
  for (const c of waiting) {
    const idle = (now.getTime() - c.lastInboundAt!.getTime()) / HOUR;
    const due = NUDGE_AFTER_HOURS[c.nudgeCount];
    if ((due !== undefined && idle >= due) || idle >= 24) {
      const pending = await prisma.whatsAppMessage.count({
        where: { conversationId: c.id, kind: "nudge", processedAt: null },
      });
      if (!pending) await addChatEvent(prisma, c, "nudge");
    }
  }
  const stuck = await prisma.whatsAppMessage.findMany({
    where: {
      tenantId: job.tenantId,
      direction: { in: ["in", "event"] },
      processedAt: null,
      createdAt: { lte: new Date(now.getTime() - 60_000) },
    },
    distinct: ["conversationId"],
    select: { conversationId: true, tenantId: true },
    take: 100,
  });
  for (const s of stuck) await queueChat(prisma, { id: s.conversationId, tenantId: s.tenantId });
}
