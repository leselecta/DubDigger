import type { APIRoute } from "astro";
import { statSync } from "node:fs";
import { getDbPath } from "@/lib/db";
import { getTopArtists, getTopLabels } from "@/lib/queries";

/**
 * The sitemap, generated per request rather than at build time.
 *
 * @astrojs/sitemap would list the four static routes and stop, because
 * `/artist/[id]` has no static path list to enumerate: in a server-rendered app
 * the routes exist only as far as the database says they do. So it is written
 * here, where the same queries the Core pages run are already to hand and
 * already memoised for the life of the process.
 *
 * What it lists is the top thousand artists and the top thousand labels, which
 * is the same set the Core pages rank. The other half million pages stay
 * reachable — every one is linked from a page in here, and a crawler that
 * follows links will find them — but nothing in this file invites a bot to walk
 * 534,527 SQLite queries on a one-core VPS. Discovery, not exhaustiveness.
 *
 * The build-time path API above is described rather than named on purpose.
 * Astro decides whether to warn that the export is being ignored by testing
 * whether the source text contains the name at all, so writing it in a comment
 * prints a warning about an export this file does not have, on every build.
 */

/**
 * When the content last changed, which is when the database was last written.
 *
 * Every page on the site is derived from that one file, so its mtime is the
 * honest answer for all of them. A per-page date would be a fiction: nothing in
 * the corpus records when a credit was entered, and a `lastmod` that moves when
 * it should not is worse than none, since it teaches an engine to stop trusting
 * the whole file.
 */
function lastChanged(): string {
  try {
    return statSync(getDbPath()).mtime.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export const GET: APIRoute = ({ site }) => {
  const origin = new URL("/", site).href.replace(/\/$/, "");
  const lastmod = lastChanged();

  const paths = [
    "/",
    "/core-artists",
    "/core-labels",
    "/info",
    "/accessibility",
    ...getTopArtists().map((artist) => `/artist/${artist.id}`),
    ...getTopLabels().map((label) => `/label/${label.id}`),
  ];

  const urls = paths
    .map((path) => `  <url><loc>${origin}${path}</loc><lastmod>${lastmod}</lastmod></url>`)
    .join("\n");

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    { headers: { "Content-Type": "application/xml; charset=utf-8" } },
  );
};
