/**
 * Seeds the Ascend Fund tenant, its team, and the lender directory from
 * docs/funder-appetite-matrix.csv. Safe to re-run: upserts by name/email.
 *
 *   pnpm db:seed
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { funderSeedsFromCsv } from "../src/funderCsv";
import { getPrisma } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const prisma = getPrisma();

const TENANT = {
  slug: process.env.TENANT_SLUG ?? "ascend",
  name: "Ascend Fund",
  fromAddress: process.env.MAIL_FROM ?? "funding@ascendfund.co",
  teamCc: (process.env.TEAM_CC ?? "jonas@ascendfund.co,savvy@ascendfund.co,david@ascendfund.co")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};

const TEAM: { email: string; name: string; role: "ADMIN" | "CLOSER" | "PROCESSOR" }[] = [
  { email: "jonas@ascendfund.co", name: "Jonas Abreu", role: "ADMIN" },
  { email: "savvy@ascendfund.co", name: "Xavier Abreu", role: "PROCESSOR" },
  { email: "david@ascendfund.co", name: "David Gonzalez", role: "CLOSER" },
];

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: TENANT.slug },
    update: { fromAddress: TENANT.fromAddress, teamCc: TENANT.teamCc },
    create: TENANT,
  });

  for (const u of TEAM) {
    await prisma.user.upsert({
      where: { tenantId_email: { tenantId: tenant.id, email: u.email } },
      update: {},
      create: { ...u, tenantId: tenant.id },
    });
  }

  const csv = readFileSync(join(here, "../../../docs/funder-appetite-matrix.csv"), "utf8");
  const seeds = funderSeedsFromCsv(csv);
  for (const f of seeds) {
    const { program, ...funder } = f;
    const saved = await prisma.funder.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: f.name } },
      update: funder,
      create: { ...funder, tenantId: tenant.id },
    });
    const existing = await prisma.funderProgram.findFirst({
      where: { funderId: saved.id, name: program.name },
    });
    if (existing) await prisma.funderProgram.update({ where: { id: existing.id }, data: program });
    else await prisma.funderProgram.create({ data: { ...program, funderId: saved.id } });
  }
  console.log(`seeded tenant "${tenant.name}", ${TEAM.length} users, ${seeds.length} lenders`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
