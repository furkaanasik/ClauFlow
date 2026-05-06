import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "react-markdown",
    "remark-parse",
    "remark-rehype",
    "unified",
    "unist-util-visit",
    "mdast-util-to-hast",
    "hast-util-to-jsx-runtime",
    "vfile",
    "@tanstack/react-virtual",
  ],
};

export default nextConfig;
