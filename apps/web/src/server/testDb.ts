import { useTestDatabase } from "@mca/db/testing";

/**
 * Starts a local Cloudflare D1 (Miniflare) with every migration applied and makes it the
 * app's database. Always available, so database tests always run (in CI too).
 */
export async function databaseReady(): Promise<boolean> {
  await useTestDatabase();
  return true;
}
