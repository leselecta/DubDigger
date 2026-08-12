/** How many list rows a page shows before "Load more". */
export const PAGE_SIZE = 40;

/**
 * Whether the ranked lists show their sort control. Off for now.
 *
 * Hidden rather than removed, and hidden in one place rather than commented out
 * in two: `SortBy` is untouched, both Core pages still read `?sort=name` and
 * still answer it, so the ordering is one flag away from being back and a
 * hand-typed URL keeps working in the meantime. Typed as `boolean` rather than
 * left to infer `false`, or the pages that read it become unreachable branches
 * and the component reads as dead code.
 */
export const SHOW_SORT: boolean = false;

/** Reads the `show` search param, clamped so a hand-typed URL cannot ask for everything. */
export function pageSize(show: string | undefined): number {
  const asked = Number(show);
  if (!Number.isFinite(asked)) return PAGE_SIZE;
  return Math.min(Math.max(PAGE_SIZE, Math.floor(asked)), 1000);
}

/**
 * A share as a percentage, floored at "<1%" rather than rounded to zero.
 *
 * Seed counts are now reported for everyone rather than only for scene members,
 * so tiny shares reach the page: the Spice Girls really are on 6 seed releases,
 * out of 1,970. "0% of output" next to a count of 6 reads as a broken figure,
 * where "<1%" reads as the answer it is.
 */
export function percent(share: number): string {
  const pct = Math.round(share * 100);
  return pct === 0 && share > 0 ? "<1%" : `${pct}%`;
}

/** A year span, collapsed when both ends are the same year. */
export function years(from: number | null, to: number | null): string {
  if (!from && !to) return "";
  if (from === to) return String(from);
  return `${from ?? "?"} – ${to ?? "?"}`;
}
