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
