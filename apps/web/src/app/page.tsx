import { getPrisma, type DealStage } from "@mca/db";

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

async function loadDeals(): Promise<{ deals: BoardDeal[]; error: string | null }> {
  try {
    const prisma = getPrisma();
    const rows = await prisma.deal.findMany({
      where: { stage: { in: STAGES } },
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
  const { deals, error } = await loadDeals();
  return (
    <>
      <h1 style={{ fontSize: 20, margin: "4px 0 12px" }}>Deal board</h1>
      {error ? (
        <p className="empty">
          Database not reachable ({error}). Start infra with{" "}
          <code>docker compose -f infra/docker-compose.yml up</code> and run{" "}
          <code>pnpm db:migrate</code>.
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
                <article className="card" key={d.id}>
                  <div>{d.merchantName}</div>
                  <div className="meta">
                    {d.requestedAmount
                      ? `$${d.requestedAmount.toLocaleString("en-US")}`
                      : "amount tbd"}
                    {d.paperGrade ? ` · grade ${d.paperGrade}` : ""}
                    {d.ownerName ? ` · ${d.ownerName}` : ""}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
