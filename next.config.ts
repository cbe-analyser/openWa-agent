import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  // Server-only packages that must not be bundled into the client or the edge runtime.
  serverExternalPackages: ["pino", "mammoth", "unpdf", "@prisma/client"],
  experimental: {
    serverActions: { bodySizeLimit: "1mb" },
  },
};

export default nextConfig;
