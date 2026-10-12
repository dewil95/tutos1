import { maskApplication, runApplicationReading, type ApplicationReading } from "@mca/ai";
import { imagesToPdf } from "@mca/connectors";
import { encryptSecret, type ClaimedJob, type Prisma, type PrismaClient } from "@mca/db";
import { queueDocumentWork, storeDealFile } from "../documents";
import { requireEnv } from "../env";
import { addChatEvent, defaultDeps, type ReadResult, type WaDeps } from "./chat";
import { fieldStatesFromReading, readingToDraft } from "./questions";

export interface WhatsAppReadPayload {
  conversationId: string;
  candidates: string[];
}

export async function handleWhatsAppAppRead(prisma: PrismaClient, job: ClaimedJob): Promise<void> {
  const p = job.payload as unknown as WhatsAppReadPayload;
  const conv = await prisma.whatsAppConversation.findUnique({ where: { id: p.conversationId } });
  if (!conv) return;
  await readCandidates(prisma, defaultDeps(prisma, conv.tenantId), p);
}

/**
 * Looks for the merchant's application among the files they sent (A5, Gemini). The first one
 * that reads as an application becomes the source of the fields and is marked internal only:
 * it is another company's form, so it never goes to lenders. PDFs that are not an application
 * are treated as bank statements; photos are read together as one multi-page form.
 * The result goes back to the chat as a "read_done" event.
 */
export async function readCandidates(
  prisma: PrismaClient,
  deps: WaDeps,
  p: WhatsAppReadPayload,
): Promise<ReadResult> {
  const conv = await prisma.whatsAppConversation.findUniqueOrThrow({
    where: { id: p.conversationId },
  });
  // Files that arrived after this job was queued (more photos of the form) are included too.
  const meta = (conv.fieldState ?? {}) as { candidates?: string[]; examined?: string[] };
  const ids = [...new Set([...p.candidates, ...(meta.candidates ?? [])])].filter(
    (id) => !(meta.examined ?? []).includes(id),
  );
  const docs = (
    await prisma.document.findMany({ where: { id: { in: ids }, dealId: conv.dealId } })
  ).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  const mailbox = await deps.mailbox();
  const read = (data: Buffer, fileName: string) =>
    runApplicationReading(deps.llm(), {
      file: { data, fileName },
      tenantId: conv.tenantId,
      dealId: conv.dealId ?? undefined,
    }).then((r) => r.data);

  let found: { docId: string; reading: ApplicationReading } | null = null;
  const statements: typeof docs = [];
  for (const d of docs.filter((d) => d.mimeType === "application/pdf")) {
    if (found) {
      statements.push(d);
      continue;
    }
    const reading = await read(await mailbox.drive.download(d.driveFileId), d.fileName);
    if (reading.isApplication) found = { docId: d.id, reading };
    else statements.push(d);
  }
  const photos = docs.filter((d) => d.mimeType.startsWith("image/"));
  if (!found && photos.length) {
    const pdf = await imagesToPdf(
      await Promise.all(
        photos.map(async (d) => ({
          mimeType: d.mimeType,
          data: await mailbox.drive.download(d.driveFileId),
        })),
      ),
    );
    const reading = await read(pdf, "application-photos.pdf");
    if (reading.isApplication) {
      const combined = await storeDealFile(prisma, mailbox, {
        tenantId: conv.tenantId,
        dealId: conv.dealId!,
        merchantId: photos[0]!.merchantId,
        file: {
          fileName: `Application received on WhatsApp (${photos.length} photo${photos.length === 1 ? "" : "s"}).pdf`,
          mimeType: "application/pdf",
          data: pdf,
        },
        type: "APPLICATION",
        uploadedVia: "whatsapp",
        autoProcess: false,
      });
      await prisma.document.updateMany({
        where: { id: { in: photos.map((d) => d.id) } },
        data: { internalOnly: true },
      });
      found = { docId: combined.id, reading };
    }
  }

  for (const d of statements) {
    const s = await prisma.document.update({
      where: { id: d.id },
      data: { type: "BANK_STATEMENT" },
    });
    await queueDocumentWork(prisma, s);
  }

  const result: ReadResult = { examined: docs.map((d) => d.id), sourceDocId: null };
  if (found) {
    const { draft, pii } = readingToDraft(found.reading);
    const fields = fieldStatesFromReading(draft, found.reading.lowConfidenceFields);
    // An SSN or birth date the reader was unsure of is asked again on the private page.
    const unsure = (i: number, k: string) =>
      found!.reading.lowConfidenceFields.some((f) => f.startsWith(`owners.${i}.${k}`));
    const safePii = pii.map((o, i) => ({
      ssn: unsure(i, "ssn") ? null : o.ssn,
      dob: unsure(i, "dob") ? null : o.dob,
    }));
    await prisma.document.update({
      where: { id: found.docId },
      data: {
        type: "APPLICATION",
        internalOnly: true,
        typeConfidence: found.reading.confidence,
        extraction: maskApplication(found.reading) as unknown as Prisma.InputJsonObject,
      },
    });
    if (conv.dealId) {
      await prisma.dealEvent.create({
        data: {
          dealId: conv.dealId,
          type: "application_read",
          actorType: "ai",
          payload: { documentId: found.docId, channel: "whatsapp", internalOnly: true },
        },
      });
    }
    Object.assign(result, {
      sourceDocId: found.docId,
      draft,
      fields,
      pii: safePii.some((o) => o.ssn || o.dob)
        ? encryptSecret(JSON.stringify(safePii), requireEnv("PII_ENCRYPTION_KEY"))
        : null,
    });
  }
  await addChatEvent(prisma, conv, "read_done", JSON.stringify(result));
  return result;
}
