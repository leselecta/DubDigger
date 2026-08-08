/**
 * Writes the file the web app reads.
 *
 *   npm run publish --workspace ingest
 *
 * Two things this does that a copy does not.
 *
 * It drops the raw tables the app never queries. The working database keeps
 * them so a pass can be re-run without re-reading 10.4 GB, but the server only
 * ever needs the precomputed answers, and keeping the served file small is the
 * whole architectural point.
 *
 * And it goes through VACUUM INTO rather than cp. A copied .sqlite leaves its
 * write-ahead log behind, so recent writes are silently missing: that is
 * exactly how the first preview came out with artists but no collaborators.
 * VACUUM INTO writes one self-contained file with no sidecar, and reclaims the
 * space freed when the corpus shrank.
 */
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.ts";
import { openDb } from "../db/open.ts";

/**
 * Raw tables the ingest needs and the app does not.
 *
 * release_artists and release_credits are served because the app needs them to
 * work out which releases an artist appears on, and with what role. Styles and
 * genres were only ever read by the release page, which v1 does not have:
 * release rows link straight to Discogs, which holds the fuller picture
 * including images, and avoids presenting a mostly empty credits list as
 * though it were an answer.
 */
const NOT_SERVED = [
  "release_styles",
  "release_genres",
  "label_artist_pairs",
  "seed_artist_totals",
  "seed_artist_totals_meta",
  // Ingest bookkeeping. roles_seen is the log of every distinct role string
  // encountered, kept so unmapped roles are never silently dropped; seed_artists
  // is the definitional core of the corpus, kept so "why is this person in?" can
  // be answered. Both matter, and both matter in the working database. The
  // server has no query for either.
  "roles_seen",
  "seed_artists",
  "ingest_runs",
];

const dest =
  process.argv[2] ?? path.resolve(paths.db, "../../../web/data/dubdigger.sqlite");
const staging = `${paths.db}.publish`;

for (const f of [staging, `${staging}-wal`, `${staging}-shm`]) fs.rmSync(f, { force: true });

const source = openDb();
const before = fs.statSync(paths.db).size;

console.log(`Publishing\n  from  ${paths.db}\n  to    ${dest}\n`);

console.log("  copying...");
source.exec(`VACUUM INTO '${staging}'`);
source.close();

console.log("  dropping tables the app never reads...");
const copy = openDb(staging);
for (const table of NOT_SERVED) copy.exec(`DROP TABLE IF EXISTS ${table}`);

// Give the planner statistics. Without sqlite_stat1 it picks indexes from
// hard-coded guesses about selectivity, which is a gamble worth not taking on a
// file this size when the fix costs seconds and runs once.
console.log("  analysing...");
copy.exec("ANALYZE");

console.log("  reclaiming space...");
copy.exec("VACUUM");

/*
 * Hand over a genuinely standalone file.
 *
 * VACUUM INTO produces one in journal_mode=delete, and then openDb above puts
 * it straight back into WAL because that is what ingest wants. A WAL database
 * cannot be opened, even read-only, without creating a -shm file beside it, so
 * the served artifact silently required a writable data directory and grew the
 * sidecars this script's own header says it avoids. Set it back last, after the
 * final write.
 */
copy.pragma("journal_mode = DELETE");
copy.close();

fs.mkdirSync(path.dirname(dest), { recursive: true });
for (const f of [dest, `${dest}-wal`, `${dest}-shm`]) fs.rmSync(f, { force: true });
fs.renameSync(staging, dest);

const after = fs.statSync(dest).size;
const gb = (n: number) => (n / (1 << 30)).toFixed(2);
console.log(`
  working database   ${gb(before)} GB
  published          ${gb(after)} GB

  Restart the web server: it holds the old file open until it does.
`);
