import type { NextConfig } from "next";

/**
 * READABLE_BUILD=1 npm run build
 *
 * Leaves the production bundle unminified and mapped, for reading what the
 * build actually produced. Off by default, and applied as a whole block rather
 * than per key, because turbopackMinify defaults to false in dev and setting it
 * unconditionally would switch minification ON there.
 *
 * swcMinify is gone as of Next 15, so the Turbopack flag is the way in.
 */
const readable = process.env.READABLE_BUILD === "1";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — it must stay a real require on the
  // server rather than being bundled.
  serverExternalPackages: ["better-sqlite3"],

  ...(readable && {
    productionBrowserSourceMaps: true,
    experimental: { turbopackMinify: false },
  }),
};

export default nextConfig;
