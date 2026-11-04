import type { PrismaClient } from "@mca/db";

/** Lender emails a person sends from the deal page. Nothing is sent automatically. */
export type RuleKind = "CONTRACT_REQUEST" | "CLAWBACK_CONFIRM";

export interface RuleDefaults {
  kind: RuleKind;
  label: string;
  /** Who receives it and when, shown in Settings. */
  description: string;
  enabled: boolean;
  delayHours: number;
  maxSends: number;
  /** Always true: a person clicks send on the deal page. */
  requiresApproval: boolean;
  subject: string;
  body: string;
}

export const DEFAULT_RULES: RuleDefaults[] = [
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
