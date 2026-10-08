import type { ApplicationReading, ChatAnswer, ChatAnswerKind } from "@mca/ai";

/**
 * The fields of Ascend's application the WhatsApp bot fills, in the order it asks them.
 * Same shape as the website payload (ApplicationPayloadSchema) minus SSN and date of birth,
 * which only ever go through the one-time secure link.
 */
export type Lang = "en" | "es";

export interface Address {
  line1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}

export interface Draft {
  business: {
    legalName?: string;
    dba?: string;
    entityType?: "LLC" | "CORP" | "S_CORP" | "SOLE_PROP" | "PARTNERSHIP" | "NONPROFIT" | "OTHER";
    ein?: string;
    startDate?: string;
    industry?: string;
    naics?: string;
    phone?: string;
    email?: string;
    website?: string;
    address?: Address;
  };
  request: {
    amount?: number;
    useOfFunds?: string;
    monthlyRevenue?: number;
    existingAdvances?: { lender: string; balance?: number }[];
  };
  owners: {
    firstName?: string;
    lastName?: string;
    ownershipPct?: number;
    email?: string;
    phone?: string;
    address?: Address;
    creditScore?: number;
  }[];
}

export const emptyDraft = (): Draft => ({ business: {}, request: {}, owners: [{}] });

/** Field state: still to ask, read from the PDF but worth a yes/no, or done. */
export type FieldStatus = "ask" | "confirm" | "ok";

type Parsed = { ok: true; value: unknown } | { ok: false };
const no: Parsed = { ok: false };

export interface FieldDef {
  key: string;
  required: boolean;
  /** "skip" / "none" accepted (value left empty). */
  skippable: boolean;
  /** Slot the AI reads when the plain parser fails; null = never use AI for this field. */
  ai: ChatAnswerKind | null;
  label: Record<Lang, string>;
  ask: Record<Lang, string>;
  get(d: Draft): unknown;
  set(d: Draft, v: unknown): void;
  parse(reply: string): Parsed;
  fromAi(a: ChatAnswer): Parsed;
  show(v: unknown): string;
}

// --- plain parsers -----------------------------------------------------------

const clean = (s: string) => s.trim().replace(/\s+/g, " ");
export const SKIP_WORDS = /^(skip|none|no|n\/a|na|saltar|omitir|ninguno|ninguna|no tengo|nada)$/i;

export function parseMoney(s: string): number | null {
  const t = s
    .toLowerCase()
    .replace(/[$,\s]/g, "")
    .replace(/usd|dollars?|d[oó]lares/g, "");
  const m = /^(\d+(?:\.\d+)?)(k|m|mil|million|millones)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const mult = m[2] === "k" || m[2] === "mil" ? 1e3 : m[2] ? 1e6 : 1;
  const v = Math.round(n * mult);
  return v > 0 && v <= 100_000_000 ? v : null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  enero: 1,
  feb: 2,
  february: 2,
  febrero: 2,
  mar: 3,
  march: 3,
  marzo: 3,
  apr: 4,
  april: 4,
  abril: 4,
  may: 5,
  mayo: 5,
  jun: 6,
  june: 6,
  junio: 6,
  jul: 7,
  july: 7,
  julio: 7,
  aug: 8,
  august: 8,
  agosto: 8,
  sep: 9,
  sept: 9,
  september: 9,
  septiembre: 9,
  setiembre: 9,
  oct: 10,
  october: 10,
  octubre: 10,
  nov: 11,
  november: 11,
  noviembre: 11,
  dec: 12,
  december: 12,
  diciembre: 12,
};

const iso = (y: number, m: number, d = 1) => {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const s = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const date = new Date(`${s}T00:00:00Z`);
  return date.getUTCMonth() + 1 === m ? s : null;
};

export function parseDate(s: string): string | null {
  const t = clean(s)
    .toLowerCase()
    .replace(/,/g, "")
    .replace(/\bde(l)?\b/g, " ")
    .replace(/\s+/g, " ");
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return iso(+m[1]!, +m[2]!, +m[3]!);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (m) return iso(+m[3]!, +m[1]!, +m[2]!);
  m = /^(\d{1,2})[/-](\d{4})$/.exec(t);
  if (m) return iso(+m[2]!, +m[1]!);
  m = /^([a-zé]+)\.? (\d{4})$/.exec(t);
  if (m && MONTHS[m[1]!]) return iso(+m[2]!, MONTHS[m[1]!]!);
  m = /^(\d{4})$/.exec(t);
  if (m) return iso(+m[1]!, 1);
  return null;
}

const STATES = new Set(
  "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split(
    " ",
  ),
);

export function parseAddress(s: string): Address | null {
  const m = /^(.+?),\s*([^,]+?),?\s+([A-Za-z]{2})\.?,?\s+(\d{5}(?:-\d{4})?)$/.exec(clean(s));
  if (!m) return null;
  const state = m[3]!.toUpperCase();
  if (!STATES.has(state)) return null;
  return { line1: m[1]!, city: m[2]!, state, postalCode: m[4]! };
}

function addressFromAi(a: ChatAnswer): Parsed {
  const x = a.address;
  const state = x?.state?.toUpperCase();
  if (
    !x?.line1 ||
    !x.city ||
    !state ||
    !STATES.has(state) ||
    !/^\d{5}(-\d{4})?$/.test(x.postalCode ?? "")
  )
    return no;
  return { ok: true, value: { line1: x.line1, city: x.city, state, postalCode: x.postalCode! } };
}

export const showAddress = (a: Address | undefined) =>
  a
    ? [a.line1, a.city, [a.state, a.postalCode].filter(Boolean).join(" ")]
        .filter(Boolean)
        .join(", ")
    : "";

const money = (v: unknown) => (typeof v === "number" ? `$${v.toLocaleString("en-US")}` : "");

const ENTITY: [RegExp, NonNullable<Draft["business"]["entityType"]>, string][] = [
  [/^(1|llc|l\.l\.c\.?)$/i, "LLC", "LLC"],
  [/^(2|corp|corporation|c corp|c-corp|inc|corporaci[oó]n)$/i, "CORP", "Corporation"],
  [/^(3|s corp|s-corp|scorp|s corporation)$/i, "S_CORP", "S-Corp"],
  [
    /^(4|sole prop|sole proprietor(ship)?|dba|individual|propietario [uú]nico)$/i,
    "SOLE_PROP",
    "Sole proprietor",
  ],
  [/^(5|partnership|sociedad)$/i, "PARTNERSHIP", "Partnership"],
  [/^(6|other|otro|otra)$/i, "OTHER", "Other"],
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

const text =
  (min = 2, max = 200) =>
  (s: string): Parsed => {
    const v = clean(s);
    return v.length >= min && v.length <= max ? { ok: true, value: v } : no;
  };
const textFromAi = (a: ChatAnswer): Parsed =>
  a.understood && a.text ? { ok: true, value: clean(a.text) } : no;
const numberFromAi =
  (min: number, max: number) =>
  (a: ChatAnswer): Parsed =>
    a.understood && typeof a.number === "number" && a.number >= min && a.number <= max
      ? { ok: true, value: Math.round(a.number) }
      : no;
const never = (): Parsed => no;

const owner0 = (d: Draft) => (d.owners[0] ??= {});

// --- fields ----------------------------------------------------------------------

export const FIELDS: FieldDef[] = [
  {
    key: "business.legalName",
    required: true,
    skippable: false,
    ai: null,
    label: { en: "Business legal name", es: "Nombre legal del negocio" },
    ask: {
      en: "What is the business's legal name (as registered)?",
      es: "¿Cuál es el nombre legal del negocio (como está registrado)?",
    },
    get: (d) => d.business.legalName,
    set: (d, v) => (d.business.legalName = v as string),
    parse: text(2, 200),
    fromAi: never,
    show: (v) => String(v ?? ""),
  },
  {
    key: "business.dba",
    required: false,
    skippable: true,
    ai: null,
    label: { en: "DBA (trade name)", es: "Nombre comercial (DBA)" },
    ask: {
      en: "Does the business use another name (DBA)? Type it, or reply *skip*.",
      es: "¿El negocio usa otro nombre comercial (DBA)? Escríbalo, o responda *saltar*.",
    },
    get: (d) => d.business.dba,
    set: (d, v) => (d.business.dba = v as string),
    parse: text(2, 200),
    fromAi: never,
    show: (v) => String(v ?? ""),
  },
  {
    key: "business.entityType",
    required: true,
    skippable: false,
    ai: null,
    label: { en: "Entity type", es: "Tipo de entidad" },
    ask: {
      en: "What type of business is it? Reply with the number:\n1 LLC\n2 Corporation\n3 S-Corp\n4 Sole proprietor\n5 Partnership\n6 Other",
      es: "¿Qué tipo de negocio es? Responda con el número:\n1 LLC\n2 Corporación\n3 S-Corp\n4 Propietario único\n5 Sociedad\n6 Otro",
    },
    get: (d) => d.business.entityType,
    set: (d, v) => (d.business.entityType = v as Draft["business"]["entityType"]),
    parse: (s) => {
      const hit = ENTITY.find(([re]) => re.test(clean(s).replace(/\.$/, "")));
      return hit ? { ok: true, value: hit[1] } : no;
    },
    fromAi: never,
    show: (v) => ENTITY.find(([, k]) => k === v)?.[2] ?? String(v ?? ""),
  },
  {
    key: "business.ein",
    required: true,
    skippable: true,
    ai: null,
    label: { en: "EIN (tax ID)", es: "EIN (número de impuestos)" },
    ask: {
      en: "What is the business's EIN (9 digits, like 12-3456789)? Reply *none* if it doesn't have one.",
      es: "¿Cuál es el EIN del negocio (9 dígitos, como 12-3456789)? Responda *ninguno* si no tiene.",
    },
    get: (d) => d.business.ein,
    set: (d, v) => (d.business.ein = v as string),
    parse: (s) => {
      const digits = s.replace(/[\s-]/g, "");
      return /^\d{9}$/.test(digits)
        ? { ok: true, value: `${digits.slice(0, 2)}-${digits.slice(2)}` }
        : no;
    },
    fromAi: never,
    show: (v) => String(v ?? ""),
  },
  {
    key: "business.startDate",
    required: true,
    skippable: false,
    ai: "date",
    label: { en: "Business start date", es: "Fecha de inicio del negocio" },
    ask: {
      en: "When did the business start? Month and year is fine (e.g. March 2019).",
      es: "¿Cuándo empezó el negocio? Mes y año es suficiente (ej. marzo 2019).",
    },
    get: (d) => d.business.startDate,
    set: (d, v) => (d.business.startDate = v as string),
    parse: (s) => {
      const v = parseDate(s);
      return v && v <= new Date().toISOString().slice(0, 10) ? { ok: true, value: v } : no;
    },
    fromAi: (a) => {
      const v = a.understood && a.date ? parseDate(a.date) : null;
      return v && v <= new Date().toISOString().slice(0, 10) ? { ok: true, value: v } : no;
    },
    show: (v) => String(v ?? ""),
  },
  {
    key: "business.industry",
    required: true,
    skippable: false,
    ai: null,
    label: { en: "Industry", es: "Industria" },
    ask: {
      en: "What does the business do? (e.g. restaurant, trucking, construction)",
      es: "¿A qué se dedica el negocio? (ej. restaurante, transporte, construcción)",
    },
    get: (d) => d.business.industry,
    set: (d, v) => (d.business.industry = v as string),
    parse: text(2, 120),
    fromAi: never,
    show: (v) => String(v ?? ""),
  },
  {
    key: "business.address",
    required: true,
    skippable: false,
    ai: "address",
    label: { en: "Business address", es: "Dirección del negocio" },
    ask: {
      en: "What is the business address? (street, city, state, ZIP)",
      es: "¿Cuál es la dirección del negocio? (calle, ciudad, estado, código postal)",
    },
    get: (d) => (d.business.address?.line1 ? d.business.address : undefined),
    set: (d, v) => (d.business.address = v as Address),
    parse: (s) => {
      const a = parseAddress(s);
      return a ? { ok: true, value: a } : no;
    },
    fromAi: addressFromAi,
    show: (v) => showAddress(v as Address),
  },
  {
    key: "business.phone",
    required: false,
    skippable: true,
    ai: null,
    label: { en: "Business phone", es: "Teléfono del negocio" },
    ask: {
      en: "What is the business phone? Reply *same* if it's this WhatsApp number.",
      es: "¿Cuál es el teléfono del negocio? Responda *mismo* si es este número de WhatsApp.",
    },
    get: (d) => d.business.phone,
    set: (d, v) => (d.business.phone = v as string),
    parse: (s) => {
      if (/^(same|this|mismo|este|igual)$/i.test(clean(s)))
        return { ok: true, value: "__whatsapp__" };
      const digits = s.replace(/\D/g, "");
      return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"))
        ? { ok: true, value: formatPhone(digits) }
        : no;
    },
    fromAi: never,
    show: (v) => String(v ?? ""),
  },
  {
    key: "business.email",
    required: true,
    skippable: false,
    ai: null,
    label: { en: "Business email", es: "Correo del negocio" },
    ask: {
      en: "What email should we use for the business?",
      es: "¿Qué correo electrónico usamos para el negocio?",
    },
    get: (d) => d.business.email,
    set: (d, v) => (d.business.email = v as string),
    parse: (s) => (EMAIL.test(clean(s)) ? { ok: true, value: clean(s).toLowerCase() } : no),
    fromAi: never,
    show: (v) => String(v ?? ""),
  },
  {
    key: "request.amount",
    required: true,
    skippable: false,
    ai: "number",
    label: { en: "Amount requested", es: "Monto solicitado" },
    ask: { en: "How much funding do you need?", es: "¿Cuánto financiamiento necesita?" },
    get: (d) => d.request.amount,
    set: (d, v) => (d.request.amount = v as number),
    parse: (s) => {
      const v = parseMoney(s);
      return v && v >= 1000 ? { ok: true, value: v } : no;
    },
    fromAi: numberFromAi(1000, 10_000_000),
    show: money,
  },
  {
    key: "request.useOfFunds",
    required: false,
    skippable: true,
    ai: null,
    label: { en: "Use of funds", es: "Uso de los fondos" },
    ask: {
      en: "What will you use the money for? (or reply *skip*)",
      es: "¿Para qué usará el dinero? (o responda *saltar*)",
    },
    get: (d) => d.request.useOfFunds,
    set: (d, v) => (d.request.useOfFunds = v as string),
    parse: text(2, 500),
    fromAi: never,
    show: (v) => String(v ?? ""),
  },
  {
    key: "request.monthlyRevenue",
    required: true,
    skippable: false,
    ai: "number",
    label: { en: "Monthly revenue", es: "Ingresos mensuales" },
    ask: {
      en: "About how much does the business deposit per month?",
      es: "¿Aproximadamente cuánto deposita el negocio por mes?",
    },
    get: (d) => d.request.monthlyRevenue,
    set: (d, v) => (d.request.monthlyRevenue = v as number),
    parse: (s) => {
      const v = parseMoney(s);
      return v ? { ok: true, value: v } : no;
    },
    fromAi: numberFromAi(1, 100_000_000),
    show: money,
  },
  {
    key: "request.existingAdvances",
    required: true,
    skippable: false,
    ai: "advances",
    label: { en: "Current advances / loans", es: "Adelantos / préstamos actuales" },
    ask: {
      en: "Do you have any open advances or loans now? List the company and balance (e.g. *ABC Funding $8,000*), or reply *none*.",
      es: "¿Tiene adelantos o préstamos abiertos ahora? Indique la compañía y el saldo (ej. *ABC Funding $8,000*), o responda *ninguno*.",
    },
    get: (d) => d.request.existingAdvances,
    set: (d, v) => (d.request.existingAdvances = v as Draft["request"]["existingAdvances"]),
    parse: (s) => (SKIP_WORDS.test(clean(s)) || clean(s) === "0" ? { ok: true, value: [] } : no),
    fromAi: (a) =>
      a.understood && a.advances
        ? {
            ok: true,
            value: a.advances.map((x) => ({
              lender: x.lender,
              ...(x.balance !== null ? { balance: x.balance } : {}),
            })),
          }
        : no,
    show: (v) => {
      const list = v as { lender: string; balance?: number }[] | undefined;
      if (!list) return "";
      return list.length
        ? list
            .map((x) => `${x.lender}${x.balance !== undefined ? ` ${money(x.balance)}` : ""}`)
            .join("; ")
        : "None";
    },
  },
  {
    key: "owners.0.name",
    required: true,
    skippable: false,
    ai: null,
    label: { en: "Owner's full name", es: "Nombre completo del dueño" },
    ask: {
      en: "What is the owner's full legal name (first and last)?",
      es: "¿Cuál es el nombre legal completo del dueño (nombre y apellido)?",
    },
    get: (d) =>
      d.owners[0]?.firstName && d.owners[0]?.lastName
        ? `${d.owners[0].firstName} ${d.owners[0].lastName}`
        : undefined,
    set: (d, v) => {
      const [first, ...rest] = String(v).split(" ");
      owner0(d).firstName = first;
      owner0(d).lastName = rest.join(" ");
    },
    parse: (s) => {
      const v = clean(s);
      return /^[\p{L}'.-]+( [\p{L}'.-]+)+$/u.test(v) && v.length <= 120
        ? { ok: true, value: v }
        : no;
    },
    fromAi: never,
    show: (v) => String(v ?? ""),
  },
  {
    key: "owners.0.ownershipPct",
    required: true,
    skippable: false,
    ai: null,
    label: { en: "Ownership %", es: "% de propiedad" },
    ask: {
      en: "What percent of the business do they own?",
      es: "¿Qué porcentaje del negocio le pertenece?",
    },
    get: (d) => d.owners[0]?.ownershipPct,
    set: (d, v) => (owner0(d).ownershipPct = v as number),
    parse: (s) => {
      const m = /^(\d{1,3}(?:\.\d+)?)\s*%?$/.exec(clean(s));
      const v = m ? Number(m[1]) : NaN;
      return v > 0 && v <= 100 ? { ok: true, value: v } : no;
    },
    fromAi: never,
    show: (v) => (v === undefined ? "" : `${v}%`),
  },
  {
    key: "owners.0.address",
    required: true,
    skippable: false,
    ai: "address",
    label: { en: "Owner's home address", es: "Dirección personal del dueño" },
    ask: {
      en: "What is the owner's home address? (street, city, state, ZIP)",
      es: "¿Cuál es la dirección personal del dueño? (calle, ciudad, estado, código postal)",
    },
    get: (d) => (d.owners[0]?.address?.line1 ? d.owners[0].address : undefined),
    set: (d, v) => (owner0(d).address = v as Address),
    parse: (s) => {
      const a = parseAddress(s);
      return a ? { ok: true, value: a } : no;
    },
    fromAi: addressFromAi,
    show: (v) => showAddress(v as Address),
  },
  {
    key: "owners.0.email",
    required: false,
    skippable: true,
    ai: null,
    label: { en: "Owner's email", es: "Correo del dueño" },
    ask: {
      en: "Owner's personal email? Reply *same* to use the business email, or *skip*.",
      es: "¿Correo personal del dueño? Responda *mismo* para usar el del negocio, o *saltar*.",
    },
    get: (d) => d.owners[0]?.email,
    set: (d, v) => (owner0(d).email = v as string),
    parse: (s) => {
      if (/^(same|mismo|igual)$/i.test(clean(s))) return { ok: true, value: "__business__" };
      return EMAIL.test(clean(s)) ? { ok: true, value: clean(s).toLowerCase() } : no;
    },
    fromAi: never,
    show: (v) => String(v ?? ""),
  },
  {
    key: "owners.0.creditScore",
    required: false,
    skippable: true,
    ai: null,
    label: { en: "Estimated credit score", es: "Puntaje de crédito estimado" },
    ask: {
      en: "About what is the owner's credit score? (e.g. 650, or *skip*)",
      es: "¿Más o menos cuál es el puntaje de crédito del dueño? (ej. 650, o *saltar*)",
    },
    get: (d) => d.owners[0]?.creditScore,
    set: (d, v) => (owner0(d).creditScore = v as number),
    parse: (s) => {
      const v = Number(clean(s).replace(/[^\d]/g, ""));
      return v >= 300 && v <= 850 ? { ok: true, value: v } : no;
    },
    fromAi: never,
    show: (v) => String(v ?? ""),
  },
];

export const fieldByKey = (key: string) => FIELDS.find((f) => f.key === key);

export function formatPhone(digits: string): string {
  const d = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : `+${digits}`;
}

/** "+1 ••• ••• 0123" — the WhatsApp number as shown on the signed application. */
export function maskPhone(waId: string): string {
  return `+${waId.length > 10 ? waId.slice(0, waId.length - 10) : ""} ••• ••• ${waId.slice(-4)}`;
}

const filled = (v: unknown) => v !== undefined && v !== null && v !== "";

/**
 * After the PDF is read: fields it filled are "ok" (or "confirm" when the reader was unsure);
 * required fields it left empty are "ask". Optional empty fields are left for the review step
 * so the merchant only answers what Ascend actually needs.
 */
export function fieldStatesFromReading(
  draft: Draft,
  lowConfidence: string[],
): Record<string, FieldStatus> {
  const unsure = (key: string) => {
    const prefix = key === "owners.0.name" ? ["owners.0.firstName", "owners.0.lastName"] : [key];
    return lowConfidence.some((p) =>
      prefix.some((k) => p === k || p.startsWith(`${k}.`) || k.startsWith(`${p}.`)),
    );
  };
  const out: Record<string, FieldStatus> = {};
  for (const f of FIELDS) {
    const v = f.get(draft);
    // An application with no advances listed may just have left the section blank: ask to confirm.
    const blankList = Array.isArray(v) && v.length === 0;
    if (filled(v)) out[f.key] = unsure(f.key) || blankList ? "confirm" : "ok";
    else out[f.key] = f.required ? "ask" : "ok";
  }
  return out;
}

/** Every field asked (merchant has no PDF). */
export const allFieldsAsk = (): Record<string, FieldStatus> =>
  Object.fromEntries(FIELDS.map((f) => [f.key, "ask" as FieldStatus]));

/** A5 output → draft (SSN and DOB are returned separately so they can be encrypted). */
export function readingToDraft(r: ApplicationReading): {
  draft: Draft;
  pii: { ssn: string | null; dob: string | null }[];
} {
  const s = (v: string | null) => (v && v.trim() ? v.trim() : undefined);
  const n = (v: number | null) => (v === null ? undefined : v);
  const b = r.business;
  const state = (v: string | null) => {
    const x = v?.trim().toUpperCase();
    return x && STATES.has(x) ? x : undefined;
  };
  const addr = (
    line1: string | null,
    city: string | null,
    st: string | null,
    zip: string | null,
  ) =>
    s(line1) ? { line1: s(line1), city: s(city), state: state(st), postalCode: s(zip) } : undefined;
  const ein = b.ein?.replace(/\D/g, "");
  const date = (v: string | null) => (v ? (parseDate(v) ?? undefined) : undefined);
  const draft: Draft = {
    business: {
      legalName: s(b.legalName),
      dba: s(b.dba),
      entityType: b.entityType ?? undefined,
      ein: ein && ein.length === 9 ? `${ein.slice(0, 2)}-${ein.slice(2)}` : undefined,
      startDate: date(b.startDate),
      industry: s(b.industry),
      naics: b.naics && /^\d{2,6}$/.test(b.naics) ? b.naics : undefined,
      phone: s(b.phone),
      email: b.email && EMAIL.test(b.email.trim()) ? b.email.trim().toLowerCase() : undefined,
      website: s(b.website),
      address: addr(b.addressLine1, b.city, b.state, b.postalCode),
    },
    request: {
      amount: n(r.request.requestedAmount) || undefined,
      useOfFunds: s(r.request.useOfFunds),
      monthlyRevenue: n(r.request.statedMonthlyRevenue),
      existingAdvances: r.request.existingAdvances.map((x) => ({
        lender: x.lender,
        ...(x.balance !== null ? { balance: x.balance } : {}),
      })),
    },
    owners: r.owners
      .filter((o) => o.firstName || o.lastName)
      .map((o) => ({
        firstName: s(o.firstName),
        lastName: s(o.lastName),
        ownershipPct: n(o.ownershipPct),
        email: o.email && EMAIL.test(o.email.trim()) ? o.email.trim().toLowerCase() : undefined,
        phone: s(o.phone),
        address: addr(o.addressLine1, o.city, o.state, o.postalCode),
        creditScore: n(o.creditScoreStated),
      })),
  };
  if (draft.owners.length === 0) draft.owners.push({});
  const pii = r.owners
    .filter((o) => o.firstName || o.lastName)
    .map((o) => ({ ssn: validSsn(o.ssn), dob: date(o.dob) ?? null }));
  return { draft, pii };
}

export function validSsn(v: string | null | undefined): string | null {
  const d = (v ?? "").replace(/\D/g, "");
  if (d.length !== 9 || /^(000|666|9)/.test(d) || d.slice(3, 5) === "00" || d.slice(5) === "0000")
    return null;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

/** Lower-case, no accents, single spaces: "José  Muñoz" → "jose munoz". */
export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The typed signature must contain the owner's first name and every part of the last name. */
export function nameMatches(
  typed: string,
  owner: { firstName?: string; lastName?: string },
): boolean {
  const words = new Set(normalizeName(typed).split(" "));
  const need = normalizeName(`${owner.firstName ?? ""} ${owner.lastName ?? ""}`)
    .split(" ")
    .filter(Boolean);
  return need.length >= 2 && need.every((w) => words.has(w));
}
