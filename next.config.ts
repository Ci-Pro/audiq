import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Vercel handles images optimization
  images: {
    unoptimized: false,
  },
};

export default nextConfig;
