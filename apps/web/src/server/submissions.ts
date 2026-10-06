import { newWatermarkTag, planSubmissions, type PositionLine } from "@mca/connectors";
import { enqueueJob, type PrismaClient } from "@mca/db";

/**
 * "Mazal: $12,500" / "Fundzilla 8000" / "Unknown lender" → position lines for the email body.
 * One per line; the balance is optional.
 */
export function parsePositions(text: string): PositionLine[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(.*?)[\s:–-]*\$?\s*([\d,]+(?:\.\d+)?)\s*([kK])?\s*$/.exec(line);
      if (!m || !m[1]!.trim()) return { funder: line.replace(/[:\s]+$/, ""), balance: null };
      const n = Number(m[2]!.replace(/,/g, "")) * (m[3] ? 1000 : 1);
      return { funder: m[1]!.trim(), balance: Number.isFinite(n) ? n : null };
    });
}

export function positionsToText(lines: PositionLine[]): string {
  return lines
    .map((p) =>
      p.balance === null ? p.funder : `${p.funder}: $${p.balance.toLocaleString("en-US")}`,
    )
    .join("\n");
}

export interface SendRequest {
  tenantId: string;
  userId: string;
  dealId: string;
  funderIds: string[];
  documentIds: string[];
  positions: PositionLine[];
  note: string | null;
}

export interface SendPlan {
  submissionIds: string[];
  jobIds: string[];
  skipped: { funderName: string; reason: string }[];
}

/**
 * Turns one click into one queued email per lender. Validates everything first (recipients,
 * files, duplicates) so nothing is queued when any selected lender is misconfigured.
 */
export async function queueSubmissions(prisma: PrismaClient, req: SendRequest): Promise<SendPlan> {
  if (req.funderIds.length === 0) throw new Error("Pick at least one lender.");
  if (req.documentIds.length === 0) throw new Error("Pick at least one file to send.");

  const [tenant, deal] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: req.tenantId } }),
    prisma.deal.findFirst({ where: { id: req.dealId, tenantId: req.tenantId } }),
  ]);
  if (!deal) throw new Error("Deal not found.");

  const docs = await prisma.document.findMany({
    where: { id: { in: req.documentIds }, dealId: deal.id },
    select: { id: true, internalOnly: true },
  });
  // The Risk Report and other team-only files can never go to a lender.
  if (docs.some((d) => d.internalOnly))
    throw new Error("Internal files cannot be sent to lenders.");
  if (docs.length !== new Set(req.documentIds).size)
    throw new Error("Some files are not on this deal.");

  const funders = await prisma.funder.findMany({
    where: { id: { in: req.funderIds }, tenantId: req.tenantId, isActive: true },
  });
  // Backdoor/duplicate guard: a lender sees a merchant once, across all of the merchant's deals.
  const previous = await prisma.submission.findMany({
    where: {
      funderId: { in: funders.map((f) => f.id) },
      deal: { merchantId: deal.merchantId },
      status: { notIn: ["WITHDRAWN"] },
    },
    select: { funderId: true, status: true },
  });
  const skipped: SendPlan["skipped"] = [];
  const targets = funders.filter((f) => {
    const dup = previous.find((p) => p.funderId === f.id);
    if (dup)
      skipped.push({
        funderName: f.name,
        reason: `already submitted (${dup.status.toLowerCase()})`,
      });
    return !dup;
  });
  for (const id of req.funderIds) {
    if (!funders.some((f) => f.id === id))
      skipped.push({ funderName: id, reason: "lender not active" });
  }

  const plans = planSubmissions(
    targets.map((f) => ({
      funderId: f.id,
      funderName: f.name,
      emails: [f.submissionTo, ...f.submissionCc].filter((e): e is string => !!e),
    })),
    { teamCc: tenant.teamCc, from: tenant.fromAddress ?? undefined },
  );

  const submissionIds: string[] = [];
  const jobIds: string[] = [];
  await prisma.deal.update({
    where: { id: deal.id },
    data: {
      submissionPositions: req.positions as unknown as object[],
      submissionNote: req.note,
      ...([
        "INTAKE",
        "DOCS_REQUESTED",
        "DOCS_RECEIVED",
        "PRE_UNDERWRITING",
        "READY_TO_SUBMIT",
      ].includes(deal.stage)
        ? { stage: "SUBMITTED", stageChangedAt: new Date() }
        : {}),
    },
  });
  for (const p of plans) {
    const sub = await prisma.submission.create({
      data: {
        dealId: deal.id,
        funderId: p.funderId,
        channel: "EMAIL",
        status: "DRAFT",
        sentById: req.userId,
        toAddresses: p.recipients.to,
        ccAddresses: p.recipients.cc,
        packageDocumentIds: req.documentIds,
        watermarkTag: newWatermarkTag(),
      },
    });
    submissionIds.push(sub.id);
    jobIds.push(
      await enqueueJob(prisma, {
        tenantId: req.tenantId,
        type: "SEND_SUBMISSION",
        payload: { submissionId: sub.id },
        dedupeKey: `send:${sub.id}`,
      }),
    );
  }
  return { submissionIds, jobIds, skipped };
}
