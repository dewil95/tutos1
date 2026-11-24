import { getPrisma, type DealStage } from "@mca/db";
import { requireUser } from "@/server/auth";
import { READING_PLACEHOLDER } from "@/server/ascendApplication";

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
  createdAt: Date;
  lostReason: string | null;
  /** WhatsApp application chat state, if the deal came in on WhatsApp. */
  whatsapp: string | null;
}

const CLOSED: DealStage[] = ["DEAD", "DECLINED"];
/** A nameless "reading…" deal older than this did not get read: say so on the card. */
const READING_STALE_MS = 15 * 60_000;

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

async function loadDeals(
  tenantId: string,
  stages: DealStage[],
): Promise<{ deals: BoardDeal[]; error: string | null }> {
  try {
    const prisma = getPrisma();
    const rows = await prisma.deal.findMany({
      where: { tenantId, stage: { in: stages } },
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
        createdAt: d.createdAt,
        lostReason: d.lostReason,
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

const money = (n: number) => `${Math.round(n).toLocaleString("en-US")}`;

/** Deals taken off the board (dead or declined), newest first, each one a click away. */
async function ClosedDeals({ tenantId }: { tenantId: string }) {
  const { deals, error } = await loadDeals(tenantId, CLOSED);
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Closed deals</h1>
          <p>{deals.length} dead or declined · open one to reopen it</p>
        </div>
        <a className="button" href="/">
          Back to the board
        </a>
      </header>
      {error ? <p className="notice error">{error}</p> : null}
      {deals.length === 0 ? <p className="empty">No closed deals.</p> : null}
      {deals.length ? (
        <div className="tablewrap">
          <table className="grid">
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Requested</th>
                <th>Closed as</th>
                <th>Reason</th>
                <th>Rep</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id}>
                  <td>
                    <a href={`/deals/${d.id}`}>{d.merchantName}</a>
                  </td>
                  <td className="num">{d.requestedAmount ? money(d.requestedAmount) : "—"}</td>
                  <td>{d.stage === "DEAD" ? "Dead" : "Declined"}</td>
                  <td className="small">{d.lostReason ?? "—"}</td>
                  <td className="small">{d.ownerName ?? ""}</td>
                  <td className="small when">{daysIn(d.stageChangedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}

function daysIn(d: Date): string {
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  return days <= 0 ? "today" : `${days}d`;
}

export default async function DealBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string }>;
}) {
  const user = await requireUser();
  const { show } = await searchParams;
  if (show === "closed") return <ClosedDeals tenantId={user.tenantId} />;
  const { deals, error } = await loadDeals(user.tenantId, STAGES);
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
        <span className="row">
          <a className="small muted" href="/?show=closed">
            Closed deals
          </a>
          <a className="button primary" href="/deals/new">
            New deal
          </a>
        </span>
      </header>
      {error ? (
        <p className="notice error">
          Database not reachable ({error}). On the server, run{" "}
          <code>sudo bash /opt/ascend-crm/deploy/oracle/update.sh</code> (see README).
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
                  {d.merchantName === READING_PLACEHOLDER &&
                  Date.now() - d.createdAt.getTime() > READING_STALE_MS ? (
                    <span className="tag attention">Application not read · open to retry</span>
                  ) : null}
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
