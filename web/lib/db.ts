import "server-only";
import Database from "better-sqlite3";
import path from "node:path";

/**
 * The app's entire data layer: one read-only SQLite file, opened once.
 *
 * No database server, no API calls, no dump parsing. If something here needs to
 * do more work than a SELECT against a precomputed table, it belongs in ingest.
 */

const dbPath =
  process.env.DUBDIGGER_DB ?? path.join(process.cwd(), "data/dubdigger.sqlite");

let cached: Database.Database | null = null;

/**
 * Returns the database, or null when no ingest has been run yet.
 *
 * Opening and catching beats an existsSync check: it avoids dragging the whole
 * project into Next's file tracing, and it treats "missing" and "unreadable"
 * the same way, which is what the caller actually cares about.
 */
export function getDb(): Database.Database | null {
  if (cached) return cached;

  try {
    cached = new Database(dbPath, { readonly: true, fileMustExist: true });
    cached.pragma("query_only = true");
    return cached;
  } catch {
    return null;
  }
}

export function getDbPath(): string {
  return dbPath;
}

export interface CorpusStats {
  artists: number;
  labels: number;
  releases: number;
  seedArtists: number;
  seedLabels: number;
  distinctRoles: number;
}

export function getCorpusStats(): CorpusStats | null {
  const db = getDb();
  if (!db) return null;

  const count = (table: string): number =>
    (db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;

  return {
    artists: count("artists"),
    labels: count("labels"),
    releases: count("releases"),
    seedArtists: count("seed_artists"),
    seedLabels: count("seed_labels"),
    distinctRoles: count("roles_seen"),
  };
}
