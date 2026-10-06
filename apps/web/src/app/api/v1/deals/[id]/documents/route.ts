import { getPrisma } from "@mca/db";
import { after } from "next/server";
import { z } from "zod";
import { apiError, authenticateApi } from "@/server/apiKeys";
import { runDueJobs } from "@/server/jobs/runner";
import { ApiInputError, decodeFiles, FileUploadSchema, storeApiFiles } from "@/server/websiteApi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ files: z.array(FileUploadSchema).min(1).max(8) });

/** Adds files (e.g. statements uploaded later on the website) to an existing deal. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const prisma = getPrisma();
  const caller = await authenticateApi(prisma, req);
  if (caller instanceof Response) return caller;
  const { id } = await params;
  const deal = await prisma.deal.findFirst({
    where: { tenantId: caller.tenantId, OR: [{ id }, { externalRef: id }] },
  });
  if (!deal) return apiError(404, "deal not found");

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return apiError(400, "body must be JSON");
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return apiError(
      422,
      "invalid files",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  try {
    const docs = await storeApiFiles(
      prisma,
      caller.tenantId,
      deal,
      decodeFiles(parsed.data.files),
      {
        readApplication: true,
      },
    );
    if (deal.stage === "DOCS_REQUESTED" && docs.some((d) => d.type === "BANK_STATEMENT")) {
      await prisma.deal.update({
        where: { id: deal.id },
        data: { stage: "DOCS_RECEIVED", stageChangedAt: new Date() },
      });
    }
    after(() => runDueJobs(prisma, { budgetMs: 45_000 }).then(() => undefined));
    return Response.json(
      { documents: docs.map((d) => ({ id: d.id, fileName: d.fileName, type: d.type })) },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ApiInputError) return apiError(err.status, err.message);
    console.error("[api/v1/documents]", err);
    return apiError(500, "could not save the files");
  }
}
