/**
 * Deciding whether the cached seed artist totals can still be trusted.
 *
 * `measure-seed` caches a full scan of the releases dump so thresholds can be
 * tried repeatedly without re-reading 10.4 GB. The cache used to be reused
 * whenever it was non-empty, which is wrong in two ways that both fail quietly:
 *
 * A newer dump makes every total obsolete, and pass 1 does not clear the cache,
 * so a rebuild against next month's data would report tuning figures computed
 * from last month's.
 *
 * Re-running pass 1 with different dials changes the seed set on the same dump.
 * Every query in measure-seed inner joins the cache, so seed artists it does not
 * cover are dropped from the analysis rather than counted as missing, and the
 * band percentages come out confidently wrong.
 *
 * Wrong numbers are worse than a slow scan, especially here: the only reason to
 * run this is to decide where a threshold goes.
 */

export interface TotalsCacheState {
  /** Rows currently in seed_artist_totals. */
  cached: number;
  /** The dump the cache was built from. Null if it predates this record. */
  builtFrom: string | null;
  /** Newest releases dump on disk, or null if there is none. */
  dumpOnDisk: string | null;
  /** Current seed artists with no cached total. */
  uncovered: number;
}

export type CacheVerdict =
  | { action: "rescan"; why: string }
  | { action: "reuse"; warning: string | null };

export function judgeTotalsCache(state: TotalsCacheState, forced = false): CacheVerdict {
  const { cached, builtFrom, dumpOnDisk, uncovered } = state;

  if (forced) return { action: "rescan", why: "asked for with --rescan" };
  if (cached === 0) return { action: "rescan", why: "nothing cached yet" };

  // Nothing to rescan from. Say what the numbers rest on and let it through,
  // since refusing would leave no way to read a cache that may well be current.
  if (dumpOnDisk === null) {
    return {
      action: "reuse",
      warning:
        `no releases dump on disk, so this cannot be checked against one. ` +
        `The cache was built from ${builtFrom ?? "an unrecorded dump"}.`,
    };
  }

  if (builtFrom === null) {
    return { action: "rescan", why: "the cache does not record which dump it came from" };
  }
  if (builtFrom !== dumpOnDisk) {
    return { action: "rescan", why: `cache is from ${builtFrom}, the dump on disk is ${dumpOnDisk}` };
  }
  if (uncovered > 0) {
    return {
      action: "rescan",
      why: `${uncovered.toLocaleString("en-GB")} seed artists have no cached total, so pass 1 has run with different dials since`,
    };
  }

  return { action: "reuse", warning: null };
}
