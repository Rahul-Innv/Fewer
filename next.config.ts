import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Mastra and the Postgres driver must run as plain Node modules, not bundled.
  serverExternalPackages: ["@mastra/*", "postgres", "agentmail", "exa-js"],
};

export default nextConfig;
