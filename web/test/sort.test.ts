import test from "node:test";
import assert from "node:assert/strict";
import { listHref, listSort, sortList } from "../src/lib/view";

/**
 * The ordering on the two Core pages.
 *
 * The list itself is the top TOP_LIST_SIZE by scene weight, so A–Z reorders
 * that same set rather than reaching alphabetically into the corpus. That is
 * the property worth pinning: a sort is a different view of one list, never a
 * different list.
 */
const rows = [
  { name: "Chain Reaction" },
  { name: "basic_sounds" },
  { name: "Échos" },
  { name: "Echocord" },
  { name: "Unheard" },
];

test("the default is the ranking, handed back untouched", () => {
  assert.equal(sortList(rows, "ranking"), rows);
});

test("A–Z reads as a person reads, not as ASCII does", () => {
  // "basic_sounds" belongs under B and "Échos" under E, which a codepoint
  // sort puts at either end of the list.
  assert.deepEqual(
    sortList(rows, "name").map((r) => r.name),
    ["basic_sounds", "Chain Reaction", "Echocord", "Échos", "Unheard"],
  );
});

test("sorting never drops or invents a row", () => {
  const sorted = sortList(rows, "name");
  assert.equal(sorted.length, rows.length);
  assert.deepEqual(
    sorted.map((r) => r.name).sort(),
    rows.map((r) => r.name).sort(),
  );
});

test("an unknown or absent sort is the default, not an error", () => {
  assert.equal(listSort("name"), "name");
  assert.equal(listSort(null), "ranking");
  assert.equal(listSort("rank"), "ranking");
  assert.equal(listSort("DROP TABLE"), "ranking");
});

test("an ordering that was tried and dropped reads as the default, not as itself", () => {
  // Core Labels carried `releases` and `active` for a day. A URL from then
  // still resolves, to the list as the page builds it.
  assert.equal(listSort("releases"), "ranking");
  assert.equal(listSort("active"), "ranking");
});

test("the default sort is the bare path, never a parameter", () => {
  assert.equal(listHref("/core-labels", "ranking"), "/core-labels");
  assert.equal(listHref("/core-labels", "name"), "/core-labels?sort=name");
});

test("paging carries the sort, and the default still leaves it out", () => {
  assert.equal(listHref("/core-artists", "ranking", 80), "/core-artists?show=80");
  assert.equal(listHref("/core-artists", "name", 80), "/core-artists?sort=name&show=80");
});
