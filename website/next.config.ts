import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
