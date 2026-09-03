import test from "node:test";
import assert from "node:assert/strict";
import { listHref, listSort, sortLabels } from "../src/lib/view";

/**
 * The Core Labels ordering.
 *
 * The list itself is the top TOP_LIST_SIZE by scene weight, so every one of
 * these reorders that same set rather than reaching into the corpus. That is
 * the property worth pinning: a sort is a different view of one list, never a
 * different list.
 */
const labels = [
  { name: "Chain Reaction", releaseCount: 196, firstYear: 1993, lastYear: 2019 },
  { name: "basic_sounds", releaseCount: 3, firstYear: 2011, lastYear: 2011 },
  { name: "Échos", releaseCount: 47, firstYear: 1989, lastYear: 2015 },
  { name: "Echocord", releaseCount: 288, firstYear: 2004, lastYear: 2024 },
  { name: "Unheard", releaseCount: 47, firstYear: null, lastYear: null },
];

const names = (sort: Parameters<typeof sortLabels>[1]) =>
  sortLabels(labels, sort).map((l) => l.name);

test("the default is the ranking, handed back untouched", () => {
  assert.deepEqual(names("ranking"), labels.map((l) => l.name));
  assert.equal(sortLabels(labels, "ranking"), labels);
});

test("A–Z reads as a person reads, not as ASCII does", () => {
  // "basic_sounds" belongs under B and "Échos" under E, which a codepoint
  // sort puts at either end of the list.
  assert.deepEqual(names("name"), [
    "basic_sounds",
    "Chain Reaction",
    "Echocord",
    "Échos",
    "Unheard",
  ]);
});

test("releases counts down, because the question is which label has the most", () => {
  assert.deepEqual(names("releases"), [
    "Echocord",
    "Chain Reaction",
    "Échos",
    "Unheard",
    "basic_sounds",
  ]);
});

test("a tie on the count falls back to the name rather than to input order", () => {
  // Échos and Unheard both have 47.
  const order = names("releases");
  assert.ok(order.indexOf("Échos") < order.indexOf("Unheard"));
});

test("active runs chronologically, oldest first", () => {
  assert.deepEqual(names("active").slice(0, 4), [
    "Échos",
    "Chain Reaction",
    "Echocord",
    "basic_sounds",
  ]);
});

test("a label with no years cannot be placed on a timeline, so it sorts last", () => {
  assert.equal(names("active").at(-1), "Unheard");
});

test("sorting never drops or invents a row", () => {
  for (const sort of ["ranking", "name", "releases", "active"] as const) {
    assert.equal(sortLabels(labels, sort).length, labels.length);
    assert.deepEqual([...names(sort)].sort(), [...labels.map((l) => l.name)].sort());
  }
});

test("an unknown or absent sort is the default, not an error", () => {
  assert.equal(listSort("name"), "name");
  assert.equal(listSort("releases"), "releases");
  assert.equal(listSort("active"), "active");
  assert.equal(listSort(null), "ranking");
  assert.equal(listSort("rank"), "ranking");
  assert.equal(listSort("DROP TABLE"), "ranking");
});

test("the default sort is the bare path, never a parameter", () => {
  assert.equal(listHref("/core-labels", "ranking"), "/core-labels");
  assert.equal(listHref("/core-labels", "name"), "/core-labels?sort=name");
});

test("paging carries the sort, and the default still leaves it out", () => {
  assert.equal(listHref("/core-labels", "ranking", 80), "/core-labels?show=80");
  assert.equal(listHref("/core-labels", "active", 80), "/core-labels?sort=active&show=80");
});
