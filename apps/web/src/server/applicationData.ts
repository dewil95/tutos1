import type { ApplicationReading } from "@mca/ai";
import { encryptSecret, type EntityType, type PrismaClient } from "@mca/db";
import { requireEnv } from "./env";

export interface FieldConflict {
  field: string;
  current: string;
  fromApplication: string;
}

/**
 * Writes application data onto the merchant, its owners and the deal.
 * - "overwrite": the website form is the source of truth (API submissions).
 * - "fill": AI-read documents only fill empty fields; differences are returned as conflicts for
 *   a person to resolve, never applied silently.
 * SSN, DOB and EIN are stored encrypted (PII_ENCRYPTION_KEY) with only the last 4 in clear.
 */
export async function applyApplication(
  prisma: PrismaClient,
  target: { dealId: string; merchantId: string },
  a: ApplicationReading,
  mode: "overwrite" | "fill",
): Promise<FieldConflict[]> {
  const key = requireEnv("PII_ENCRYPTION_KEY");
  const enc = (v: string | null) => (v ? encryptSecret(v, key) : null);
  const last4 = (v: string | null) => {
    const d = (v ?? "").replace(/\D/g, "");
    return d.length >= 4 ? d.slice(-4) : null;
  };
  const conflicts: FieldConflict[] = [];

  const merchant = await prisma.merchant.findUniqueOrThrow({ where: { id: target.merchantId } });
  const b = a.business;
  const startDate =
    b.startDate && !Number.isNaN(Date.parse(b.startDate)) ? new Date(b.startDate) : null;
  const wanted: Record<string, string | Date | null> = {
    legalName: b.legalName,
    dba: b.dba,
    entityType: b.entityType,
    naics: b.naics,
    industry: b.industry,
    startDate,
    website: b.website,
    phone: b.phone,
    email: b.email?.toLowerCase() ?? null,
    addressLine1: b.addressLine1,
    city: b.city,
    state: b.state?.toUpperCase().slice(0, 2) ?? null,
    postalCode: b.postalCode,
  };
  const merchantData: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(wanted)) {
    if (value === null || value === "") continue;
    const current = (merchant as Record<string, unknown>)[field] as string | Date | null;
    const same =
      current instanceof Date && value instanceof Date
        ? current.getTime() === value.getTime()
        : String(current ?? "").toLowerCase() === String(value).toLowerCase();
    if (current === null || current === "" || mode === "overwrite") {
      if (!same) merchantData[field] = value;
    } else if (!same) {
      conflicts.push({
        field: `merchant.${field}`,
        current: current instanceof Date ? current.toISOString().slice(0, 10) : String(current),
        fromApplication: value instanceof Date ? value.toISOString().slice(0, 10) : String(value),
      });
    }
  }
  if (b.ein) {
    if (!merchant.einEncrypted || mode === "overwrite") {
      merchantData.einEncrypted = enc(b.ein);
      merchantData.einLast4 = last4(b.ein);
    } else if (merchant.einLast4 !== last4(b.ein)) {
      conflicts.push({
        field: "merchant.ein",
        current: `…${merchant.einLast4}`,
        fromApplication: `…${last4(b.ein)}`,
      });
    }
  }
  if (merchantData.entityType) merchantData.entityType = merchantData.entityType as EntityType;
  if (Object.keys(merchantData).length) {
    await prisma.merchant.update({ where: { id: merchant.id }, data: merchantData });
  }

  // Owners: matched by name; new names are added.
  const owners = await prisma.owner.findMany({ where: { merchantId: merchant.id } });
  for (const [i, o] of a.owners.entries()) {
    if (!o.firstName || !o.lastName) continue;
    const existing = owners.find(
      (x) =>
        x.firstName.toLowerCase() === o.firstName!.toLowerCase() &&
        x.lastName.toLowerCase() === o.lastName!.toLowerCase(),
    );
    const data = {
      ownershipPct: o.ownershipPct,
      email: o.email?.toLowerCase() ?? null,
      phone: o.phone,
      addressLine1: o.addressLine1,
      city: o.city,
      state: o.state?.toUpperCase().slice(0, 2) ?? null,
      postalCode: o.postalCode,
      ficoEstimate: o.creditScoreStated,
    };
    if (!existing) {
      await prisma.owner.create({
        data: {
          merchantId: merchant.id,
          firstName: o.firstName,
          lastName: o.lastName,
          isPrimary: owners.length === 0 && i === 0,
          ...data,
          ssnEncrypted: enc(o.ssn),
          ssnLast4: last4(o.ssn),
          dobEncrypted: enc(o.dob),
        },
      });
      continue;
    }
    const update: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(data)) {
      if (value === null || value === undefined) continue;
      const current = (existing as Record<string, unknown>)[field];
      if (current === null || mode === "overwrite") update[field] = value;
    }
    if (o.ssn && (!existing.ssnEncrypted || mode === "overwrite")) {
      update.ssnEncrypted = enc(o.ssn);
      update.ssnLast4 = last4(o.ssn);
    } else if (o.ssn && existing.ssnLast4 !== last4(o.ssn)) {
      conflicts.push({
        field: `owner.${existing.firstName} ${existing.lastName}.ssn`,
        current: `…${existing.ssnLast4}`,
        fromApplication: `…${last4(o.ssn)}`,
      });
    }
    if (o.dob && (!existing.dobEncrypted || mode === "overwrite")) update.dobEncrypted = enc(o.dob);
    if (Object.keys(update).length)
      await prisma.owner.update({ where: { id: existing.id }, data: update });
  }

  // Deal request fields.
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: target.dealId } });
  const dealData: Record<string, unknown> = {};
  const r = a.request;
  if (r.requestedAmount && (deal.requestedAmount === null || mode === "overwrite")) {
    dealData.requestedAmount = r.requestedAmount;
  }
  if (r.useOfFunds && (!deal.useOfFunds || mode === "overwrite"))
    dealData.useOfFunds = r.useOfFunds;
  const positions = (deal.submissionPositions ?? []) as unknown[];
  if (r.existingAdvances.length && positions.length === 0) {
    dealData.submissionPositions = r.existingAdvances.map((x) => ({
      funder: x.lender,
      balance: x.balance,
    }));
  }
  if (Object.keys(dealData).length)
    await prisma.deal.update({ where: { id: deal.id }, data: dealData });

  return conflicts;
}
