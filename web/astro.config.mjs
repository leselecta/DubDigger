// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import tailwindcss from "@tailwindcss/vite";

/**
 * Server rendered on every request, because the SQLite file is a static
 * artifact regenerated out of band and the app must read whatever is on disk
 * now. In Astro that is the default once an adapter is present, so there is no
 * per-page opt-in to forget.
 *
 * No UI framework. Every page is .astro, and the only client JavaScript is a
 * handful of lines in <script> tags plus the router. If something here ever
 * seems to want React, it is worth checking first whether it wants a link.
 */
export default defineConfig({
  /**
   * Where this is served from, and the only place it is written down.
   *
   * Canonicals, the sitemap and the card a shared link renders all need an
   * absolute URL, and a page cannot work one out from the request: a proxy in
   * front of the VPS can rewrite the host, and http/https is not visible from
   * inside. So it is asserted once here and read as Astro.site everywhere else.
   */
  site: "https://dubdigger.com",

  output: "server",
  adapter: node({ mode: "standalone" }),

  /**
   * Ship the HTML indented, the way the templates are written.
   *
   * Astro collapses whitespace by default. Turning that off costs almost
   * nothing once the response is compressed, because runs of spaces are the
   * easiest thing in the world for gzip to encode. Measured over the wire:
   * the artist page 4,422 to 4,661 bytes, the label page 3,742 to 3,921, the
   * home page 1,358 to 1,440. Under 250 bytes at the worst of them, to turn
   * the source a reader sees in devtools from one long line into something
   * they can follow. Worth it for a tool whose audience reads pages for fun.
   */
  compressHTML: false,

  vite: {
    plugins: [tailwindcss()],
    // better-sqlite3 is a native module: it must stay a real require on the
    // server rather than being pulled into the bundle.
    ssr: { external: ["better-sqlite3"] },

    build: {
      rollupOptions: {
        output: {
          /**
           * Name the stylesheet after what it is.
           *
           * globals.css is imported once, in Base.astro, so every page shares
           * one CSS chunk and Rollup names it after a module that happens to
           * be inside: it was shipping as Eyebrow.[hash].css, the alphabetically
           * first component present on all four pages. A file holding the whole
           * design system should not be named after a caption.
           */
          assetFileNames: (asset) =>
            asset.names?.some((n) => n.endsWith(".css"))
              ? "_astro/dubdigger.[hash][extname]"
              : "_astro/[name].[hash][extname]",
        },
      },
    },
  },
});
