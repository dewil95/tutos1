import { getPrisma } from "@mca/db";
import { findWebApplication, merchantCopy } from "@/server/webApplication";

export const dynamic = "force-dynamic";

/** The merchant's copy of what they signed (SSN and date of birth masked). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const prisma = getPrisma();
  const row = await findWebApplication(prisma, token);
  const copy = row ? await merchantCopy(prisma, row) : null;
  if (!copy) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(copy.data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${copy.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
