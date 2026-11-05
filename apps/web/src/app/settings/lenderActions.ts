"use server";

import { getPrisma, syncFunders } from "@mca/db";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";

/**
 * Brings the lender directory up to date with the roster bundled in the app
 * (docs/funder-appetite-matrix.csv): addresses, minimums, states, positions, industries.
 * Adds lenders that are new on the roster; never deletes one.
 */
export async function updateLendersFromRoster() {
  const user = await requireUser();
  if (user.role !== "ADMIN" && user.role !== "MANAGER") redirect("/settings");
  const r = await syncFunders(getPrisma(), user.tenantId);
  redirect(
    `/settings?${new URLSearchParams({
      lenders: `Lenders updated from the roster: ${r.added} added, ${r.updated} updated.`,
    })}`,
  );
}
