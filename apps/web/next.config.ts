import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained Node server (`.next/standalone`) that runs on the CRM server under systemd.
  output: "standalone",
  // Trace files from the whole monorepo so the workspace packages land in the bundle.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  transpilePackages: ["@mca/db", "@mca/domain", "@mca/ai", "@mca/connectors"],
  // Uploads through the CRM; larger statements come in by email instead.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  serverExternalPackages: [
    "@google/genai",
    "@anthropic-ai/sdk",
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
  ],
};

export default nextConfig;
