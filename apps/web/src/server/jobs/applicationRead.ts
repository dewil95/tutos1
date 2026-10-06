import { maskApplication, runApplicationReading } from "@mca/ai";
import type { ClaimedJob, Prisma, PrismaClient } from "@mca/db";
import { llmClient } from "../ai";
import { applyApplication } from "../applicationData";
import { tenantMailbox } from "../google";
import { PermanentJobError } from "./errors";

export interface ApplicationReadPayload {
  documentId: string;
}

/**
 * A5: reads an application file (PDF or photo) with Gemini and fills empty merchant, owner and
 * deal fields. Differences from what is already saved become conflicts on the deal page.
 */
export async function handleApplicationRead(prisma: PrismaClient, job: ClaimedJob): Promise<void> {
  const { documentId } = job.payload as unknown as ApplicationReadPayload;
  const doc = await prisma.document.findUnique({
    where: { id: documentId },
    include: { deal: { select: { id: true, merchantId: true } } },
  });
  if (!doc?.deal) throw new PermanentJobError(`document ${documentId} is not on a deal`);

  const mailbox = await tenantMailbox(prisma, doc.tenantId);
  const data = await mailbox.drive.download(doc.driveFileId);
  const { data: reading } = await runApplicationReading(llmClient(prisma), {
    file: { data, fileName: doc.fileName },
    tenantId: doc.tenantId,
    dealId: doc.deal.id,
  });

  if (!reading.isApplication) {
    await prisma.document.update({
      where: { id: doc.id },
      data: { type: "OTHER", typeConfidence: reading.confidence },
    });
    return;
  }
  const conflicts = await applyApplication(
    prisma,
    { dealId: doc.deal.id, merchantId: doc.deal.merchantId },
    reading,
    "fill",
  );
  const masked = maskApplication(reading);
  await prisma.$transaction([
    prisma.document.update({
      where: { id: doc.id },
      data: {
        extraction: masked as unknown as Prisma.InputJsonObject,
        typeConfidence: reading.confidence,
      },
    }),
    prisma.deal.update({
      where: { id: doc.deal.id },
      data: {
        applicationData: {
          documentId: doc.id,
          readAt: new Date().toISOString(),
          signed: reading.signed,
          lowConfidenceFields: reading.lowConfidenceFields,
          conflicts,
        } as unknown as Prisma.InputJsonObject,
      },
    }),
    prisma.dealEvent.create({
      data: {
        dealId: doc.deal.id,
        type: "application_read",
        actorType: "ai",
        payload: { documentId: doc.id, conflicts: conflicts.length, signed: reading.signed },
      },
    }),
  ]);
}
