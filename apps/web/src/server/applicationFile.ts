import type { PrismaClient } from "@mca/db";
import { dealApplication, missingFields, renderDealApplication } from "./ascendApplication";
import { storeDealFile } from "./documents";
import { tenantMailbox } from "./google";

/**
 * Files Ascend's application (ascendfund.co design, empty "Applicant Signature" box, printed
 * name) on the deal, ready for lenders, as soon as the merchant's own application has been read
 * and nothing required is missing. A newer copy replaces the previous generated one (that one
 * is kept, team-only). Nothing is generated once the merchant has signed online: the signed copy
 * is the one lenders get.
 */
export async function fileAscendApplication(
  prisma: PrismaClient,
  tenantId: string,
  dealId: string,
): Promise<string | null> {
  if (await prisma.applicationSignature.count({ where: { dealId } })) return null;
  // Only a complete application goes to lenders; the deal page lists what is missing.
  const app = await dealApplication(prisma, tenantId, dealId);
  if (!app || missingFields(app.draft, app.pii).length) return null;
  const pdf = await renderDealApplication(prisma, tenantId, dealId);
  if (!pdf) return null;
  const deal = await prisma.deal.findUniqueOrThrow({ where: { id: dealId } });
  const mailbox = await tenantMailbox(prisma, tenantId);
  const doc = await storeDealFile(prisma, mailbox, {
    tenantId,
    dealId,
    merchantId: deal.merchantId,
    file: { fileName: pdf.fileName, mimeType: "application/pdf", data: pdf.data },
    type: "APPLICATION",
    uploadedVia: "generated",
    autoProcess: false,
  });
  await prisma.document.updateMany({
    where: { dealId, uploadedVia: "generated", internalOnly: false, id: { not: doc.id } },
    data: { internalOnly: true },
  });
  return doc.id;
}

/** After the merchant signs online, generated (unsigned) copies stop going to lenders. */
export async function retireGeneratedApplications(prisma: PrismaClient, dealId: string) {
  await prisma.document.updateMany({
    where: { dealId, uploadedVia: "generated", internalOnly: false },
    data: { internalOnly: true },
  });
}
