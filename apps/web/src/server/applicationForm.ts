import { encryptSecret, type EntityType, type PrismaClient } from "@mca/db";
import { requireEnv } from "./env";

/**
 * The application form shared by the deal page (team) and the merchant's own page
 * (/application/<token>): same field names, same checks, same writes.
 */
export const ENTITY_TYPES = [
  "LLC",
  "CORP",
  "S_CORP",
  "SOLE_PROP",
  "PARTNERSHIP",
  "NONPROFIT",
  "OTHER",
];

/** A problem with what was typed; the message is shown as is. */
export class InputError extends Error {}

/**
 * Reads the form. A field the form does not have reads as undefined, so it is left as it is
 * (the merchant's page has fewer fields than the deal page); an empty field reads as null.
 */
function reader(form: FormData) {
  const text = (k: string): string | null | undefined =>
    form.has(k) ? String(form.get(k) ?? "").trim() || null : undefined;
  const money = (k: string) => {
    const v = text(k);
    if (v === null || v === undefined) return v;
    const n = Number(v.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0) throw new InputError(`Check the number in "${k}".`);
    return n;
  };
  const date = (k: string, what: string) => {
    const v = text(k);
    if (v === null || v === undefined) return v;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))
      throw new InputError(`${what}: use a full date.`);
    return v;
  };
  const state = (k: string) => {
    const v = text(k);
    if (v === null || v === undefined) return v;
    if (!/^[A-Za-z]{2}$/.test(v)) throw new InputError("State: use the 2-letter code (e.g. FL).");
    return v.toUpperCase();
  };
  const digits = (k: string, n: number, what: string) => {
    const v = text(k);
    if (v === null || v === undefined) return v;
    const d = v.replace(/\D/g, "");
    if (d.length !== n) throw new InputError(`${what}: ${n} digits.`);
    return d;
  };
  return { text, money, date, state, digits };
}

const lower = (v: string | null | undefined) => (v ? v.toLowerCase() : v);

/** "ABC Funding $8,000" per line → existing advances (balance optional). */
export function parseAdvanceLines(
  v: string | null | undefined,
): { funder: string; balance?: number }[] {
  return (v ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((line) => {
      const m = /^(.*?)[\s:-]*\$?\s*([\d,]+(?:\.\d+)?)\s*$/.exec(line);
      const balance = m ? Number(m[2]!.replace(/,/g, "")) : NaN;
      return m && m[1]!.trim() && Number.isFinite(balance)
        ? { funder: m[1]!.trim().slice(0, 100), balance }
        : { funder: line.slice(0, 100) };
    });
}

/**
 * Writes the application fields from the form onto the merchant, its owners (two slots) and the
 * deal. Throws InputError for anything that needs fixing. Business fields are checked and saved
 * first, so a problem in an owner slot leaves them saved.
 */
export async function writeApplicationForm(
  prisma: PrismaClient,
  deal: {
    id: string;
    merchantId: string;
    merchant: { owners: { id: string }[] };
  },
  form: FormData,
  opts: { advances?: boolean } = {},
): Promise<void> {
  const key = requireEnv("PII_ENCRYPTION_KEY");
  const r = reader(form);
  const legalName = r.text("legalName");
  if (!legalName) throw new InputError("Business legal name is required.");
  const entity = r.text("entityType");
  if (entity && !ENTITY_TYPES.includes(entity)) throw new InputError("Pick an entity type.");
  const ein = r.digits("ein", 9, "EIN");
  const startDate = r.date("startDate", "Business start date");
  const email = lower(r.text("email"));

  await prisma.merchant.update({
    where: { id: deal.merchantId },
    data: {
      legalName,
      dba: r.text("dba"),
      entityType: (entity as EntityType | null) ?? null,
      ...(ein
        ? {
            einEncrypted: encryptSecret(`${ein.slice(0, 2)}-${ein.slice(2)}`, key),
            einLast4: ein.slice(-4),
          }
        : {}),
      startDate: startDate ? new Date(startDate) : null,
      industry: r.text("industry"),
      phone: r.text("phone"),
      email,
      website: r.text("website"),
      addressLine1: r.text("line1"),
      city: r.text("city"),
      state: r.state("state"),
      postalCode: r.text("postalCode"),
    },
  });
  await prisma.deal.update({
    where: { id: deal.id },
    data: {
      requestedAmount: r.money("amount"),
      useOfFunds: r.text("useOfFunds"),
      statedMonthlyRevenue: r.money("monthlyRevenue"),
      ...(opts.advances ? { submissionPositions: parseAdvanceLines(r.text("advances")) } : {}),
    },
  });

  for (const i of [0, 1]) {
    const firstName = r.text(`firstName-${i}`);
    const lastName = r.text(`lastName-${i}`);
    const ownerId = r.text(`ownerId-${i}`);
    const existing = deal.merchant.owners.find((o) => o.id === ownerId);
    if (!firstName || !lastName) {
      if (existing || r.text(`ssn-${i}`) || r.text(`email-${i}`))
        throw new InputError(`Owner ${i + 1}: first and last name are required.`);
      continue;
    }
    const ssn = r.digits(`ssn-${i}`, 9, `Owner ${i + 1} SSN`);
    const dob = r.date(`dob-${i}`, `Owner ${i + 1} date of birth`);
    const pct = r.money(`pct-${i}`);
    if (pct != null && pct > 100) throw new InputError(`Owner ${i + 1}: ownership over 100%.`);
    const score = r.money(`score-${i}`);
    const data = {
      firstName,
      lastName,
      ownershipPct: pct,
      email: lower(r.text(`email-${i}`)),
      phone: r.text(`phone-${i}`),
      addressLine1: r.text(`line1-${i}`),
      city: r.text(`city-${i}`),
      state: r.state(`state-${i}`),
      postalCode: r.text(`postalCode-${i}`),
      ficoEstimate: score === null || score === undefined ? score : Math.round(score),
      ...(ssn
        ? {
            ssnEncrypted: encryptSecret(
              `${ssn.slice(0, 3)}-${ssn.slice(3, 5)}-${ssn.slice(5)}`,
              key,
            ),
            ssnLast4: ssn.slice(-4),
          }
        : {}),
      ...(dob ? { dobEncrypted: encryptSecret(dob, key) } : {}),
    };
    if (existing) await prisma.owner.update({ where: { id: existing.id }, data });
    else
      await prisma.owner.create({
        data: {
          merchantId: deal.merchantId,
          isPrimary: deal.merchant.owners.length === 0 && i === 0,
          ...data,
        },
      });
  }
}
