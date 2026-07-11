import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['@libsql/client'],
  devIndicators: false,
  allowedDevOrigins: ['vocab-agent.duckdns.org'],
  experimental: {
    webpackMemoryOptimizations: true,
  },
  webpack: (config) => {
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/node_modules/**', '**/.next/**', '**/generated/**'],
    };
    return config;
  },
};

export default nextConfig;
