import { runFunderReplyParsing, type FunderReply } from "@mca/ai";
import type { ClaimedJob, DealStage, Prisma, PrismaClient, SubmissionStatus } from "@mca/db";
import { llmClient } from "../ai";
import { PermanentJobError } from "./errors";

export interface ParseReplyPayload {
  activityId: string;
  submissionId: string;
}

/** Lender reply intent → submission status. null = leave the status as is. */
export function statusForIntent(
  intent: FunderReply["intent"],
  current: SubmissionStatus,
): SubmissionStatus | null {
  switch (intent) {
    case "ACKNOWLEDGED":
      return current === "SENT" ? "ACKNOWLEDGED" : null;
    case "IN_REVIEW":
      return current === "SENT" || current === "ACKNOWLEDGED" ? "IN_REVIEW" : null;
    case "DECLINED":
      return "DECLINED";
    case "APPROVED":
    case "OFFER_REVISED":
    case "CONTRACT_SENT":
    case "CONTRACT_SIGNED":
    case "FUNDING_CALL":
    case "FUNDED":
      return "APPROVED";
    case "STIP_REQUEST":
      return current === "APPROVED" ? null : "STIPS_REQUESTED";
    default:
      return null;
  }
}

const STAGE_ORDER: DealStage[] = [
  "INTAKE",
  "DOCS_REQUESTED",
  "DOCS_RECEIVED",
  "PRE_UNDERWRITING",
  "READY_TO_SUBMIT",
  "SUBMITTED",
  "OFFERS_RECEIVED",
  "OFFER_ACCEPTED",
  "STIPS",
  "CONTRACT_OUT",
  "FUNDED",
];

/** Moves the deal forward only (a late "file received" never pulls a funded deal back). */
export function advanceStage(current: DealStage, intent: FunderReply["intent"]): DealStage | null {
  const target: Partial<Record<FunderReply["intent"], DealStage>> = {
    APPROVED: "OFFERS_RECEIVED",
    OFFER_REVISED: "OFFERS_RECEIVED",
    CONTRACT_SENT: "CONTRACT_OUT",
    CONTRACT_SIGNED: "CONTRACT_OUT",
    FUNDING_CALL: "CONTRACT_OUT",
    FUNDED: "FUNDED",
  };
  const t = target[intent];
  if (!t) return null;
  const ci = STAGE_ORDER.indexOf(current);
  if (ci === -1) return null; // DECLINED / DEAD / RENEWAL_ELIGIBLE stay as set by a human
  return STAGE_ORDER.indexOf(t) > ci ? t : null;
}

/**
 * Runs A8 (Gemini Flash by default) on one lender email and applies the result. Offer numbers
 * are stored on the activity for a human to confirm on the deal page; they do not become Offer
 * rows automatically.
 */
export async function handleParseReply(prisma: PrismaClient, job: ClaimedJob): Promise<void> {
  const { activityId, submissionId } = job.payload as unknown as ParseReplyPayload;
  const [activity, sub] = await Promise.all([
    prisma.activity.findUnique({ where: { id: activityId } }),
    prisma.submission.findUnique({
      where: { id: submissionId },
      include: { funder: true, deal: true },
    }),
  ]);
  if (!activity || !sub) throw new PermanentJobError("activity or submission not found");
  if (activity.aiSummary) return; // already parsed

  const { data } = await runFunderReplyParsing(llmClient(prisma), {
    subject: activity.subject ?? "",
    from: activity.fromAddress ?? "",
    body: activity.body ?? "",
    knownFunderName: sub.funder.name,
    tenantId: activity.tenantId,
    dealId: sub.dealId,
  });

  const now = new Date();
  const status = statusForIntent(data.intent, sub.status);
  const stage = advanceStage(sub.deal.stage, data.intent);
  const log = [
    ...((sub.rawStatusLog as Prisma.JsonArray | null) ?? []),
    { at: now.toISOString(), intent: data.intent, summary: data.summary, activityId },
  ] as Prisma.InputJsonArray;

  await prisma.$transaction(async (tx) => {
    await tx.activity.update({
      where: { id: activityId },
      data: { aiSummary: data as unknown as Prisma.InputJsonObject },
    });
    await tx.submission.update({
      where: { id: sub.id },
      data: {
        ...(status ? { status } : {}),
        ...(data.intent === "DECLINED"
          ? {
              declineReason:
                data.declineReasons.join("; ") || data.declineCategory || "No reason given",
            }
          : {}),
        rawStatusLog: log,
      },
    });
    if (stage) {
      await tx.deal.update({ where: { id: sub.dealId }, data: { stage, stageChangedAt: now } });
    }
    if (data.intent === "STIP_REQUEST") {
      for (const name of data.stips) {
        await tx.stipulation.create({
          data: {
            dealId: sub.dealId,
            name: name.slice(0, 300),
            notes: `Requested by ${sub.funder.name}`,
          },
        });
      }
    }
    if (data.intent === "FUNDED" && data.funded.commissionAmount !== null) {
      const days = data.funded.clawbackDays ?? sub.funder.clawbackDays;
      await tx.commission.create({
        data: {
          tenantId: activity.tenantId,
          dealId: sub.dealId,
          funderName: sub.funder.name,
          points: 0,
          expectedAmount: data.funded.commissionAmount,
          status: "EXPECTED",
          clawbackWindowEndsAt: days ? new Date(now.getTime() + days * 86_400_000) : null,
          notes: data.funded.requiresConfirmationReply
            ? "Lender requires a reply confirming the clawback policy before paying commission."
            : null,
        },
      });
    }
    await tx.dealEvent.create({
      data: {
        dealId: sub.dealId,
        type: `funder_${data.intent.toLowerCase()}`,
        actorType: "ai",
        payload: {
          submissionId: sub.id,
          funder: sub.funder.name,
          summary: data.summary,
          activityId,
        },
      },
    });
  });
}
