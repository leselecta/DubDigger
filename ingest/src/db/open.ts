import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { paths } from "../config.ts";

const schemaPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "schema.sql",
);

/**
 * Opens the ingest database, applying the schema. Safe to call repeatedly —
 * the schema is all CREATE ... IF NOT EXISTS.
 *
 * @param file Defaults to the configured ingest database.
 */
export function openDb(file: string = paths.db): Database.Database {
  fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  // Ingest is a one-off offline batch job on a regenerable artifact, so the
  // durability trade is worth the write speed.
  db.pragma("synchronous = OFF");
  // Pass 1 does tens of millions of INSERT OR IGNOREs into label_artist_pairs.
  // Each one is a B-tree probe, so keeping the working set in memory rather
  // than paging it off disk is the difference between minutes and hours.
  db.pragma("cache_size = -262144"); // 256 MB
  db.exec(fs.readFileSync(schemaPath, "utf8"));
  addMissingColumns(db);

  return db;
}

/**
 * CREATE TABLE IF NOT EXISTS silently does nothing when the table already
 * exists, so a column added to the schema never reaches a database built before
 * it. These are the columns added after the first schema shipped.
 */
function addMissingColumns(db: Database.Database): void {
  const additions: [table: string, column: string, type: string][] = [
    ["artists", "profile", "TEXT"],
    ["artists", "urls", "TEXT"],
    ["labels", "profile", "TEXT"],
    ["labels", "urls", "TEXT"],
    ["artist_relations", "related_name", "TEXT NOT NULL DEFAULT ''"],
  ];

  for (const [table, column, type] of additions) {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (existing.some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/**
 * Indexes on the release tables that the passes bulk load into.
 *
 * These are keyed by artist_id, label_id and style, none of which arrive in
 * order, so maintaining them during a load means millions of random writes into
 * a growing B-tree. Measured on the 20260801 dump that took pass 2 past two
 * hours. Dropping them first and rebuilding after is the standard trade:
 * building an index once over settled data is enormously cheaper.
 *
 * The rows themselves are keyed by (release_id, position) and arrive in
 * release_id order, so those writes stay sequential and are not the problem.
 */
const BULK_INDEXES: Record<string, string> = {
  idx_release_artists_artist: "ON release_artists (artist_id)",
  idx_release_credits_artist: "ON release_credits (artist_id)",
  idx_release_labels_label: "ON release_labels (label_id)",
  idx_release_styles_style: "ON release_styles (style)",
};

export function dropBulkIndexes(db: Database.Database): void {
  for (const name of Object.keys(BULK_INDEXES)) db.exec(`DROP INDEX IF EXISTS ${name}`);
}

export function createBulkIndexes(db: Database.Database): void {
  for (const [name, target] of Object.entries(BULK_INDEXES)) {
    db.exec(`CREATE INDEX IF NOT EXISTS ${name} ${target}`);
  }
}

/** Opens the finished database read-only, the way the web app does. */
export function openDbReadOnly(file: string = paths.db): Database.Database {
  return new Database(file, { readonly: true, fileMustExist: true });
}

/** Records that a step ran, and returns a handle to close it out with stats. */
export function startRun(
  db: Database.Database,
  step: string,
  sourceFile: string | null,
  config: unknown,
) {
  const info = db
    .prepare(
      `INSERT INTO ingest_runs (step, started_at, source_file, config_json)
       VALUES (?, ?, ?, ?)`,
    )
    .run(step, new Date().toISOString(), sourceFile, JSON.stringify(config));

  return {
    finish(stats: unknown) {
      db.prepare(
        `UPDATE ingest_runs SET finished_at = ?, stats_json = ? WHERE id = ?`,
      ).run(new Date().toISOString(), JSON.stringify(stats), info.lastInsertRowid);
    },
  };
}
