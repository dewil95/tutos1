import { getPrisma } from "@mca/db";
import { after } from "next/server";
import { apiError, authenticateApi } from "@/server/apiKeys";
import { runDueJobs } from "@/server/jobs/runner";
import { ApiInputError, ApplicationPayloadSchema, ingestApplication } from "@/server/websiteApi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Ascend's website posts each completed application here. See docs/API.md. */
export async function POST(req: Request) {
  const prisma = getPrisma();
  const caller = await authenticateApi(prisma, req);
  if (caller instanceof Response) return caller;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "body must be JSON");
  }
  const parsed = ApplicationPayloadSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      422,
      "invalid application",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  try {
    const { deal, created, documents } = await ingestApplication(
      prisma,
      caller.tenantId,
      parsed.data,
    );
    if (created) after(() => runDueJobs(prisma, { budgetMs: 45_000 }).then(() => undefined));
    return Response.json(
      {
        dealId: deal.id,
        externalId: deal.externalRef,
        created,
        stage: deal.stage,
        documents: documents.map((d) => ({ id: d.id, fileName: d.fileName, type: d.type })),
      },
      { status: created ? 201 : 200 },
    );
  } catch (err) {
    if (err instanceof ApiInputError) return apiError(err.status, err.message);
    console.error("[api/v1/applications]", err);
    return apiError(500, "could not save the application");
  }
}
