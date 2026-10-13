import type { PrismaClient } from "./generated/client";

/**
 * Deletes a tenant and everything it owns, including append-only history. Only for the
 * retention purge and test cleanup. The append-only triggers allow deletes only while the
 * `PurgeFlag` row is on. Rows go children-first: SQLite checks RESTRICT links during cascades,
 * so leaving the order to cascades can fail half-way.
 */
export async function purgeTenant(prisma: PrismaClient, tenantId: string): Promise<void> {
  const deal = { deal: { tenantId } };
  await prisma.$executeRaw`UPDATE "PurgeFlag" SET "on" = 1 WHERE "id" = 1`;
  try {
    await prisma.whatsAppMessage.deleteMany({ where: { tenantId } });
    await prisma.secureFormToken.deleteMany({ where: { tenantId } });
    await prisma.applicationSignature.deleteMany({ where: { tenantId } });
    await prisma.whatsAppConversation.deleteMany({ where: { tenantId } });
    await prisma.commission.deleteMany({ where: { tenantId } });
    await prisma.disclosureDelivery.deleteMany({ where: deal });
    await prisma.contract.deleteMany({ where: deal });
    await prisma.funding.deleteMany({ where: deal });
    await prisma.stipulation.deleteMany({ where: deal });
    await prisma.offer.deleteMany({ where: deal });
    await prisma.submission.deleteMany({ where: deal });
    await prisma.position.deleteMany({ where: deal });
    await prisma.bankAnalysis.deleteMany({ where: deal });
    await prisma.renewal.deleteMany({ where: deal });
    await prisma.dealEvent.deleteMany({ where: deal });
    await prisma.activity.deleteMany({ where: { tenantId } });
    await prisma.task.deleteMany({ where: { tenantId } });
    await prisma.aiRun.deleteMany({ where: { tenantId } });
    await prisma.document.deleteMany({ where: { tenantId } });
    await prisma.deal.deleteMany({ where: { tenantId } });
    await prisma.consent.deleteMany({ where: { lead: { tenantId } } });
    await prisma.lead.deleteMany({ where: { tenantId } });
    await prisma.owner.deleteMany({ where: { merchant: { tenantId } } });
    await prisma.merchant.deleteMany({ where: { tenantId } });
    await prisma.funderContact.deleteMany({ where: { funder: { tenantId } } });
    await prisma.funderProgram.deleteMany({ where: { funder: { tenantId } } });
    await prisma.funder.deleteMany({ where: { tenantId } });
    await prisma.sequenceStep.deleteMany({ where: { sequence: { tenantId } } });
    await prisma.sequence.deleteMany({ where: { tenantId } });
    await prisma.tenant.delete({ where: { id: tenantId } });
  } finally {
    await prisma.$executeRaw`UPDATE "PurgeFlag" SET "on" = 0 WHERE "id" = 1`;
  }
}
