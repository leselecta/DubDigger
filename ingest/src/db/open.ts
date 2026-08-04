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

  return db;
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
