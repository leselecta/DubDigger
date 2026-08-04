import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const ingestRoot = path.resolve(here, "..");

/**
 * Every tunable dial for corpus selection lives here.
 * Change a number, re-run the affected pass, compare the reported counts.
 */

export const paths = {
  /** Downloaded Discogs dumps, kept gzipped. Never decompressed to disk. */
  dumps: path.join(ingestRoot, "data/dumps"),
  /** Small truncated copies of the dumps, for developing against. */
  samples: path.join(ingestRoot, "data/samples"),
  /** Persisted seed sets and role logs — the definitional core of the corpus. */
  artifacts: path.join(ingestRoot, "data/artifacts"),
  /** Raw + derived tables. This file is the ingest working database. */
  db: path.join(ingestRoot, "data/dubdigger.sqlite"),
};

/**
 * Pass 1 seed styles. A release enters the seed if its <styles> intersect this set.
 *
 * Techno is deliberately absent: it is broad enough to dilute the core, and the
 * one-hop expansion in pass 2 already reaches into it via real connections.
 */
export const SEED_STYLES = new Set([
  "Dub Techno",
  "Deep Techno",
  "Dub",
  "Ambient",
  "Minimal",
]);

/**
 * A label becomes a seed label only if BOTH hold. Flat counts alone don't work:
 * a 500-artist label clearing "2+ seed artists" is noise, not signal, so the bar
 * has to scale with roster size.
 */
export const seedLabel = {
  /** Floor: guards against a tiny label qualifying on one coincidence. */
  minSeedArtists: 2,
  /** Ratio: guards against a large label qualifying on a single seed artist. */
  minSeedArtistRatio: 0.05,
};

/**
 * Pass 2 expansion. One hop out, on both channels — never two.
 */
export const expansion = {
  /**
   * Channel A (collaboration) minimum tie strength: admit a non-seed artist only
   * if they appear on at least this many seed-artist releases.
   *
   * Start at 1 (i.e. off). Raise to 2 only if the one-hop corpus comes out too
   * large — it filters one-off guest spots.
   */
  channelAMinSharedReleases: 1,
};

/**
 * Discogs uses placeholder artist entries that must never be treated as people,
 * or they become the most "collaborative" artist in the database by a mile.
 *
 * Verify these IDs against the artists dump before the first full run — the name
 * check below is the real safety net.
 */
export const PLACEHOLDER_ARTIST_IDS = new Set([194]); // "Various"
export const PLACEHOLDER_ARTIST_NAMES = new Set([
  "Various",
  "Unknown Artist",
  "No Artist",
]);

export function isPlaceholderArtist(id: number, name: string): boolean {
  return PLACEHOLDER_ARTIST_IDS.has(id) || PLACEHOLDER_ARTIST_NAMES.has(name.trim());
}

/** Rows to keep when building a development sample from a full dump. */
export const SAMPLE_SIZE = 5000;
