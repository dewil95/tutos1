import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mca/db", "@mca/domain", "@mca/ai", "@mca/connectors"],
  // Uploads through the CRM; larger statements come in by email instead.
  experimental: { serverActions: { bodySizeLimit: "10mb" } },
  serverExternalPackages: ["@google/genai", "@anthropic-ai/sdk"],
};

export default nextConfig;

// `next dev` gets the same bindings as production (local D1 from wrangler.jsonc).
initOpenNextCloudflareForDev();
