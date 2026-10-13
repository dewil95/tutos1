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
  const seeds = funderSeedsFromCsv(opts.csv ?? FUNDER_ROSTER_CSV);
  for (const f of seeds) {
    const { program, ...funder } = f;
    const saved = await prisma.funder.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: f.name } },
      update: {},
      create: { ...funder, tenantId: tenant.id },
    });
    if (!(await prisma.funderProgram.findFirst({ where: { funderId: saved.id } }))) {
      await prisma.funderProgram.create({ data: { ...program, funderId: saved.id } });
    }
  }
  return { tenant, users: team.length, lenders: seeds.length };
}
