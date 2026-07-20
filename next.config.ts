import type { NextConfig } from "next";
import { resolve } from "node:path";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@libsql/client', '@earendil-works/pi-coding-agent', '@earendil-works/pi-ai', 'wordnet-db', 'linkedom'],
  devIndicators: false,
  allowedDevOrigins: ['vocab-agent.duckdns.org'],
  productionBrowserSourceMaps: false,
  turbopack: {
    root: resolve(__dirname, '..'),
  },
};

export default nextConfig;
