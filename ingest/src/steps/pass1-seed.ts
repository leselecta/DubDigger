import type Database from "better-sqlite3";
import {
  isSeedRelease,
  seedLabel as seedLabelDefaults,
  isPlaceholderArtist,
  isPlaceholderLabel,
} from "../config.ts";
import { startRun, dropBulkIndexes, createBulkIndexes } from "../db/open.ts";
import type { ParsedRelease } from "../lib/release-stream.ts";

/**
 * Pass 1, the style seed.
 *
 * Selects releases whose styles intersect the core set, takes everyone credited
 * on them as the seed artist set, then derives the seed labels from that.
 *
 * The seed label rule needs both a floor and a ratio. Flat counts alone don't
 * work: a 500-artist label clearing "2 or more seed artists" is noise, not a
 * sign the label belongs to the scene, so the bar has to scale with roster size.
 */

export interface Pass1Options {
  /** Overrides the configured seed rule. Used by tests. */
  isSeed?: (styles: string[], genres: string[]) => boolean;
  seedLabel?: { minSeedArtists: number; minSeedArtistRatio: number };
  sourceFile?: string;
  onProgress?: (scanned: number) => void;
}

export interface Pass1Stats {
  releasesScanned: number;
  seedReleases: number;
  seedArtists: number;
  /** Labels with at least one seed artist, before the floor and ratio apply. */
  candidateLabels: number;
  seedLabels: number;
  distinctRoles: number;
  /**
   * Label references the dump gives no id for. They cannot become corpus
   * entities, but they are counted rather than dropped in silence.
   */
  labelsWithoutId: number;
  /** "Not On Label" style placeholders, excluded from roster maths. */
  placeholderLabels: number;
}

/**
 * Tables pass 1 owns and rebuilds from scratch.
 *
 * Without this, a second run layers on top of the first: INSERT OR REPLACE
 * leaves every row the new run does not happen to overwrite, so seed_artists
 * becomes the union of both runs and the seed labels are derived from a
 * mixture. The reported counts stay correct, which makes it look fine.
 */
const OWNED_TABLES = [
  "releases",
  "release_artists",
  "release_credits",
  "release_labels",
  "release_styles",
  "release_genres",
  "seed_artists",
  "seed_labels",
  "label_artist_pairs",
  "roles_seen",
  "corpus_artists",
];

const COMMIT_EVERY = 20_000;
const PROGRESS_EVERY = 100_000;

export async function runPass1(
  db: Database.Database,
  releases: Iterable<ParsedRelease> | AsyncIterable<ParsedRelease>,
  options: Pass1Options = {},
): Promise<Pass1Stats> {
  const isSeed = options.isSeed ?? isSeedRelease;
  const thresholds = options.seedLabel ?? seedLabelDefaults;

  const reset = db.transaction(() => {
    for (const table of OWNED_TABLES) db.exec(`DELETE FROM ${table}`);
  });
  reset();

  const run = startRun(db, "pass1", options.sourceFile ?? null, { seedLabel: thresholds });

  const insert = {
    release: db.prepare(
      `INSERT OR REPLACE INTO releases (id, title, year, is_seed) VALUES (?, ?, ?, 1)`,
    ),
    artist: db.prepare(
      `INSERT OR REPLACE INTO release_artists (release_id, position, artist_id, name, join_phrase)
       VALUES (?, ?, ?, ?, ?)`,
    ),
    credit: db.prepare(
      `INSERT OR REPLACE INTO release_credits (release_id, position, artist_id, name, role)
       VALUES (?, ?, ?, ?, ?)`,
    ),
    label: db.prepare(
      `INSERT OR REPLACE INTO release_labels (release_id, position, label_id, name, catno)
       VALUES (?, ?, ?, ?, ?)`,
    ),
    style: db.prepare(
      `INSERT OR IGNORE INTO release_styles (release_id, style) VALUES (?, ?)`,
    ),
    genre: db.prepare(
      `INSERT OR IGNORE INTO release_genres (release_id, genre) VALUES (?, ?)`,
    ),
    pair: db.prepare(
      `INSERT OR IGNORE INTO label_artist_pairs (label_id, artist_id) VALUES (?, ?)`,
    ),
    role: db.prepare(
      `INSERT INTO roles_seen (role, occurrences) VALUES (?, 1)
       ON CONFLICT(role) DO UPDATE SET occurrences = occurrences + 1`,
    ),
  };

  /** Seed release count per artist, tallied in memory and written at the end. */
  const seedArtistReleases = new Map<number, number>();

  let scanned = 0;
  let seedReleases = 0;
  let labelsWithoutId = 0;
  let placeholderLabels = 0;

  // Rebuilt after the load. Maintaining them during it means millions of
  // random writes into a growing B-tree.
  dropBulkIndexes(db);

  db.exec("BEGIN");
  try {
    for await (const release of releases) {
      scanned++;

      // Roster pairs come from EVERY release, not just the seeded ones. The
      // ratio is meaningless if the denominator only covers the seed styles.
      for (const label of release.labels) {
        if (label.id === null) {
          labelsWithoutId++;
          continue;
        }
        // "Not On Label" is the label equivalent of Various.
        if (isPlaceholderLabel(label.name)) {
          placeholderLabels++;
          continue;
        }
        for (const artist of release.artists) {
          if (isPlaceholderArtist(artist.id, artist.name)) continue;
          insert.pair.run(label.id, artist.id);
        }
      }

      if (isSeed(release.styles, release.genres)) {
        seedReleases++;
        keepRelease(db, insert, release, seedArtistReleases);
      }

      if (scanned % COMMIT_EVERY === 0) {
        db.exec("COMMIT; BEGIN");
      }
      if (options.onProgress && scanned % PROGRESS_EVERY === 0) {
        options.onProgress(scanned);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    createBulkIndexes(db);
    throw err;
  }

  createBulkIndexes(db);

  const writeSeedArtists = db.transaction(() => {
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO seed_artists (artist_id, seed_releases) VALUES (?, ?)`,
    );
    for (const [artistId, count] of seedArtistReleases) stmt.run(artistId, count);
  });
  writeSeedArtists();

  const candidateLabels = computeSeedLabels(db, thresholds);

  // label_artist_pairs is deliberately KEPT. It is the biggest table in the
  // file, but it is the only thing that lets the label floor and ratio be
  // re-tuned without re-reading 10.4 GB. Drop it with the seed-labels CLI once
  // the dials are settled.

  const count = (table: string): number =>
    db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;

  const stats: Pass1Stats = {
    releasesScanned: scanned,
    seedReleases,
    seedArtists: seedArtistReleases.size,
    candidateLabels,
    seedLabels: count("seed_labels"),
    distinctRoles: count("roles_seen"),
    labelsWithoutId,
    placeholderLabels,
  };

  run.finish(stats);
  return stats;
}

type Statements = Record<string, Database.Statement>;

function keepRelease(
  db: Database.Database,
  insert: Statements,
  release: ParsedRelease,
  seedArtistReleases: Map<number, number>,
): void {
  insert.release!.run(release.id, release.title, release.year);

  release.artists.forEach((artist, position) => {
    insert.artist!.run(release.id, position, artist.id, artist.name, artist.joinPhrase);
  });

  release.credits.forEach((credit, position) => {
    insert.credit!.run(release.id, position, credit.id, credit.name, credit.role);
    // Never silently drop a role. This log is the input to any future
    // normalisation work, which v1 deliberately does not attempt.
    insert.role!.run(credit.role);
  });

  release.labels.forEach((label, position) => {
    // An unidentified label has no page to pivot to, so it never becomes a row.
    // The position index still reflects the original order on the release.
    if (label.id === null || isPlaceholderLabel(label.name)) return;
    insert.label!.run(release.id, position, label.id, label.name, label.catno);
  });

  for (const style of release.styles) insert.style!.run(release.id, style);
  for (const genre of release.genres) insert.genre!.run(release.id, genre);

  // Everyone credited counts towards the seed, the artist line and the
  // extraartists alike. A mixing engineer is exactly the kind of thread this
  // tool exists to follow.
  for (const person of [...release.artists, ...release.credits]) {
    if (isPlaceholderArtist(person.id, person.name)) continue;
    seedArtistReleases.set(person.id, (seedArtistReleases.get(person.id) ?? 0) + 1);
  }
}

/**
 * Derives seed labels from the pairs table. Returns how many labels had any
 * seed artist at all, which is the useful denominator when tuning the dials.
 */
export function computeSeedLabels(
  db: Database.Database,
  thresholds: { minSeedArtists: number; minSeedArtistRatio: number },
): number {
  const candidates = db
    .prepare(
      `SELECT count(DISTINCT p.label_id)
         FROM label_artist_pairs p
         JOIN seed_artists s ON s.artist_id = p.artist_id`,
    )
    .pluck()
    .get() as number;

  db.prepare(
    `INSERT OR REPLACE INTO seed_labels
       (label_id, seed_artist_count, total_artist_count, seed_ratio)
     SELECT
       p.label_id,
       count(s.artist_id),
       count(*),
       CAST(count(s.artist_id) AS REAL) / count(*)
     FROM label_artist_pairs p
     LEFT JOIN seed_artists s ON s.artist_id = p.artist_id
     GROUP BY p.label_id
     HAVING count(s.artist_id) >= ?
        AND CAST(count(s.artist_id) AS REAL) / count(*) >= ?`,
  ).run(thresholds.minSeedArtists, thresholds.minSeedArtistRatio);

  return candidates;
}
