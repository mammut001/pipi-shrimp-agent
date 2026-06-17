import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The repo has both `pnpm-lock.yaml` (monorepo root) and
  // `website/package-lock.json` (this app). Pin Turbopack to this
  // directory so it picks the right lockfile instead of warning on
  // every build.
  turbopack: {
    root: path.resolve(__dirname),
  },
  // Image optimization
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
      },
    ],
  },
  // Compression
  compress: true,
  // Production source maps (disabled for faster loading)
  productionBrowserSourceMaps: false,
};

export default nextConfig;
