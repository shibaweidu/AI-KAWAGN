import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  // Keep dev output separate so a concurrent production build cannot invalidate dev CSS chunks.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  transpilePackages: ["@ai-card/contracts"],
  async rewrites() { return [{ source: "/api/:path*", destination: `${process.env.API_ORIGIN || "http://localhost:4000"}/:path*` }]; },
};
export default nextConfig;
