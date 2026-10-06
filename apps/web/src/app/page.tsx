import { getPrisma, type DealStage } from "@mca/db";
import { requireUser } from "@/server/auth";

export const dynamic = "force-dynamic";

const STAGES: DealStage[] = [
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

interface BoardDeal {
  id: string;
  stage: DealStage;
  paperGrade: string | null;
  requestedAmount: number | null;
  merchantName: string;
  ownerName: string | null;
  updatedAt: Date;
}

async function loadDeals(tenantId: string): Promise<{ deals: BoardDeal[]; error: string | null }> {
  try {
    const prisma = getPrisma();
    const rows = await prisma.deal.findMany({
      where: { tenantId, stage: { in: STAGES } },
      include: {
        merchant: { select: { legalName: true, dba: true } },
        owner: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 200,
    });
    return {
      deals: rows.map((d) => ({
        id: d.id,
        stage: d.stage,
        paperGrade: d.paperGrade,
        requestedAmount: d.requestedAmount ? Number(d.requestedAmount) : null,
        merchantName: d.merchant.dba ?? d.merchant.legalName,
        ownerName: d.owner?.name ?? null,
        updatedAt: d.updatedAt,
      })),
      error: null,
    };
  } catch (err) {
    return { deals: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function DealBoardPage() {
  const user = await requireUser();
  const { deals, error } = await loadDeals(user.tenantId);
  return (
    <>
      <h1 style={{ fontSize: 20, margin: "4px 0 12px" }}>Deal board</h1>
      {error ? (
        <p className="empty">
          Database not reachable ({error}). Check DATABASE_URL and run <code>pnpm db:migrate</code>{" "}
          (see README).
        </p>
      ) : null}
      <div className="board">
        {STAGES.map((stage) => {
          const inStage = deals.filter((d) => d.stage === stage);
          return (
            <section className="column" key={stage}>
              <h3>
                {stage.replace(/_/g, " ").toLowerCase()} ({inStage.length})
              </h3>
              {inStage.length === 0 ? <p className="empty">—</p> : null}
              {inStage.map((d) => (
                <a className="card" key={d.id} href={`/deals/${d.id}`}>
                  <div>{d.merchantName}</div>
                  <div className="meta">
                    {d.requestedAmount
                      ? `$${d.requestedAmount.toLocaleString("en-US")}`
                      : "amount tbd"}
                    {d.paperGrade ? ` · grade ${d.paperGrade}` : ""}
                    {d.ownerName ? ` · ${d.ownerName}` : ""}
                  </div>
                </a>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
