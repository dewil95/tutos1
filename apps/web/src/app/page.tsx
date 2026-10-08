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
  stageChangedAt: Date;
  /** WhatsApp application chat state, if the deal came in on WhatsApp. */
  whatsapp: string | null;
}

/** Board badge for WhatsApp deals: what the chat is waiting on. */
const WA_LABEL: Record<string, string> = {
  ACTIVE: "WhatsApp · in progress",
  READING: "WhatsApp · reading",
  SECURE_FORM: "WhatsApp · in progress",
  REVIEW: "WhatsApp · reviewing",
  SIGN_NAME: "WhatsApp · signing",
  SIGN_CONFIRM: "WhatsApp · signing",
  SIGNED: "WhatsApp · signed",
  HANDOFF: "WhatsApp · needs a person",
  ABANDONED: "WhatsApp · went quiet",
};

async function loadDeals(tenantId: string): Promise<{ deals: BoardDeal[]; error: string | null }> {
  try {
    const prisma = getPrisma();
    const rows = await prisma.deal.findMany({
      where: { tenantId, stage: { in: STAGES } },
      include: {
        merchant: { select: { legalName: true, dba: true } },
        owner: { select: { name: true } },
        whatsapp: { select: { status: true } },
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
        stageChangedAt: d.stageChangedAt,
        whatsapp: d.whatsapp?.status ?? null,
      })),
      error: null,
    };
  } catch (err) {
    return { deals: [], error: err instanceof Error ? err.message : String(err) };
  }
}

const STAGE_LABEL: Partial<Record<DealStage, string>> = {
  INTAKE: "Intake",
  DOCS_REQUESTED: "Docs requested",
  DOCS_RECEIVED: "Docs received",
  PRE_UNDERWRITING: "Scrubbed",
  READY_TO_SUBMIT: "Ready to submit",
  SUBMITTED: "Submitted",
  OFFERS_RECEIVED: "Offers",
  OFFER_ACCEPTED: "Offer accepted",
  STIPS: "Stips",
  CONTRACT_OUT: "Contract out",
  FUNDED: "Funded",
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

function daysIn(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days <= 0 ? "today" : `${days}d`;
}

export default async function DealBoardPage() {
  const user = await requireUser();
  const { deals, error } = await loadDeals(user.tenantId);
  const open = deals.filter((d) => d.stage !== "FUNDED");
  const pipeline = open.reduce((a, d) => a + (d.requestedAmount ?? 0), 0);
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Deals</h1>
          <p>
            {open.length} open · {money(pipeline)} requested in the pipeline
          </p>
        </div>
        <a className="button primary" href="/deals/new">
          New deal
        </a>
      </header>
      {error ? (
        <p className="notice error">
          Database not reachable ({error}). Check DATABASE_URL and run <code>pnpm db:deploy</code>{" "}
          (see README).
        </p>
      ) : null}
      <div className="board">
        {STAGES.map((stage) => {
          const inStage = deals.filter((d) => d.stage === stage);
          return (
            <section className="column" key={stage}>
              <h3>
                {STAGE_LABEL[stage] ?? stage}
                <span className="count">{inStage.length}</span>
              </h3>
              {inStage.length === 0 ? <p className="empty">No deals</p> : null}
              {inStage.map((d) => (
                <a className="card" key={d.id} href={`/deals/${d.id}`}>
                  <span className="name">{d.merchantName}</span>
                  {d.whatsapp ? (
                    <span
                      className={`tag wa ${["HANDOFF", "ABANDONED"].includes(d.whatsapp) ? "attention" : ""}`}
                    >
                      {WA_LABEL[d.whatsapp] ?? "WhatsApp"}
                    </span>
                  ) : null}
                  <span className="amount">
                    {d.requestedAmount ? (
                      money(d.requestedAmount)
                    ) : (
                      <span className="faint">amount tbd</span>
                    )}
                  </span>
                  <span className="meta">
                    <span>
                      {d.paperGrade ? (
                        <span className={`grade ${d.paperGrade}`}>{d.paperGrade}</span>
                      ) : null}{" "}
                      {d.ownerName ?? ""}
                    </span>
                    <span className="faint" title="Time in this stage">
                      {daysIn(d.stageChangedAt)}
                    </span>
                  </span>
                </a>
              ))}
            </section>
          );
        })}
      </div>
    </>
  );
}
