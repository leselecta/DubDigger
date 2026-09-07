/** How many list rows a page shows before "Load more". */
export const PAGE_SIZE = 40;

/**
 * How a ranked list can be ordered.
 *
 * `ranking` is the list itself: the top TOP_LIST_SIZE by scene weight, which is
 * what the page is for. A–Z reorders that same set rather than reaching
 * alphabetically into the corpus, so a sort is a different view of one list and
 * never a different list. That is why the default is the bare URL and the other
 * is a parameter on it.
 *
 * It was four for a day on 2026-09-03, releases and active alongside these two,
 * taking the two column headings verbatim. Both worked and both were dropped
 * the same day: the page's whole claim is that it ranks by scene weight, and an
 * ordering by raw catalogue size answers a question the list is not the answer
 * to. Sorting Core Labels by releases put Virgin, Warp and Mute on top of it,
 * which is a true statement about those 808 rows and a misleading one about the
 * page they are on. A–Z earns its place by being a way of FINDING a name in a
 * ranked list rather than a second opinion about the ranking.
 */
export type ListSort = "ranking" | "name";

/** The control's cells, in the order it draws them. */
export const LIST_SORTS: { key: ListSort; label: string }[] = [
  { key: "ranking", label: "Ranking" },
  { key: "name", label: "A–Z" },
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
 * Takes anything with a name, so both Core pages sort through it and the
 * ordering can be tested without a database behind it.
 */
export function sortList<T extends { name: string }>(
  rows: readonly T[],
  sort: ListSort,
): readonly T[] {
  /* The ranking is the list as built, so it is handed back rather than re-sorted. */
  return sort === "name" ? [...rows].sort((a, b) => a.name.localeCompare(b.name)) : rows;
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

export interface LineArtist {
  id: number;
  name: string;
  /** The phrase that joins this name to the next, as the dump stores it. */
  joinPhrase: string | null;
  /** Whether there is a page to pivot to. */
  inCorpus: boolean;
}

/**
 * What joins two names on a release's artist line.
 *
 * The dump stores the phrase trimmed, on the artist it follows, so the spacing
 * is ours to put back and it is not one rule: "Maurizio, Vainqueur" hugs the
 * name before it where "Rhythm & Sound" does not. Only a comma and a semicolon
 * behave that way; "/" and "+" are read as words here and take air on both
 * sides, which is how Discogs prints them too.
 *
 * An empty phrase still separates two names, so it comes back as a space
 * rather than as nothing: two names run together are a third name.
 */
function separator(phrase: string | null): string {
  const joint = (phrase ?? "").trim();
  if (joint === "") return " ";
  return /^[,;]$/.test(joint) ? `${joint} ` : ` ${joint} `;
}

/**
 * A release's artist line, with the text between the names worked out.
 *
 * Separate from the rendering because each name is a link or a chip depending
 * on whether the corpus holds a page for it, so the page needs the parts rather
 * than a finished string.
 *
 * The last name never carries a separator, whatever the dump says. A trailing
 * phrase is in the data, and printing it ends the line on a dangling "&".
 */
export function artistLine<T extends LineArtist>(artists: readonly T[]): (T & { separator: string })[] {
  return artists.map((artist, i) => ({
    ...artist,
    separator: i === artists.length - 1 ? "" : separator(artist.joinPhrase),
  }));
}

export interface ReleaseFormat {
  name: string;
  qty: number;
  text: string | null;
  descriptions: string[];
}

/**
 * The carrier as a line: "2× Vinyl, 12\", 45 RPM + CD, Album".
 *
 * Ingest stores the parts and this writes the sentence, so the wording is a
 * code change rather than a re-ingest — the same split the role vocabulary
 * runs on. The order is Discogs' own and it is also the order a digger reads
 * in: what it is, how big and how fast, then anything odd about the pressing.
 *
 * A record issued on two carriers at once is one release with two formats, so
 * the two are joined rather than one of them being picked.
 */
export function formatLine(formats: readonly ReleaseFormat[]): string | null {
  const lines = formats
    .map((f) => {
      const head = f.name.trim();
      if (!head) return "";
      const parts = [f.qty > 1 ? `${f.qty}× ${head}` : head, ...f.descriptions];
      if (f.text) parts.push(f.text);
      return parts.filter(Boolean).join(", ");
    })
    .filter(Boolean);

  return lines.length > 0 ? lines.join(" + ") : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * As much of the release date as the dump actually has.
 *
 * Discogs writes "2019-01-25", "1994-03-00" and "1996", and on the sample only
 * 31% of dated records carry a full date. So each shape prints as itself and
 * nothing is padded: a record dated 1996 must never read "1 Jan 1996", which
 * would be the interface inventing a day nobody entered.
 *
 * The month and day are checked rather than trusted. The field is
 * contributor-entered and "2019-13-01" is in there; falling back to the part
 * that is still true says less and says nothing wrong.
 */
export function releasedOn(raw: string | null): string | null {
  const value = (raw ?? "").trim();
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/.exec(value);
  if (!match) return null;

  const year = match[1]!;
  const month = Number(match[2] ?? 0);
  const day = Number(match[3] ?? 0);

  if (month < 1 || month > 12) return year;
  if (day < 1 || day > 31) return `${MONTHS[month - 1]} ${year}`;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}
