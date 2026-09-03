/** How many list rows a page shows before "Load more". */
export const PAGE_SIZE = 40;

/**
 * Whether Core Artists shows its sort control. Off for now.
 *
 * It used to gate both Core pages. Core Labels took its control back on
 * 2026-09-03 with three orderings rather than one, so the flag is down to the
 * page that still has the old pair, and the artists list keeps answering
 * `?sort=name` from a hand-typed URL in the meantime. Typed as `boolean` rather
 * than left to infer `false`, or the page that reads it becomes an unreachable
 * branch and the component reads as dead code.
 */
export const SHOW_SORT: boolean = false;

/**
 * How a ranked list can be ordered.
 *
 * `ranking` is the list itself: the top TOP_LIST_SIZE by scene weight, which is
 * what the page is for. Every other key reorders that same set rather than
 * reaching into the corpus alphabetically or by date, so a sort is a different
 * view of one list and never a different list. That is why the default is the
 * bare URL and the others are parameters on it.
 */
export type ListSort = "ranking" | "name" | "releases" | "active";

/** The control's options, in the order it draws them. */
export const LIST_SORTS: { key: ListSort; label: string }[] = [
  { key: "ranking", label: "Ranking" },
  { key: "name", label: "A–Z" },
  /*
   * The two column names verbatim, because the row they reorder is headed
   * "Releases" and "Active" and a control that renamed them would be a second
   * vocabulary for one question. What each does is left to the ordering: an
   * "Earliest" would say the direction and stop matching the column.
   */
  { key: "releases", label: "Releases" },
  { key: "active", label: "Active" },
];

/** Reads the `sort` search param. Anything unrecognised is the default. */
export function listSort(sort: string | null): ListSort {
  return LIST_SORTS.some((s) => s.key === sort) ? (sort as ListSort) : "ranking";
}

/** A list URL. The default sort is the bare path, so one ordering has one address. */
export function listHref(basePath: string, sort: ListSort, show?: number): string {
  const params = new URLSearchParams();
  if (sort !== "ranking") params.set("sort", sort);
  if (show) params.set("show", String(show));
  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * One ranked list, in the order asked for.
 *
 * Structural rather than typed to `TopLabel`, so the ordering can be tested
 * without a database behind it, and so Core Artists can take the same three
 * when its turn comes.
 *
 * Every sort falls back to the name, never to the order the rows arrived in:
 * 47 releases against 47 releases has an answer a reader can predict, and
 * "whatever the ranking said" is not it.
 */
interface Sortable {
  name: string;
  releaseCount: number;
  firstYear: number | null;
  lastYear: number | null;
}

export function sortLabels<T extends Sortable>(labels: readonly T[], sort: ListSort): readonly T[] {
  /* The ranking is the list as built, so it is handed back rather than re-sorted. */
  if (sort === "ranking") return labels;

  const byName = (a: T, b: T) => a.name.localeCompare(b.name);

  if (sort === "name") return [...labels].sort(byName);

  if (sort === "releases") {
    return [...labels].sort((a, b) => b.releaseCount - a.releaseCount || byName(a, b));
  }

  /*
   * Chronological, oldest first, and a label with no years at all goes to the
   * end rather than to 1970. The corpus records a span for a label that has one
   * dated release and nothing for a label that has none, and an empty "Active"
   * cell sorted to the front would read as the oldest label on the site.
   */
  return [...labels].sort((a, b) => {
    if (a.firstYear === null || b.firstYear === null) {
      return (a.firstYear === null ? 1 : 0) - (b.firstYear === null ? 1 : 0) || byName(a, b);
    }
    return a.firstYear - b.firstYear || (a.lastYear ?? 0) - (b.lastYear ?? 0) || byName(a, b);
  });
}

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
