/**
 * Recomputes the seed labels from the pairs table pass 1 left behind, so the
 * floor and ratio can be tuned in seconds instead of re-reading 10.4 GB.
 *
 *   npm run seed-labels --workspace ingest
 *   npm run seed-labels --workspace ingest -- --min-artists 3 --min-ratio 0.10
 *   npm run seed-labels --workspace ingest -- --drop-pairs   # reclaim the space
 */
import { paths, seedLabel } from "../config.ts";
import { openDb } from "../db/open.ts";
import { computeSeedLabels } from "../steps/pass1-seed.ts";

const argv = process.argv.slice(2);
const num = (name: string, fallback: number) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : Number(argv[i + 1]);
};

const db = openDb();

const pairs = db.prepare("SELECT count(*) FROM label_artist_pairs").pluck().get() as number;
if (pairs === 0) {
  console.error("No label_artist_pairs rows. Run pass1 --full first.");
  process.exit(1);
}

if (argv.includes("--drop-pairs")) {
  db.exec("DELETE FROM label_artist_pairs");
  db.exec("VACUUM");
  console.log("Pairs table dropped and file vacuumed.");
  process.exit(0);
}

const thresholds = {
  minSeedArtists: num("min-artists", seedLabel.minSeedArtists),
  minSeedArtistRatio: num("min-ratio", seedLabel.minSeedArtistRatio),
};

db.exec("DELETE FROM seed_labels");
const started = Date.now();
const candidates = computeSeedLabels(db, thresholds);
const seedLabels = db.prepare("SELECT count(*) FROM seed_labels").pluck().get() as number;

const n = (v: number) => v.toLocaleString("en-GB");
console.log(`
  floor              >= ${thresholds.minSeedArtists} seed artists
  ratio              >= ${(thresholds.minSeedArtistRatio * 100).toFixed(1)}% of roster

  candidate labels   ${n(candidates)}
  seed labels        ${n(seedLabels)}
  elapsed            ${((Date.now() - started) / 1000).toFixed(1)}s
`);

const top = db
  .prepare(
    `SELECT l.seed_artist_count, l.total_artist_count, l.seed_ratio,
            (SELECT name FROM release_labels WHERE label_id = l.label_id LIMIT 1) AS name
       FROM seed_labels l
      ORDER BY l.seed_artist_count DESC, l.seed_ratio DESC
      LIMIT 20`,
  )
  .all() as { name: string | null; seed_artist_count: number; total_artist_count: number; seed_ratio: number }[];

console.log("  Top seed labels:");
for (const l of top) {
  const ratio = `${(l.seed_ratio * 100).toFixed(0)}%`.padStart(4);
  const counts = `${l.seed_artist_count}/${l.total_artist_count}`.padStart(12);
  console.log(`    ${counts} ${ratio}  ${l.name ?? "?"}`);
}
console.log(`\n  Database: ${paths.db}`);
