/**
 * Backfills the release page's fields onto an existing corpus: the printed
 * date, the country, the carrier and the tracklist.
 *
 *   npm run enrich --workspace ingest              # against the newest sample
 *   npm run enrich --workspace ingest -- --full    # against the full dump
 *
 * Requires a corpus: it updates the releases already in the database and
 * inserts nothing. Run it after pass 2 and before publish. It does not touch
 * `year`, any style, or any derived table, so nothing it does can move the
 * corpus boundary — which is why adding four columns costs one read of the
 * dump rather than a re-run of the selection.
 */
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.ts";
import { openDb, startRun } from "../db/open.ts";
import { openDump, streamReleases } from "../lib/release-stream.ts";
import { enrichReleases } from "../steps/enrich-releases.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

function newestIn(dir: string, suffix: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

const source =
  flag("file") ??
  (argv.includes("--full")
    ? newestIn(paths.dumps, "_releases.xml.gz")
    : newestIn(paths.samples, ".xml"));

if (!source) {
  console.error("No source found. Run fetch-dumps or make-sample first.");
  process.exit(1);
}

const db = openDb();
const corpus = db.prepare("SELECT count(*) FROM releases").pluck().get() as number;

if (corpus === 0) {
  console.error("No releases in the database. Run pass2 first.");
  process.exit(1);
}

console.log(`Enrich, one read of the dump`);
console.log(`  source     ${source}`);
console.log(`  corpus     ${corpus.toLocaleString("en-GB")} releases\n`);

if (source.endsWith(".gz")) {
  console.log(`  Reading the full dump. 19.3M records go past to reach 1.1M.\n`);
}

const run = startRun(db, "enrich", path.basename(source), {});
const started = Date.now();

const stats = await enrichReleases(db, () => streamReleases(openDump(source!)), {
  onProgress: (scanned, matched) => {
    const rate = Math.round(scanned / ((Date.now() - started) / 1000));
    console.log(
      `    ${scanned.toLocaleString("en-GB")} scanned · ` +
        `${matched.toLocaleString("en-GB")} in the corpus (${rate}/s)`,
    );
  },
});

run.finish(stats);

const withDate = db
  .prepare("SELECT count(*) FROM releases WHERE released IS NOT NULL")
  .pluck()
  .get() as number;
const withCountry = db
  .prepare("SELECT count(*) FROM releases WHERE country IS NOT NULL")
  .pluck()
  .get() as number;
const n = (x: number) => x.toLocaleString("en-GB");
const pct = (x: number) => `${((x / corpus) * 100).toFixed(1)}%`;

console.log(`
  scanned      ${n(stats.scanned)}
  in corpus    ${n(stats.matched)}

  with a date  ${n(withDate)} (${pct(withDate)})
  with country ${n(withCountry)} (${pct(withCountry)})
  tracks       ${n(stats.tracks)}
  formats      ${n(stats.formats)}

  Publish to carry these into the web copy.
`);

db.close();
