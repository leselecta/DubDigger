import type Database from "better-sqlite3";
import {
  expansion as expansionDefaults,
  isPlaceholderArtist,
  isPlaceholderLabel,
} from "../config.ts";
import { startRun, dropBulkIndexes, createBulkIndexes } from "../db/open.ts";
import type { ParsedRelease } from "../lib/release-stream.ts";

/**
 * Pass 2, one hop out on two channels.
 *
 * A release joins the corpus if EITHER channel applies:
 *
 *   Channel A, collaboration  — it credits someone in the seed artist set.
 *   Channel B, label          — it came out on a seed label.
 *
 * Both are needed. Expanding only through collaboration leaves label rosters
 * silently incomplete, which breaks the exact query a label page exists to
 * answer. Expanding only through labels misses the collaborator who never
 * released on a scene label.
 *
 * Crucially the seed sets are frozen for the whole pass. Artists admitted here
 * do NOT widen the match, or expansion runs away and eventually swallows most
 * of techno.
 */

export interface Pass2Options {
  /** Admit a non-seed artist to channel A only after this many seed releases. */
  channelAMinSharedReleases?: number;
  /** Seed artists doing less than this share of their work in the seed stop bridging. */
  channelAMinSeedRatio?: number | null;
  /** Releases crediting more than this admit no new artists via channel A. */
  channelAMaxPeopleToAdmit?: number;
  sourceFile?: string;
  onProgress?: (scanned: number) => void;
  onPhase?: (note: string) => void;
}

export interface Pass2Stats {
  releasesScanned: number;
  keptChannelA: number;
  keptChannelB: number;
  keptBoth: number;
  totalKept: number;
  corpusArtists: number;
  seedArtists: number;
  /** Artists the hop added on top of the seed set. */
  newArtists: number;
  /** Releases kept, but too crowded to imply anyone on them is connected. */
  crowdedReleases: number;
  /** Seed artists too high-degree to bridge. Still in the corpus themselves. */
  suppressedBridges: number;
}

const COMMIT_EVERY = 20_000;
const PROGRESS_EVERY = 100_000;

/**
 * Takes a factory rather than an iterable because the dump is read twice: once
 * to measure how many releases each seed artist appears on, and once to select.
 * A seed artist's degree cannot be known at the moment it is needed otherwise.
 */
export async function runPass2(
  db: Database.Database,
  openReleases: () => Iterable<ParsedRelease> | AsyncIterable<ParsedRelease>,
  options: Pass2Options = {},
): Promise<Pass2Stats> {
  const minTies =
    options.channelAMinSharedReleases ?? expansionDefaults.channelAMinSharedReleases;
  const maxPeopleToAdmit =
    options.channelAMaxPeopleToAdmit ?? expansionDefaults.channelAMaxPeopleToAdmit;
  const minSeedRatio =
    options.channelAMinSeedRatio === undefined
      ? expansionDefaults.channelAMinSeedRatio
      : options.channelAMinSeedRatio;

  // Before the reset, not after it. The reset deletes tens of millions of
  // child rows, and with these in place every one pays a random B-tree update
  // on artist_id or label_id. Deletes need this exactly as much as inserts do.
  dropBulkIndexes(db);

  reset(db);
  const run = startRun(db, "pass2", options.sourceFile ?? null, {
    channelAMinSharedReleases: minTies,
  });

  const seedArtists = new Set(
    db.prepare("SELECT artist_id FROM seed_artists").pluck().all() as number[],
  );
  const seedLabels = new Set(
    db.prepare("SELECT label_id FROM seed_labels").pluck().all() as number[],
  );

  // Phase 1. Measure how much of each seed artist's total output sits inside
  // the seed. Someone who did five of sixty thousand records here is not
  // evidence that any two of them are related.
  const bridges = new Set(seedArtists);
  let suppressedBridges = 0;

  if (minSeedRatio !== null) {
    const seedWork = new Map(
      db.prepare("SELECT artist_id, seed_releases FROM seed_artists").raw().all() as [
        number,
        number,
      ][],
    );

    const total = new Map<number, number>();
    for await (const release of openReleases()) {
      for (const person of [...release.artists, ...release.credits]) {
        if (!seedArtists.has(person.id)) continue;
        total.set(person.id, (total.get(person.id) ?? 0) + 1);
      }
    }

    for (const [id, appearances] of total) {
      const ratio = (seedWork.get(id) ?? 0) / Math.max(1, appearances);
      if (ratio >= minSeedRatio) continue;
      bridges.delete(id);
      suppressedBridges++;
    }
    options.onPhase?.(
      `measured ${total.size.toLocaleString("en-GB")} seed artists, ` +
        `stood down ${suppressedBridges.toLocaleString("en-GB")} as bridges`,
    );
  }

  const insert = {
    release: db.prepare(
      `INSERT INTO releases (id, title, year, is_seed, channel_a, channel_b)
       VALUES (?, ?, ?, 0, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         channel_a = max(channel_a, excluded.channel_a),
         channel_b = max(channel_b, excluded.channel_b)`,
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
    style: db.prepare(`INSERT OR IGNORE INTO release_styles (release_id, style) VALUES (?, ?)`),
    genre: db.prepare(`INSERT OR IGNORE INTO release_genres (release_id, genre) VALUES (?, ?)`),
    role: db.prepare(
      `INSERT INTO roles_seen (role, occurrences) VALUES (?, 1)
       ON CONFLICT(role) DO UPDATE SET occurrences = occurrences + 1`,
    ),
  };

  /** Channel A tie count and channel B membership, tallied per artist. */
  const tiesA = new Map<number, number>();
  const viaB = new Set<number>();

  let scanned = 0;
  let keptChannelA = 0;
  let keptChannelB = 0;
  let keptBoth = 0;
  let crowdedReleases = 0;

  db.exec("BEGIN");
  try {
    for await (const release of openReleases()) {
      scanned++;

      const people = [...release.artists, ...release.credits].filter(
        (p) => !isPlaceholderArtist(p.id, p.name),
      );
      const labels = release.labels.filter(
        (l) => l.id !== null && !isPlaceholderLabel(l.name),
      );

      const channelA = people.some((p) => bridges.has(p.id));
      const channelB = labels.some((l) => seedLabels.has(l.id!));

      if (channelA && channelB) keptBoth++;
      else if (channelA) keptChannelA++;
      else if (channelB) keptChannelB++;
      else {
        if (scanned % COMMIT_EVERY === 0) db.exec("COMMIT; BEGIN");
        if (options.onProgress && scanned % PROGRESS_EVERY === 0) options.onProgress(scanned);
        continue;
      }

      keep(insert, release, channelA, channelB);

      // A crowded release is shelf proximity, not collaboration, so it admits
      // nobody new through channel A. It is still kept, and everyone already in
      // the corpus still holds their credit on it.
      const crowded = people.length > maxPeopleToAdmit;
      if (crowded) crowdedReleases++;

      for (const person of people) {
        if (channelA && !crowded) tiesA.set(person.id, (tiesA.get(person.id) ?? 0) + 1);
        if (channelB) viaB.add(person.id);
      }

      if (scanned % COMMIT_EVERY === 0) db.exec("COMMIT; BEGIN");
      if (options.onProgress && scanned % PROGRESS_EVERY === 0) options.onProgress(scanned);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    createBulkIndexes(db);
    throw err;
  }

  createBulkIndexes(db);

  const writeCorpus = db.transaction(() => {
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO corpus_artists (artist_id, is_seed, channel_a, channel_b)
       VALUES (?, ?, ?, ?)`,
    );
    // Seed artists are in the corpus by definition, whether or not this pass
    // happened to see them outside a crowded release.
    for (const id of new Set([...seedArtists, ...tiesA.keys(), ...viaB])) {
      // A seed artist is in by definition. Everyone else has to clear the
      // tie-strength dial to count as a collaborator rather than a guest spot.
      const isSeed = seedArtists.has(id);
      const ties = tiesA.get(id) ?? 0;
      const a = ties > 0 && (isSeed || ties >= minTies) ? 1 : 0;
      const b = viaB.has(id) ? 1 : 0;
      if (!isSeed && a === 0 && b === 0) continue;
      stmt.run(id, isSeed ? 1 : 0, a, b);
    }
  });
  writeCorpus();

  const count = (sql: string): number => db.prepare(sql).pluck().get() as number;
  const stats: Pass2Stats = {
    releasesScanned: scanned,
    keptChannelA,
    keptChannelB,
    keptBoth,
    totalKept: keptChannelA + keptChannelB + keptBoth,
    corpusArtists: count("SELECT count(*) FROM corpus_artists"),
    seedArtists: seedArtists.size,
    newArtists: count("SELECT count(*) FROM corpus_artists WHERE is_seed = 0"),
    suppressedBridges,
    crowdedReleases,
  };

  run.finish(stats);
  return stats;
}

type Statements = Record<string, Database.Statement>;

function keep(
  insert: Statements,
  release: ParsedRelease,
  channelA: boolean,
  channelB: boolean,
): void {
  insert.release!.run(release.id, release.title, release.year, channelA ? 1 : 0, channelB ? 1 : 0);

  release.artists.forEach((artist, position) => {
    insert.artist!.run(release.id, position, artist.id, artist.name, artist.joinPhrase);
  });
  release.credits.forEach((credit, position) => {
    insert.credit!.run(release.id, position, credit.id, credit.name, credit.role);
    insert.role!.run(credit.role);
  });
  release.labels.forEach((label, position) => {
    if (label.id === null || isPlaceholderLabel(label.name)) return;
    insert.label!.run(release.id, position, label.id, label.name, label.catno);
  });

  for (const style of release.styles) insert.style!.run(release.id, style);
  for (const genre of release.genres) insert.genre!.run(release.id, genre);
}

/**
 * Clears what pass 2 owns without touching pass 1's seed releases.
 *
 * Pass 1 rows are kept and only have their channel flags reset, so pass 2 can
 * be re-run with different dials without redoing the 17 minute seed pass.
 */
function reset(db: Database.Database): void {
  const wipe = db.transaction(() => {
    for (const table of [
      "release_artists",
      "release_credits",
      "release_labels",
      "release_styles",
      "release_genres",
    ]) {
      db.exec(
        `DELETE FROM ${table} WHERE release_id IN (SELECT id FROM releases WHERE is_seed = 0)`,
      );
    }
    db.exec("DELETE FROM releases WHERE is_seed = 0");
    db.exec("UPDATE releases SET channel_a = 0, channel_b = 0");
    db.exec("DELETE FROM corpus_artists");
  });
  wipe();
}
