import { fileURLToPath } from "node:url";
import { wasmModule } from "@mca/db/vitest-wasm";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [wasmModule()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.test.ts"],
    fileParallelism: false,
    // Database tests run on a local Cloudflare D1 (Miniflare); its first start takes a few seconds.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
