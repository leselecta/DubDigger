/**
 * Measures how much of each seed artist's total output actually sits inside the
 * seed, and simulates what a ratio floor would do to the seed labels.
 *
 *   npm run measure-seed --workspace ingest
 *
 * Nothing is changed. This exists because the seed set is the definitional core
 * of the corpus, so a rule that trims it is worth measuring before it is built.
 *
 * Totals are cached in seed_artist_totals so thresholds can be tried repeatedly
 * without re-reading 10.4 GB. The cache records which dump it came from, and is
 * rescanned rather than reused when that no longer matches: see
 * lib/totals-cache.ts for the two ways it goes stale silently.
 *
 * This CLI fills the cache; derive reads it, so both tables are declared in
 * schema.sql rather than here.
 */
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.ts";
import { openDb } from "../db/open.ts";
import { openDump, streamReleases } from "../lib/release-stream.ts";
import { judgeTotalsCache } from "../lib/totals-cache.ts";

const db = openDb();

const dumpOnDisk =
  fs
    .readdirSync(paths.dumps)
    .filter((f) => f.endsWith("_releases.xml.gz"))
    .sort()
    .reverse()[0] ?? null;

const verdict = judgeTotalsCache(
  {
    cached: db.prepare("SELECT count(*) FROM seed_artist_totals").pluck().get() as number,
    builtFrom:
      (db.prepare("SELECT built_from FROM seed_artist_totals_meta WHERE id = 1").pluck().get() as
        | string
        | undefined) ?? null,
    dumpOnDisk,
    uncovered: db
      .prepare(
        `SELECT count(*) FROM seed_artists s
          WHERE NOT EXISTS (SELECT 1 FROM seed_artist_totals t WHERE t.artist_id = s.artist_id)`,
      )
      .pluck()
      .get() as number,
  },
  process.argv.includes("--rescan"),
);

if (verdict.action === "rescan") {
  const dump = dumpOnDisk;
  if (!dump) throw new Error("No releases dump found, and the cache cannot be trusted.");
  console.log(`Rescanning: ${verdict.why}.`);

  const seed = new Set(db.prepare("SELECT artist_id FROM seed_artists").pluck().all() as number[]);
  console.log(`Counting total appearances for ${seed.size.toLocaleString("en-GB")} seed artists...`);

  const total = new Map<number, number>();
  let scanned = 0;
  const started = Date.now();

  for await (const release of streamReleases(openDump(path.join(paths.dumps, dump)))) {
    scanned++;
    for (const p of [...release.artists, ...release.credits]) {
      if (seed.has(p.id)) total.set(p.id, (total.get(p.id) ?? 0) + 1);
    }
    if (scanned % 2_000_000 === 0) {
      console.log(`  ${(scanned / 1e6).toFixed(0)}M releases`);
    }
  }

  const write = db.transaction(() => {
    db.exec("DELETE FROM seed_artist_totals");
    const stmt = db.prepare("INSERT INTO seed_artist_totals (artist_id, total) VALUES (?, ?)");
    for (const [id, n] of total) stmt.run(id, n);
    db.prepare(
      "INSERT OR REPLACE INTO seed_artist_totals_meta (id, built_from) VALUES (1, ?)",
    ).run(dump);
  });
  write();
  console.log(`  scanned ${scanned.toLocaleString("en-GB")} in ${((Date.now() - started) / 1000).toFixed(0)}s\n`);
} else {
  const rows = db.prepare("SELECT count(*) FROM seed_artist_totals").pluck().get() as number;
  console.log(`Using cached totals for ${rows.toLocaleString("en-GB")} seed artists. --rescan to redo.`);
  if (verdict.warning) console.log(`  Note: ${verdict.warning}`);
  console.log();
}

const n = (v: number) => v.toLocaleString("en-GB");

console.log("=== what share of their work is in the seed ===");
const bands = db
  .prepare(
    `SELECT band, count(*) AS n FROM (
       SELECT CASE
         WHEN 1.0*s.seed_releases/t.total < 0.02 THEN 'a) under 2%'
         WHEN 1.0*s.seed_releases/t.total < 0.05 THEN 'b) 2-5%'
         WHEN 1.0*s.seed_releases/t.total < 0.10 THEN 'c) 5-10%'
         WHEN 1.0*s.seed_releases/t.total < 0.25 THEN 'd) 10-25%'
         WHEN 1.0*s.seed_releases/t.total < 0.50 THEN 'e) 25-50%'
         ELSE 'f) 50%+' END AS band
       FROM seed_artists s JOIN seed_artist_totals t ON t.artist_id = s.artist_id
     ) GROUP BY band ORDER BY band`,
  )
  .all() as { band: string; n: number }[];
const totalSeed = bands.reduce((a, b) => a + b.n, 0);
for (const b of bands) {
  console.log(`  ${b.band.padEnd(14)} ${String(n(b.n)).padStart(8)}  ${((b.n / totalSeed) * 100).toFixed(1)}%`);
}

console.log("\n=== the incidental end: biggest catalogues, smallest share ===");
const worst = db
  .prepare(
    `SELECT a.name, s.seed_releases, t.total
       FROM seed_artists s
       JOIN seed_artist_totals t ON t.artist_id = s.artist_id
       LEFT JOIN artists a ON a.id = s.artist_id
      WHERE a.name IS NOT NULL
      ORDER BY t.total DESC LIMIT 12`,
  )
  .all() as { name: string; seed_releases: number; total: number }[];
for (const w of worst) {
  console.log(
    `  ${String(w.seed_releases).padStart(5)}/${String(w.total).padEnd(7)} ` +
      `${((w.seed_releases / w.total) * 100).toFixed(1).padStart(5)}%  ${w.name}`,
  );
}

console.log("\n=== what a floor would cost, and what it would clean ===");
for (const floor of [0.02, 0.05, 0.1, 0.25]) {
  const kept = db
    .prepare(
      `SELECT count(*) FROM seed_artists s JOIN seed_artist_totals t ON t.artist_id = s.artist_id
        WHERE 1.0*s.seed_releases/t.total >= ?`,
    )
    .pluck()
    .get(floor) as number;

  // Recompute seed labels counting only the artists that clear the floor.
  const labels = db
    .prepare(
      `SELECT count(*) FROM (
         SELECT p.label_id,
                sum(CASE WHEN 1.0*s.seed_releases/t.total >= ? THEN 1 ELSE 0 END) AS strong,
                count(*) AS roster
           FROM label_artist_pairs p
           LEFT JOIN seed_artists s ON s.artist_id = p.artist_id
           LEFT JOIN seed_artist_totals t ON t.artist_id = p.artist_id
          GROUP BY p.label_id
         HAVING strong >= 2 AND 1.0*strong/roster >= 0.5)`,
    )
    .pluck()
    .get(floor) as number;

  console.log(
    `  floor ${(floor * 100).toFixed(0).padStart(3)}%:  seed artists ${n(kept).padStart(9)}` +
      `   seed labels ${n(labels).padStart(8)}`,
  );
}
const seedLabelsToday = db.prepare("SELECT count(*) FROM seed_labels").pluck().get() as number;
console.log(`\n  today: seed artists ${n(totalSeed)}, seed labels ${n(seedLabelsToday)}`);
