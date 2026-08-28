/**
 * The column widths for the tables inside the tabs, shared by the header row
 * and every row under it so the columns line up down the page.
 *
 * Anything long, roles in particular, wraps under the name in the first column
 * rather than being squeezed into one of the narrow ones: Juan Atkins holds
 * fourteen distinct role strings on Moritz von Oswald's records.
 */
export const LIST_GRID = "grid-cols-[1fr_5rem] md:grid-cols-[1fr_6rem_10rem]";

/**
 * The same table with the count column dropped, for a list whose count does not
 * yet say plainly enough what it counts. Below `md` the count was the only
 * thing beside the name, so the row is a single column and the meta goes on
 * folding under the title; from `md` up the meta keeps its own width and the
 * name takes the space the count gave back.
 */
export const LIST_GRID_NO_COUNT = "grid-cols-1 md:grid-cols-[1fr_10rem]";

/**
 * The same table with the meta column dropped, for a list that counts something
 * and has nothing to say beside it. The collaborators tab is the only one: it
 * ranks people by shared releases and there is no year span or catalogue number
 * to follow. Without this the row kept the 10rem third column, empty, and the
 * count sat marooned 16rem short of the right edge under a heading wrapped onto
 * two lines.
 *
 * The count takes the full trailing width rather than staying 6rem, so the
 * column ends where every other tab's last column ends and "Releases together"
 * fits on one line.
 */
export const LIST_GRID_NO_META = "grid-cols-[1fr_5rem] md:grid-cols-[1fr_10rem]";

/**
 * Which of the three a row wants. Both the header and the rows under it call
 * this, because a header that reserved a column the rows did not is exactly the
 * bug above.
 */
export function listGrid(hasCount: boolean, hasMeta: boolean): string {
  if (hasCount && hasMeta) return LIST_GRID;
  if (hasCount) return LIST_GRID_NO_META;
  if (hasMeta) return LIST_GRID_NO_COUNT;
  return "grid-cols-1";
}
