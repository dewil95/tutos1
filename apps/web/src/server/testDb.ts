import { useTestDatabase } from "@mca/db/testing";

/**
 * Creates a temporary SQLite database with every migration applied and makes it the
 * app's database. Always available, so database tests always run (in CI too).
 */
export async function databaseReady(): Promise<boolean> {
  await useTestDatabase();
  return true;
}
