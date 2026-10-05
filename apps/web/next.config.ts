import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mca/db", "@mca/domain"],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
};

export default nextConfig;
