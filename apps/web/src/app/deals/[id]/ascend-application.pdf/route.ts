import { getPrisma } from "@mca/db";
import { renderDealApplication } from "@/server/ascendApplication";
import { userOrResponse } from "@/server/auth";

export const dynamic = "force-dynamic";

/**
 * Ascend's application for this deal, filled from the CRM and not signed yet. It carries the
 * full SSN and date of birth (lenders need them), so it is never cached and every download is
 * recorded on the deal timeline.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await userOrResponse();
  if (user instanceof Response) return user;
  const { id } = await params;
  const prisma = getPrisma();
  const pdf = await renderDealApplication(prisma, user.tenantId, id);
  if (!pdf) return Response.json({ error: "deal not found" }, { status: 404 });
  await prisma.dealEvent.create({
    data: {
      dealId: id,
      type: "application_downloaded",
      actorType: "user",
      actorId: user.id,
      payload: { fileName: pdf.fileName },
    },
  });
  return new Response(new Uint8Array(pdf.data), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${pdf.fileName.replace(/[^\x20-\x7E]|"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(pdf.fileName)}`,
      "cache-control": "no-store",
    },
  });
}
