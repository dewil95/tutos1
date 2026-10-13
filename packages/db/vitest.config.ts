import { defineConfig } from "vitest/config";
import { wasmModule } from "./vitest-wasm";

export default defineConfig({
  plugins: [wasmModule()],
  test: {
    include: ["src/**/*.test.ts"],
    // Integration tests share one local D1; run files serially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
