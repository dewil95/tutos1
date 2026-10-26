import type { ApplicationReading } from "@mca/ai";
import { pdfTextItems, type PdfTextItem } from "@mca/connectors";

/**
 * Reads a digital application PDF (another company's form, or Ascend's own) by its labels:
 * "Legal Company Name", "Tax ID / EIN", "Social Security Number"… Labels sit in a column and
 * each value sits to the right of its label (on the same line, or wrapped around it), so every
 * value goes to the closest label in its column. No AI needed; a scan or photo returns null and
 * the AI reads it instead.
 */

type Key =
  | "legalName"
  | "dba"
  | "ein"
  | "startDate"
  | "entityType"
  | "industry"
  | "address"
  | "city"
  | "state"
  | "zip"
  | "amount"
  | "revenue"
  | "ownerName"
  | "firstName"
  | "lastName"
  | "pct"
  | "ssn"
  | "fico"
  | "dob"
  | "other";

type Scope = "business" | "owner" | "either";

const LABELS: [Key, Scope, string[]][] = [
  [
    "legalName",
    "business",
    [
      "legal company name",
      "legal business name",
      "business legal name",
      "legal name",
      "company name",
      "business name",
      "corporate name",
      "company legal name",
    ],
  ],
  ["dba", "business", ["doing business as", "dba", "d/b/a", "dba name", "trade name"]],
  [
    "ein",
    "business",
    [
      "tax id / ein",
      "tax id/ein",
      "tax id",
      "ein",
      "fein",
      "federal tax id",
      "federal tax id (ein)",
      "tax id number",
      "ein / tax id",
    ],
  ],
  [
    "startDate",
    "business",
    [
      "business start date",
      "start date",
      "date business started",
      "business inception date",
      "inception date",
      "date established",
      "date of incorporation",
    ],
  ],
  [
    "entityType",
    "business",
    [
      "entity type",
      "type of entity",
      "legal entity",
      "business entity",
      "entity",
      "legal structure",
    ],
  ],
  [
    "industry",
    "business",
    ["industry", "type of business", "business type", "industry type", "nature of business"],
  ],
  [
    "amount",
    "business",
    [
      "financing amount",
      "requested amount",
      "amount requested",
      "funding amount",
      "loan amount",
      "amount needed",
      "requested funding",
      "funding requested",
    ],
  ],
  [
    "revenue",
    "business",
    [
      "monthly revenue",
      "monthly sales",
      "average monthly sales",
      "gross monthly sales",
      "avg monthly revenue",
      "average monthly revenue",
      "monthly gross revenue",
      "monthly gross sales",
    ],
  ],
  ["address", "business", ["business address", "company address"]],
  ["address", "owner", ["home address", "residential address", "owner address"]],
  ["address", "either", ["address", "address line 1", "address 1", "street address", "street"]],
  ["city", "either", ["city"]],
  ["state", "either", ["state"]],
  ["zip", "either", ["zip", "zip code", "postal code", "zipcode"]],
  [
    "ownerName",
    "owner",
    ["full name", "owner name", "owner full name", "applicant name", "name of owner", "owner"],
  ],
  ["firstName", "owner", ["first name", "owner first name"]],
  ["lastName", "owner", ["last name", "owner last name"]],
  [
    "pct",
    "owner",
    [
      "ownership %",
      "ownership",
      "% ownership",
      "ownership percentage",
      "percent ownership",
      "% owned",
    ],
  ],
  [
    "ssn",
    "owner",
    [
      "social security number",
      "social security no.",
      "social security no",
      "social security #",
      "ssn",
      "ss#",
    ],
  ],
  ["fico", "owner", ["fico score", "credit score", "fico"]],
  ["dob", "owner", ["date of birth", "dob", "birth date", "birthdate"]],
  // Known labels we do not use: they keep their values away from the fields above.
  [
    "other",
    "either",
    [
      "company website",
      "website",
      "state of incorporation",
      "do you process credit",
      "cards?",
      "address line 2",
      "address 2",
      "email",
      "email address",
      "phone",
      "phone number",
      "mobile phone",
      "cell phone",
      "business phone",
      "mca balances account",
      "mca balances bank",
      "name",
      "use of funds",
      "signature",
      "printed name",
    ],
  ],
];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[:*]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

const LABEL_OF = new Map<string, { key: Key; scope: Scope }>();
for (const [key, scope, names] of LABELS) {
  for (const n of names) if (!LABEL_OF.has(n)) LABEL_OF.set(n, { key, scope });
}

const OWNER_HEADER = /\b(owner|principal|guarantor|applicant)\b/;
const BUSINESS_HEADER = /\b(business|company|merchant)\b/;

interface Label extends PdfTextItem {
  key: Key;
  scope: Scope;
  values: PdfTextItem[];
}

/** Values that belong to each label, by column and nearest line. */
function readLabels(items: PdfTextItem[]): { section: "business" | "owner"; label: Label }[] {
  const labels: Label[] = [];
  for (const it of items) {
    const hit = LABEL_OF.get(norm(it.text));
    if (hit) labels.push({ ...it, ...hit, values: [] });
  }
  if (labels.length < 4) return [];

  // Label columns: labels within 15pt of each other horizontally.
  const xs = [...new Set(labels.map((l) => Math.round(l.x)))].sort((a, b) => a - b);
  const cols: number[] = [];
  for (const x of xs) if (!cols.length || x - cols.at(-1)! > 15) cols.push(x);
  const colOf = (x: number) => {
    let c = -1;
    cols.forEach((cx, i) => {
      if (x >= cx - 3) c = i;
    });
    return c;
  };
  const isLabelColumn = (x: number) => cols.some((cx) => Math.abs(x - cx) <= 3);

  for (const it of items) {
    if (isLabelColumn(it.x) || LABEL_OF.has(norm(it.text))) continue;
    const c = colOf(it.x);
    if (c < 0) continue;
    let best: Label | null = null;
    let bestDy = 13;
    for (const l of labels) {
      if (l.page !== it.page || colOf(l.x) !== c || it.x < l.x + l.width - 1) continue;
      const dy = Math.abs(l.y - it.y);
      if (dy < bestDy) {
        best = l;
        bestDy = dy;
      }
    }
    best?.values.push(it);
  }

  // Section of each label: the closest heading above it in its column (else by its kind).
  const headers = items.filter((it) => {
    const t = norm(it.text);
    return (
      it.text.length <= 40 &&
      !LABEL_OF.has(t) &&
      /information|info|details|section/.test(t) &&
      (OWNER_HEADER.test(t) || BUSINESS_HEADER.test(t))
    );
  });
  const pos = (it: PdfTextItem) => it.page * 10_000 - it.y;
  return labels
    .sort((a, b) => pos(a) - pos(b) || a.x - b.x)
    .map((label) => {
      const above = headers
        .filter((h) => pos(h) < pos(label) && Math.abs(h.x - label.x) < 40)
        .sort((a, b) => pos(b) - pos(a))[0];
      const t = above ? norm(above.text) : "";
      const section: "business" | "owner" =
        label.scope !== "either" ? label.scope : OWNER_HEADER.test(t) ? "owner" : "business";
      return { section, label };
    });
}

const STATES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "puerto rico": "PR",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

export function stateCode(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return STATES[t.toLowerCase().replace(/\s+/g, " ")] ?? null;
}

export function isoDate(v: string | null): string | null {
  if (!v) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim());
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(v.trim());
  if (!m) return null;
  const year = m[3]!.length === 2 ? (Number(m[3]) > 30 ? `19${m[3]}` : `20${m[3]}`) : m[3]!;
  const [mo, d] = [Number(m[1]), Number(m[2])];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${year}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "$55,000" → 55000; a range "$10,001 - $25,000" → its low or high end. */
export function money(v: string | null, end: "low" | "high"): number | null {
  if (!v) return null;
  const nums = [...v.matchAll(/\$?\s*([\d,]+(?:\.\d+)?)\s*([kKmM])?/g)]
    .map(
      (m) =>
        Number(m[1]!.replace(/,/g, "")) *
        (/k/i.test(m[2] ?? "") ? 1e3 : /m/i.test(m[2] ?? "") ? 1e6 : 1),
    )
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return null;
  return end === "high" ? Math.max(...nums) : Math.min(...nums);
}

const ENTITY: [RegExp, NonNullable<ApplicationReading["business"]["entityType"]>][] = [
  [/\bs[\s-]?corp/i, "S_CORP"],
  [/\bl\.?l\.?c\b|limited liability/i, "LLC"],
  [/\bc[\s-]?corp|\bcorp(oration)?\b|\binc\b|incorporated/i, "CORP"],
  [/sole|proprietor/i, "SOLE_PROP"],
  [/partnership|\bllp\b|\blp\b/i, "PARTNERSHIP"],
  [/non[\s-]?profit/i, "NONPROFIT"],
];
const entityOf = (v: string | null) =>
  v ? (ENTITY.find(([re]) => re.test(v))?.[1] ?? null) : null;

/** The application read from a digital PDF's text, or null (scan, photo, or not an application). */
export async function readApplicationText(pdf: Uint8Array): Promise<ApplicationReading | null> {
  let items: PdfTextItem[];
  try {
    items = await pdfTextItems(pdf);
  } catch {
    return null;
  }
  const found = readLabels(items);
  if (!found.length) return null;

  const biz = new Map<Key, string>();
  const owners: Map<Key, string>[] = [new Map(), new Map()];
  let ownerIndex = 0;
  for (const { section, label } of found) {
    const value = label.values
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((v) => v.text)
      .join(" ")
      .trim();
    if (!value || label.key === "other") continue;
    if (section === "business") {
      if (!biz.has(label.key)) biz.set(label.key, value);
      continue;
    }
    // A second owner block starts when an owner name shows up again.
    const o = owners[ownerIndex]!;
    if ((label.key === "ownerName" || label.key === "firstName") && o.has(label.key)) {
      if (ownerIndex === 0) ownerIndex = 1;
      else continue;
    }
    const target = owners[ownerIndex]!;
    if (!target.has(label.key)) target.set(label.key, value);
  }

  const legalName = biz.get("legalName") ?? null;
  const ownerList = owners
    .map((o) => {
      const full = o.get("ownerName");
      const [first, ...rest] = (full ?? "").split(" ");
      const firstName = o.get("firstName") ?? (full ? first! : null);
      const lastName = o.get("lastName") ?? (full ? rest.join(" ") || null : null);
      if (!firstName || !lastName) return null;
      const ssn = (o.get("ssn") ?? "").replace(/\D/g, "");
      const pct = money(o.get("pct") ?? null, "low");
      const fico = Number((o.get("fico") ?? "").replace(/\D/g, ""));
      return {
        firstName,
        lastName,
        ownershipPct: pct !== null && pct <= 100 ? pct : null,
        ssn: ssn.length === 9 ? `${ssn.slice(0, 3)}-${ssn.slice(3, 5)}-${ssn.slice(5)}` : null,
        dob: isoDate(o.get("dob") ?? null),
        email: null,
        phone: null,
        addressLine1: o.get("address") ?? null,
        city: o.get("city") ?? null,
        state: stateCode(o.get("state") ?? null),
        postalCode: o.get("zip")?.replace(/[^\d-]/g, "") || null,
        creditScoreStated: fico >= 300 && fico <= 850 ? fico : null,
      };
    })
    .filter((o): o is NonNullable<typeof o> => o !== null);

  const ein = (biz.get("ein") ?? "").replace(/\D/g, "");
  // Enough to be an application: the business, and the owner or the tax id.
  if (!legalName || (!ownerList.length && ein.length !== 9)) return null;
  return {
    isApplication: true,
    business: {
      legalName,
      dba: biz.get("dba") ?? null,
      entityType: entityOf(biz.get("entityType") ?? null) ?? entityOf(legalName),
      ein: ein.length === 9 ? `${ein.slice(0, 2)}-${ein.slice(2)}` : null,
      startDate: isoDate(biz.get("startDate") ?? null),
      industry: biz.get("industry") ?? null,
      naics: null,
      phone: null,
      email: null,
      website: null,
      addressLine1: biz.get("address") ?? null,
      city: biz.get("city") ?? null,
      state: stateCode(biz.get("state") ?? null),
      postalCode: biz.get("zip")?.replace(/[^\d-]/g, "") || null,
    },
    request: {
      requestedAmount: money(biz.get("amount") ?? null, "high"),
      useOfFunds: null,
      statedMonthlyRevenue: money(biz.get("revenue") ?? null, "low"),
      existingAdvances: [],
    },
    owners: ownerList.slice(0, 2),
    signed: false,
    signatureDate: null,
    lowConfidenceFields: [],
    confidence: 0.9,
  };
}
