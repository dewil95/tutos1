import { funderSeedsFromCsv } from "./funderCsv";
import { FUNDER_ROSTER_CSV } from "./funderRoster";
import type { PrismaClient, UserRole } from "./generated/client";

export interface SeedOptions {
  slug?: string;
  name?: string;
  fromAddress?: string;
  team?: { email: string; name: string; role: UserRole }[];
  teamCc?: string[];
  csv?: string;
}

const DEFAULT_TEAM: SeedOptions["team"] = [
  { email: "jonas@ascendfund.co", name: "Jonas Abreu", role: "ADMIN" },
  { email: "savvy@ascendfund.co", name: "Xavier Abreu", role: "PROCESSOR" },
  { email: "david@ascendfund.co", name: "David Gonzalez", role: "CLOSER" },
];

/**
 * Creates (or tops up) the Ascend Fund tenant, its team and the lender directory. Safe to run
 * again: matches on slug, email and lender name, and never deletes anything.
 */
export async function seedTenant(prisma: PrismaClient, opts: SeedOptions = {}) {
  const team = opts.team ?? DEFAULT_TEAM!;
  const slug = opts.slug ?? "ascend";
  const teamCc = opts.teamCc ?? team.map((u) => u.email);
  const tenant = await prisma.tenant.upsert({
    where: { slug },
    update: {},
    create: {
      slug,
      name: opts.name ?? "Ascend Fund",
      fromAddress: opts.fromAddress ?? "funding@ascendfund.co",
      teamCc,
    },
  });
  for (const u of team) {
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
      update: {},
      create: { ...u, tenantId: tenant.id },
    });
  }
  const lenders = await syncFunders(prisma, tenant.id, opts.csv);
  return { tenant, users: team.length, lenders: lenders.added + lenders.updated };
}

/**
 * Brings a tenant's lender directory in line with the roster: a lender new on the roster is
 * added; one already there gets the roster's addresses and appetite (minimum revenue, states,
 * positions, industries). Nothing is ever deleted, and a lender's own isActive flag is kept.
 */
export async function syncFunders(
  prisma: PrismaClient,
  tenantId: string,
  csv?: string,
): Promise<{ added: number; updated: number }> {
  let added = 0;
  let updated = 0;
  for (const f of funderSeedsFromCsv(csv ?? FUNDER_ROSTER_CSV)) {
    const { program, isActive, ...funder } = f;
    const existing = await prisma.funder.findUnique({
      where: { tenantId_name: { tenantId, name: f.name } },
    });
    const saved = existing
      ? await prisma.funder.update({ where: { id: existing.id }, data: funder })
      : await prisma.funder.create({ data: { ...funder, isActive, tenantId } });
    const current = await prisma.funderProgram.findFirst({
      where: { funderId: saved.id, name: program.name },
    });
    if (current) {
      await prisma.funderProgram.update({ where: { id: current.id }, data: program });
    } else {
      await prisma.funderProgram.create({ data: { ...program, funderId: saved.id } });
    }
    if (existing) updated++;
    else added++;
  }
  return { added, updated };
}
