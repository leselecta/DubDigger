/**
 * Runs pass 2, the one hop expansion, and reports the per-channel counts.
 *
 *   npm run pass2 --workspace ingest              # against the newest sample
 *   npm run pass2 --workspace ingest -- --full    # against the full dump
 *   npm run pass2 --workspace ingest -- --full --min-ties 2
 *
 * Requires pass 1 to have run: the seed artist and seed label sets are read
 * from the database, not recomputed.
 */
import fs from "node:fs";
import path from "node:path";
import { paths, expansion } from "../config.ts";
import { openDb } from "../db/open.ts";
import { openDump, streamReleases } from "../lib/release-stream.ts";
import { runPass2 } from "../steps/pass2-expand.ts";

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
const seedArtists = db.prepare("SELECT count(*) FROM seed_artists").pluck().get() as number;
const seedLabels = db.prepare("SELECT count(*) FROM seed_labels").pluck().get() as number;

if (seedArtists === 0) {
  console.error("No seed artists. Run pass1 first.");
  process.exit(1);
}

const minTies = Number(flag("min-ties") ?? expansion.channelAMinSharedReleases);

console.log(`Pass 2, one hop out`);
console.log(`  source        ${source}`);
console.log(`  seed artists  ${seedArtists.toLocaleString("en-GB")}  (channel A)`);
console.log(`  seed labels   ${seedLabels.toLocaleString("en-GB")}  (channel B)`);
console.log(`  min ties      ${minTies}${minTies === 1 ? "  (dial off)" : ""}\n`);

if (source.endsWith(".gz")) console.log(`  Reading the full dump. This takes a while.\n`);

const started = Date.now();
const stats = await runPass2(db, streamReleases(openDump(source)), {
  sourceFile: path.basename(source),
  channelAMinSharedReleases: minTies,
  onProgress: (n) => {
    const rate = n / ((Date.now() - started) / 1000);
    console.log(`    ${n.toLocaleString("en-GB")} releases (${Math.round(rate)}/s)`);
  },
});

const n = (v: number) => v.toLocaleString("en-GB");
const pct = (v: number) => `${((v / stats.totalKept) * 100).toFixed(1)}%`;

console.log(`
  releases scanned    ${n(stats.releasesScanned)}
  corpus releases     ${n(stats.totalKept)}   <- steering signal

    channel A only    ${n(stats.keptChannelA)}   ${pct(stats.keptChannelA)}  (collaboration)
    channel B only    ${n(stats.keptChannelB)}   ${pct(stats.keptChannelB)}  (label mate)
    both              ${n(stats.keptBoth)}   ${pct(stats.keptBoth)}

  corpus artists      ${n(stats.corpusArtists)}   <- steering signal
    seed              ${n(stats.seedArtists)}
    added by the hop  ${n(stats.newArtists)}

  elapsed             ${((Date.now() - started) / 1000).toFixed(1)}s
`);

const size = fs.statSync(paths.db).size / (1 << 30);
console.log(`  Database: ${paths.db} (${size.toFixed(2)} GB)`);
