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

/**
 * The colour a grade reads in, wherever a grade is shown.
 *
 * The shade tracks the grade rather than the fact of being graded. Accenting
 * anything that carried a grade meant an artist reading "low" was highlighted
 * while a label reading "Low" was not, which is the opposite of what the colour
 * should say.
 *
 * The accent covers the top two grades, not just the top one. This is scanned
 * rather than read, and what a digger is scanning for is the near half of the
 * scale. Two of five is where the boundary sits: it was high and medium against
 * a four-step scale, and the fifth step took the top of medium up into high
 * rather than adding a colour. Accenting three of five would be over half the
 * scale, which is the point at which a mark stops marking.
 *
 * Below the boundary the three quiet greys do the work, one step each, in the
 * order the ramp already runs. That is why the scale is five words and not six:
 * two accented steps plus the ramp is exactly what the tokens have.
 */
export const GRADE_SHADE: Record<string, string> = {
  "very high": "text-accent",
  high: "text-accent",
  medium: "text-ink-muted",
  low: "text-ink-dim",
  "very low": "text-ink-faint",
};

/**
 * A grade as a reader sees it.
 *
 * "none" is a grade, not a missing one, and reads as the bottom step: an artist
 * with no seed work at all is not the same as one with a single record in it,
 * so they read "very low" rather than being folded into the "low" above them.
 */
export function gradeWord(relevance: string): string {
  return relevance === "none" ? "very low" : relevance;
}

/**
 * The same grade with both words capitalised, for the places it opens a line.
 *
 * Written out rather than left to a CSS `capitalize`, which only ever ran on
 * the branches that had the class: the top step read "Very High" and the
 * ungraded branch printed a literal "Very low", so one scale carried two
 * casings at its two ends.
 */
export function gradeTitle(relevance: string): string {
  return gradeWord(relevance).replace(/\b\w/g, (c) => c.toUpperCase());
}
