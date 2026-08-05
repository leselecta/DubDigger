/**
 * Runs pass 1, the style seed, and reports the numbers that steer the corpus.
 *
 *   npm run pass1 --workspace ingest              # against the newest sample
 *   npm run pass1 --workspace ingest -- --full    # against the full dump
 *   npm run pass1 --workspace ingest -- --file path/to/releases.xml
 *
 * Defaults to the sample on purpose. Prove the pass correct on 5,000 records
 * before spending hours on 10.4 GB.
 */
import fs from "node:fs";
import path from "node:path";
import { paths, SEED_STYLES, seedLabel } from "../config.ts";
import { openDb } from "../db/open.ts";
import { openDump, streamReleases } from "../lib/release-stream.ts";
import { runPass1 } from "../steps/pass1-seed.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

/** Most recently written match. By mtime, since names don't sort chronologically. */
function newestIn(dir: string, suffix: string): string | undefined {
  if (!fs.existsSync(dir)) return undefined;
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(suffix))
    .map((f) => path.join(dir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
}

function resolveSource(): string {
  const explicit = flag("file");
  if (explicit) return explicit;

  if (argv.includes("--full")) {
    const dump = newestIn(paths.dumps, "_releases.xml.gz");
    if (!dump) throw new Error(`No releases dump in ${paths.dumps}. Run fetch-dumps first.`);
    return dump;
  }

  const sample = newestIn(paths.samples, ".xml");
  if (!sample) {
    throw new Error(
      `No sample in ${paths.samples}.\n` +
        `Run: npm run make-sample --workspace ingest -- releases\n` +
        `Or pass --full to run against the whole dump.`,
    );
  }
  return sample;
}

const source = resolveSource();
const isFull = source.endsWith(".gz");

console.log(`Pass 1, style seed`);
console.log(`  source   ${source}`);
console.log(`  styles   ${[...SEED_STYLES].join(", ")}`);
console.log(`  label    >= ${seedLabel.minSeedArtists} seed artists`
  + ` and >= ${(seedLabel.minSeedArtistRatio * 100).toFixed(1)}% of roster\n`);

if (isFull) console.log(`  Reading the full dump. This takes a while.\n`);

const db = openDb();
const started = Date.now();

const stats = await runPass1(db, streamReleases(openDump(source)), {
  sourceFile: path.basename(source),
  onProgress: (n) => {
    const rate = n / ((Date.now() - started) / 1000);
    console.log(`    ${n.toLocaleString("en-GB")} releases (${Math.round(rate)}/s)`);
  },
});

const elapsed = (Date.now() - started) / 1000;
const n = (v: number) => v.toLocaleString("en-GB");

console.log(`
  releases scanned   ${n(stats.releasesScanned)}
  seed releases      ${n(stats.seedReleases)}
  seed artists       ${n(stats.seedArtists)}   <- steering signal
  candidate labels   ${n(stats.candidateLabels)}   (had any seed artist)
  seed labels        ${n(stats.seedLabels)}   <- steering signal
  distinct roles     ${n(stats.distinctRoles)}
  labels with no id  ${n(stats.labelsWithoutId)}   (skipped, cannot be linked)

  elapsed            ${elapsed.toFixed(1)}s
`);

// The real sanity check is whether these look like scene labels.
const top = db
  .prepare(
    `SELECT l.label_id, l.seed_artist_count, l.total_artist_count, l.seed_ratio,
            (SELECT name FROM release_labels WHERE label_id = l.label_id LIMIT 1) AS name
       FROM seed_labels l
      ORDER BY l.seed_artist_count DESC, l.seed_ratio DESC
      LIMIT 15`,
  )
  .all() as {
  label_id: number;
  name: string | null;
  seed_artist_count: number;
  total_artist_count: number;
  seed_ratio: number;
}[];

if (top.length > 0) {
  console.log("  Top seed labels:");
  for (const l of top) {
    const ratio = `${(l.seed_ratio * 100).toFixed(0)}%`.padStart(4);
    const counts = `${l.seed_artist_count}/${l.total_artist_count}`.padStart(9);
    console.log(`    ${counts} ${ratio}  ${l.name ?? `label ${l.label_id}`}`);
  }
  console.log();
}

console.log(`  Database: ${paths.db}`);
