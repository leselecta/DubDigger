import test from "node:test";
import assert from "node:assert/strict";
import { artistLine } from "../src/lib/view";

/**
 * The by-line on a release page, assembled from the dump's join phrases.
 *
 * Discogs stores the phrase on the artist it follows, trimmed: "Raze"
 * "Featuring", "Lady J" "&", "The Secretary Of Entertainment" null. So the
 * spacing is ours to put back, and it is not one rule — "A, B" hugs where
 * "A & B" does not. 45,223 rows carry "&" and 41,335 carry ",", so both of
 * those are the common case rather than an edge.
 */
const raze = [
  { id: 1, name: "Raze", joinPhrase: "Featuring", inCorpus: true },
  { id: 2, name: "Lady J", joinPhrase: "&", inCorpus: false },
  { id: 3, name: "The Secretary Of Entertainment", joinPhrase: null, inCorpus: false },
];

test("a word phrase takes a space on both sides", () => {
  assert.deepEqual(
    artistLine(raze).map((p) => p.separator),
    [" Featuring ", " & ", ""],
  );
});

test("a comma hugs the name before it", () => {
  const line = artistLine([
    { id: 1, name: "Maurizio", joinPhrase: ",", inCorpus: true },
    { id: 2, name: "Vainqueur", joinPhrase: null, inCorpus: true },
  ]);
  assert.deepEqual(
    line.map((p) => p.separator),
    [", ", ""],
  );
});

test("the last name never carries a separator, whatever the dump says", () => {
  // A trailing phrase is in the data and means nothing: there is no next name
  // for it to join to, and printing it leaves the line ending in a dangling "&".
  const line = artistLine([
    { id: 1, name: "Basic Channel", joinPhrase: "&", inCorpus: true },
  ]);
  assert.deepEqual(line, [
    { id: 1, name: "Basic Channel", joinPhrase: "&", inCorpus: true, separator: "" },
  ]);
});

test("an empty phrase is the same as none", () => {
  const line = artistLine([
    { id: 1, name: "A", joinPhrase: "", inCorpus: true },
    { id: 2, name: "B", joinPhrase: null, inCorpus: true },
  ]);
  assert.equal(line[0]!.separator, " ");
});

test("the names come back untouched, in the order given", () => {
  assert.deepEqual(
    artistLine(raze).map((p) => p.name),
    ["Raze", "Lady J", "The Secretary Of Entertainment"],
  );
});

test("nothing in, nothing out", () => {
  assert.deepEqual(artistLine([]), []);
});
