/**
 * The two pieces of the metadata that are worth testing on their own.
 *
 * Everything else a crawler reads is assembled in Base.astro, where the values
 * are to hand. These two are here because they are pure string work with edge
 * cases: a canonical that disagrees with the link that reached it splits one
 * page into two in an index, and a description is published copy.
 */

/**
 * The one URL a page answers to, as a path.
 *
 * Every list on the site carries its state in the query string — `?tab=`,
 * `?sort=`, `?show=`, `?q=` — which is what makes each view a real address, and
 * it also means one page has an unbounded number of them. Dropping the query
 * is therefore the point of this function rather than a detail of it: the tabs
 * are the same page answering the same question, and the canonical says so.
 *
 * Trailing slashes go too, because the site links to `/core-labels` and a
 * canonical of `/core-labels/` would nominate an address nothing points at.
 */
export function canonicalPath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

/**
 * What a page holds, counted, for its description.
 *
 * Zeros are dropped rather than printed, and everything falls back to null when
 * there is nothing to count, because "0 collaborators, 0 labels" in a search
 * result is the empty answer dressed as a positive one. The caller says what to
 * write instead, the same way the pages themselves do.
 *
 * Plurals are the plain English ones: every noun this is called with takes an
 * `s`, and a table of irregulars would be four lines guarding against a word
 * nobody passes.
 */
export function countLine(parts: [count: number, singular: string][]): string | null {
  const said = parts
    .filter(([count]) => count > 0)
    .map(([count, singular]) => `${count.toLocaleString("en-GB")} ${singular}${count === 1 ? "" : "s"}`);

  const last = said.at(-1);
  if (last === undefined) return null;
  if (said.length === 1) return last;

  return `${said.slice(0, -1).join(", ")} and ${last}`;
}
