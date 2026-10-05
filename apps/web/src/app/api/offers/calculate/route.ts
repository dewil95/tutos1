import { computeOffer, type OfferInput } from "@mca/domain";

/**
 * Offer calculator used by the deal screen. Pure domain math, no AI, no DB.
 * POST { advanceAmount, buyRate, sellRate, frequency, termMonths | numberOfPayments, fees... }
 */
export async function POST(req: Request) {
  let body: Partial<OfferInput>;
  try {
    body = (await req.json()) as Partial<OfferInput>;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    const terms = computeOffer(body as OfferInput);
    return Response.json(terms);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 422 },
    );
  }
}
