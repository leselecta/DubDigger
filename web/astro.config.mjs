// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Server rendered on every request, because the SQLite file is a static
 * artifact regenerated out of band and the app must read whatever is on disk
 * now. In Astro that is the default once an adapter is present, so there is no
 * per-page opt-in to forget.
 *
 * React is here for the three islands only. Everything else is .astro and
 * ships no JavaScript at all.
 */
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    // better-sqlite3 is a native module: it must stay a real require on the
    // server rather than being pulled into the bundle.
    ssr: { external: ["better-sqlite3"] },
  },
});
