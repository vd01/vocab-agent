import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@libsql/client', '@earendil-works/pi-coding-agent', '@earendil-works/pi-ai'],
  devIndicators: false,
  allowedDevOrigins: ['vocab-agent.duckdns.org'],
  productionBrowserSourceMaps: false,
  turbopack: {
    root: '..',
  },
};

export default nextConfig;
