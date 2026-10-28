import { getPrisma } from "@mca/db";
import { READING_PLACEHOLDER } from "@/server/ascendApplication";
import { requireUser } from "@/server/auth";

export const dynamic = "force-dynamic";

const money = (v: unknown) =>
  v === null || v === undefined
    ? "—"
    : Number(v).toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });

/**
 * Applications the merchant has signed and nobody has sent to a lender yet: one click opens the
 * deal's "Ship the file" (balances message, lenders, attachments, team in CC). Below, the ones
 * still waiting for the merchant to sign.
 */
export default async function ShopPage() {
  const user = await requireUser();
  const prisma = getPrisma();
  const deals = await prisma.deal.findMany({
    where: {
      tenantId: user.tenantId,
      // Nothing sent to a lender yet.
      submissions: { none: { status: { notIn: ["DRAFT", "WITHDRAWN"] } } },
      stage: { notIn: ["FUNDED", "DECLINED", "DEAD"] },
    },
    include: {
      merchant: { select: { legalName: true, dba: true } },
      signatures: { select: { signedAt: true }, orderBy: { signedAt: "desc" }, take: 1 },
      webApplications: { select: { id: true }, take: 1 },
      documents: {
        select: {
          type: true,
          internalOnly: true,
          uploadedVia: true,
          watermarked: true,
          createdAt: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  const signedApplication = (d: (typeof deals)[number]) =>
    d.documents.find(
      (doc) => doc.type === "APPLICATION" && !doc.internalOnly && doc.uploadedVia !== "generated",
    );
  const ready = deals.filter((d) => signedApplication(d));
  const waiting = deals.filter((d) => !signedApplication(d) && d.webApplications.length > 0);
  const name = (d: (typeof deals)[number]) =>
    d.merchant.legalName === READING_PLACEHOLDER
      ? "New application (reading…)"
      : (d.merchant.dba ?? d.merchant.legalName);
  const statements = (d: (typeof deals)[number]) =>
    d.documents.filter((doc) => doc.type === "BANK_STATEMENT" && !doc.internalOnly).length;
  const watermarked = (d: (typeof deals)[number]) => d.documents.some((doc) => doc.watermarked);

  return (
    <>
      <header className="page-head">
        <h1>Ready to shop</h1>
        <p className="muted">
          Signed applications not sent to any lender yet. Open one to write the balances, pick the
          lenders and send: the signed application and the newest statements are attached, and the
          team is in CC.
        </p>
      </header>

      <section className="panel">
        <h2>Signed — ready to send ({ready.length})</h2>
        {ready.length === 0 ? (
          <p className="empty">Nothing waiting. Signed applications show up here.</p>
        ) : (
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Amount</th>
                  <th>Signed</th>
                  <th>Statements</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ready.map((d) => {
                  const signedAt = d.signatures[0]?.signedAt ?? signedApplication(d)!.createdAt;
                  return (
                    <tr key={d.id}>
                      <td>
                        <a href={`/deals/${d.id}`}>{name(d)}</a>
                      </td>
                      <td>{money(d.requestedAmount)}</td>
                      <td>{signedAt.toLocaleDateString("en-US")}</td>
                      <td>
                        {statements(d)}
                        {statements(d) === 0 ? <span className="small warn"> none</span> : null}
                        {watermarked(d) ? <span className="small error"> watermark!</span> : null}
                      </td>
                      <td>
                        <a className="button primary" href={`/deals/${d.id}?shop=1#ship`}>
                          Shop this file →
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Waiting for the merchant to sign ({waiting.length})</h2>
        {waiting.length === 0 ? (
          <p className="empty">None.</p>
        ) : (
          <ul>
            {waiting.map((d) => (
              <li key={d.id}>
                <a href={`/deals/${d.id}`}>{name(d)}</a>{" "}
                <span className="small muted">
                  · {money(d.requestedAmount)} · started {d.createdAt.toLocaleDateString("en-US")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
