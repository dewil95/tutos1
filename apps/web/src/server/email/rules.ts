import type { PrismaClient } from "@mca/db";

export type RuleKind =
  "MISSING_DOCS" | "STIP_CHASE" | "LENDER_FOLLOW_UP" | "CONTRACT_REQUEST" | "CLAWBACK_CONFIRM";

export interface RuleDefaults {
  kind: RuleKind;
  label: string;
  /** Who receives it and when, shown in Settings. */
  description: string;
  enabled: boolean;
  delayHours: number;
  maxSends: number;
  /** true = a person clicks send on the deal page (draft); false = sent by the cron tick. */
  requiresApproval: boolean;
  subject: string;
  body: string;
}

export const DEFAULT_RULES: RuleDefaults[] = [
  {
    kind: "MISSING_DOCS",
    label: "Missing documents (to merchant)",
    description:
      "Deal waiting on documents: asks the merchant for what is missing, up to 3 times, a day apart.",
    enabled: true,
    delayHours: 24,
    maxSends: 3,
    requiresApproval: false,
    subject: "Documents needed for your funding request - {{business}}",
    body: "Hi {{contact}},\n\nTo move your funding request forward we still need:\n{{missing}}\n\nYou can reply to this email with the files attached.\n\nThank you,\n{{broker}}",
  },
  {
    kind: "STIP_CHASE",
    label: "Stip chase (to merchant)",
    description:
      "Lender asked for something (stip): asks the merchant, up to 3 times, a day apart.",
    enabled: true,
    delayHours: 24,
    maxSends: 3,
    requiresApproval: false,
    subject: "Items needed to finish your approval - {{business}}",
    body: "Hi {{contact}},\n\nThe funder needs the following to finish your file:\n{{stips}}\n\nPlease reply to this email with them as soon as you can.\n\nThank you,\n{{broker}}",
  },
  {
    kind: "LENDER_FOLLOW_UP",
    label: "Lender follow-up (in the lender's thread)",
    description:
      "No reply from a lender a day after sending: one follow-up in the same thread, same To/CC. Weekdays only.",
    enabled: true,
    delayHours: 24,
    maxSends: 1,
    requiresApproval: false,
    subject: "Re: New Deal Submission - {{business}}",
    body: "Hello,\n\nFollowing up on {{business}}. Any update on this file?\n\nThank you.",
  },
  {
    kind: "CONTRACT_REQUEST",
    label: "Contract request (to lender, you click send)",
    description:
      "From an approved lender row: asks for contracts with amount, factor and term, DL/VC attached.",
    enabled: true,
    delayHours: 0,
    maxSends: 1,
    requiresApproval: true,
    subject: "Re: New Deal Submission - {{business}}",
    body: "Hello,\n\nPlease send contracts for {{amount}} at {{factor}} for {{term}} to {{merchantEmail}}.\nSee attached DL/VC.\n\nThank you.",
  },
  {
    kind: "CLAWBACK_CONFIRM",
    label: "Clawback confirmation (to lender, you click send)",
    description:
      "Funded email asks the ISO to confirm the clawback policy: one-click reply in the thread.",
    enabled: true,
    delayHours: 0,
    maxSends: 1,
    requiresApproval: true,
    subject: "Re: {{subject}}",
    body: "Hello,\n\nConfirmed. We acknowledge the clawback policy for {{business}}.\n\nThank you.",
  },
];

/** {{name}} placeholders; unknown names render empty so a typo never leaks braces to a lender. */
export function renderTemplate(
  tpl: string,
  vars: Record<string, string | null | undefined>,
): string {
  return tpl
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "")
    .replace(/\n{3,}/g, "\n\n");
}

/** Creates any missing rules with their defaults; never overwrites what a person edited. */
export async function ensureRules(prisma: PrismaClient, tenantId: string) {
  const existing = await prisma.emailRule.findMany({ where: { tenantId } });
  for (const d of DEFAULT_RULES) {
    if (existing.some((r) => r.kind === d.kind)) continue;
    await prisma.emailRule.create({
      data: {
        tenantId,
        kind: d.kind,
        enabled: d.enabled,
        delayHours: d.delayHours,
        maxSends: d.maxSends,
        requiresApproval: d.requiresApproval,
        subject: d.subject,
        body: d.body,
      },
    });
  }
  return prisma.emailRule.findMany({ where: { tenantId } });
}

/** Weekend in New York (lender follow-ups wait for Monday). */
export function isWeekendNY(now: Date): boolean {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
  }).format(now);
  return day === "Sat" || day === "Sun";
}
