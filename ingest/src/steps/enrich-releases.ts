import type Database from "better-sqlite3";
import type { ParsedRelease } from "../lib/release-stream.ts";

/**
 * Backfills the fields the release page shows onto a corpus that already
 * exists: the printed date, the country, the carrier and the tracklist.
 *
 * It is deliberately NOT part of pass 2, and that is the whole design. Pass 2
 * decides what the corpus is; this only describes what is already in it. So it
 * never inserts a release, never touches `year`, and never reads a style: run
 * it against a finished database and the corpus boundary cannot move under a
 * change that is about what a page prints.
 *
 * The cost is one more full read of a 10.4 GB dump, which is the price of not
 * re-running the selection to add four columns.
 */
export interface EnrichStats {
  /** Releases seen in the dump. */
  scanned: number;
  /** Of those, the ones the corpus holds. */
  matched: number;
  tracks: number;
  formats: number;
}

export interface EnrichOptions {
  onProgress?: (scanned: number, matched: number) => void;
  /** How often to report and commit. */
  batchSize?: number;
}

export async function enrichReleases(
  db: Database.Database,
  source: () => AsyncIterable<ParsedRelease> | Iterable<ParsedRelease>,
  options: EnrichOptions = {},
): Promise<EnrichStats> {
  const batchSize = options.batchSize ?? 5_000;

  /*
   * The corpus ids, held in memory for the length of the run.
   *
   * 1.1M integers against 19.3M lookups: anything that asks the database is
   * paying a B-tree probe per release in the dump, and the set is the same
   * trade pass 2 already makes with the seed artist ids.
   */
  const inCorpus = new Set<number>(
    db.prepare("SELECT id FROM releases").pluck().all() as number[],
  );

  const update = db.prepare("UPDATE releases SET released = ?, country = ? WHERE id = ?");
  const clearTracks = db.prepare("DELETE FROM release_tracks WHERE release_id = ?");
  const clearFormats = db.prepare("DELETE FROM release_formats WHERE release_id = ?");
  const addTrack = db.prepare(
    "INSERT INTO release_tracks (release_id, seq, position, title, duration) VALUES (?, ?, ?, ?, ?)",
  );
  const addFormat = db.prepare(
    `INSERT INTO release_formats (release_id, position, name, qty, text, descriptions)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );

  const stats: EnrichStats = { scanned: 0, matched: 0, tracks: 0, formats: 0 };

  /*
   * Written a batch at a time rather than one release at a time. Each release
   * is up to a dozen statements, and a transaction per release turns the run
   * into millions of commits.
   */
  const write = db.transaction((batch: ParsedRelease[]) => {
    for (const release of batch) {
      update.run(release.released, release.country, release.id);

      // Cleared first, so a second run replaces a tracklist rather than
      // printing it twice, and drops what the dump no longer says.
      clearTracks.run(release.id);
      clearFormats.run(release.id);

      release.tracks.forEach((track, seq) => {
        addTrack.run(release.id, seq, track.position, track.title, track.duration);
      });
      release.formats.forEach((format, position) => {
        addFormat.run(
          release.id,
          position,
          format.name,
          format.qty,
          format.text,
          format.descriptions.join("\n"),
        );
      });

      stats.tracks += release.tracks.length;
      stats.formats += release.formats.length;
    }
  });

  let batch: ParsedRelease[] = [];

  for await (const release of source()) {
    stats.scanned++;

    if (inCorpus.has(release.id)) {
      stats.matched++;
      batch.push(release);
    }

    if (batch.length >= batchSize) {
      write(batch);
      batch = [];
    }
    if (stats.scanned % batchSize === 0) options.onProgress?.(stats.scanned, stats.matched);
  }

  if (batch.length > 0) write(batch);
  return stats;
}
