import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module — it must stay a real require on the
  // server rather than being bundled.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
