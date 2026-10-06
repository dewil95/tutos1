import { getPrisma } from "@mca/db";
import { apiError, authenticateApi } from "@/server/apiKeys";

export const dynamic = "force-dynamic";

/**
 * Status for the website's "track your application" page. Lender names are not exposed; the
 * merchant only sees how many lenders are reviewing and whether offers arrived.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const prisma = getPrisma();
  const caller = await authenticateApi(prisma, req);
  if (caller instanceof Response) return caller;
  const { id } = await params;
  const deal = await prisma.deal.findFirst({
    where: { tenantId: caller.tenantId, OR: [{ id }, { externalRef: id }] },
    include: { submissions: { select: { status: true } }, documents: { select: { type: true } } },
  });
  if (!deal) return apiError(404, "deal not found");
  const count = (st: string[]) => deal.submissions.filter((s) => st.includes(s.status)).length;
  return Response.json({
    dealId: deal.id,
    externalId: deal.externalRef,
    stage: deal.stage,
    documents: {
      application: deal.documents.some((d) => d.type === "APPLICATION"),
      bankStatements: deal.documents.filter((d) => d.type === "BANK_STATEMENT").length,
    },
    lenders: {
      reviewing: count(["SENT", "ACKNOWLEDGED", "IN_REVIEW", "STIPS_REQUESTED"]),
      approved: count(["APPROVED"]),
      declined: count(["DECLINED"]),
    },
    updatedAt: deal.updatedAt,
  });
}
