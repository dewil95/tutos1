import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Integration tests share one database; run files serially.
    fileParallelism: false,
  },
});
