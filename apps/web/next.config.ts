import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mca/db", "@mca/domain", "@mca/ai", "@mca/connectors"],
  // Vercel caps a function request body at 4.5 MB; bigger files come in by email instead.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  serverExternalPackages: [
    "@prisma/client",
    "@prisma/adapter-pg",
    "pg",
    "@google/genai",
    "@anthropic-ai/sdk",
  ],
};

export default nextConfig;
