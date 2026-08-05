import type Database from "better-sqlite3";
import { startRun } from "../db/open.ts";
import type { ParsedEntity } from "../lib/entity-stream.ts";

/**
 * Loads canonical artist and label names from their dumps.
 *
 * Only entities the corpus actually references are kept. Storing all nine
 * million Discogs artists would bloat the file the server reads for no gain,
 * and keeping the served database small is the whole architectural point.
 *
 * Until this runs, names come from whatever a release row happened to spell
 * them as, which is how "Not On Label" turned up in four different casings.
 */

export interface EntitiesStats {
  artistsScanned: number;
  artistsKept: number;
  labelsScanned: number;
  labelsKept: number;
  /** In the corpus but absent from the dump. Should be zero or near it. */
  artistsMissing: number;
  labelsMissing: number;
}

export async function runEntities(
  db: Database.Database,
  sources: {
    artists?: AsyncIterable<ParsedEntity> | Iterable<ParsedEntity>;
    labels?: AsyncIterable<ParsedEntity> | Iterable<ParsedEntity>;
  },
  options: { sourceFile?: string } = {},
): Promise<EntitiesStats> {
  const run = startRun(db, "entities", options.sourceFile ?? null, {});

  db.exec("DELETE FROM artists");
  db.exec("DELETE FROM labels");

  const wantedArtists = new Set(
    db.prepare("SELECT artist_id FROM corpus_artists").pluck().all() as number[],
  );
  const wantedLabels = new Set(
    db.prepare("SELECT DISTINCT label_id FROM release_labels").pluck().all() as number[],
  );

  const stats: EntitiesStats = {
    artistsScanned: 0,
    artistsKept: 0,
    labelsScanned: 0,
    labelsKept: 0,
    artistsMissing: 0,
    labelsMissing: 0,
  };

  if (sources.artists) {
    const insert = db.prepare(
      "INSERT OR REPLACE INTO artists (id, name, real_name, profile, urls) VALUES (?, ?, ?, ?, ?)",
    );
    db.exec("BEGIN");
    for await (const entity of sources.artists) {
      stats.artistsScanned++;
      if (!wantedArtists.has(entity.id)) continue;
      insert.run(entity.id, entity.name, entity.realName, entity.profile, entity.urls.join("\n") || null);
      stats.artistsKept++;
    }
    db.exec("COMMIT");
  }

  if (sources.labels) {
    const insert = db.prepare("INSERT OR REPLACE INTO labels (id, name, profile, urls) VALUES (?, ?, ?, ?)");
    db.exec("BEGIN");
    for await (const entity of sources.labels) {
      stats.labelsScanned++;
      if (!wantedLabels.has(entity.id)) continue;
      insert.run(entity.id, entity.name, entity.profile, entity.urls.join("\n") || null);
      stats.labelsKept++;
    }
    db.exec("COMMIT");
  }

  stats.artistsMissing = wantedArtists.size - stats.artistsKept;
  stats.labelsMissing = wantedLabels.size - stats.labelsKept;

  // The search index is external-content FTS, so it is rebuilt from the tables
  // rather than written to directly.
  db.exec("INSERT INTO artist_search(artist_search) VALUES('rebuild')");
  db.exec("INSERT INTO label_search(label_search) VALUES('rebuild')");

  run.finish(stats);
  return stats;
}
