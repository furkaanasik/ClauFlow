import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep the dev badge off the left rail's footer controls
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
