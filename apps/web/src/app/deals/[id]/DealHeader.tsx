import type { DealStage } from "@mca/db";

const STEPS: { label: string; stages: DealStage[] }[] = [
  { label: "Documents", stages: ["INTAKE", "DOCS_REQUESTED"] },
  { label: "Scrub", stages: ["DOCS_RECEIVED", "PRE_UNDERWRITING"] },
  { label: "Submitted", stages: ["READY_TO_SUBMIT", "SUBMITTED"] },
  { label: "Offers", stages: ["OFFERS_RECEIVED"] },
  { label: "Contract", stages: ["OFFER_ACCEPTED", "STIPS", "CONTRACT_OUT"] },
  { label: "Funded", stages: ["FUNDED", "RENEWAL_ELIGIBLE"] },
];

const SECTIONS = [
  ["merchant", "Merchant"],
  ["whatsapp", "WhatsApp"],
  ["lenders", "Lender status"],
  ["ship", "Ship the file"],
  ["files", "Files"],
  ["scrub", "Bank scrub"],
  ["risk", "Risk report"],
  ["timeline", "Timeline"],
] as const;

export interface DealHeaderProps {
  name: string;
  legalName: string;
  stage: DealStage;
  grade: string | null;
  requested: number | null;
  state: string | null;
  ownerName: string | null;
  source: string;
  driveFolderId: string | null;
}

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** Where the deal is (stage stepper), the facts a closer asks first, and jump links. */
export function DealHeader(p: DealHeaderProps) {
  const closed = p.stage === "DECLINED" || p.stage === "DEAD";
  const current = STEPS.findIndex((s) => s.stages.includes(p.stage));
  return (
    <>
      <header className="deal-head">
        <div className="deal-title">
          <div>
            <p className="crumbs">
              <a href="/">Deals</a> / {p.name}
            </p>
            <h1>{p.name}</h1>
            {p.legalName !== p.name ? <div className="small muted">{p.legalName}</div> : null}
            <div className="facts">
              <span>
                Requested <b>{p.requested ? money(p.requested) : "—"}</b>
              </span>
              <span>
                Grade {p.grade ? <span className={`grade ${p.grade}`}>{p.grade}</span> : <b>—</b>}
              </span>
              {p.state ? (
                <span>
                  State <b>{p.state}</b>
                </span>
              ) : null}
              <span>
                Source <b>{p.source}</b>
              </span>
              {p.ownerName ? (
                <span>
                  Rep <b>{p.ownerName}</b>
                </span>
              ) : null}
            </div>
          </div>
          {p.driveFolderId ? (
            <a
              className="button"
              href={`https://drive.google.com/drive/folders/${p.driveFolderId}`}
              target="_blank"
              rel="noreferrer"
            >
              Open Drive folder
            </a>
          ) : null}
        </div>
        <ol className={`stepper ${closed ? "closed" : ""}`} aria-label="Deal stage">
          {STEPS.map((s, i) => (
            <li
              key={s.label}
              className={i < current ? "done" : i === current ? "current" : ""}
              aria-current={i === current ? "step" : undefined}
            >
              {closed && i === Math.max(0, current) ? p.stage.toLowerCase() : s.label}
            </li>
          ))}
        </ol>
      </header>
      <nav className="subnav" aria-label="Deal sections">
        {SECTIONS.filter(([id]) => id !== "whatsapp" || p.source === "whatsapp").map(
          ([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ),
        )}
      </nav>
    </>
  );
}
