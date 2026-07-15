import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@libsql/client'],
  devIndicators: false,
  allowedDevOrigins: ['vocab-agent.duckdns.org'],
  productionBrowserSourceMaps: false,
  turbopack: {
    root: '..',
  },
};

export default nextConfig;
