import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalPath, countLine } from "../src/lib/seo";

test("canonicalises a path to the form the site links to", () => {
  assert.equal(canonicalPath("/core-labels"), "/core-labels");
  assert.equal(canonicalPath("/core-labels/"), "/core-labels");
  assert.equal(canonicalPath("/artist/17111///"), "/artist/17111");
});

test("keeps the home page a single slash rather than an empty string", () => {
  assert.equal(canonicalPath("/"), "/");
  assert.equal(canonicalPath(""), "/");
  assert.equal(canonicalPath("///"), "/");
});

test("counts read as a sentence, with the last joined by 'and'", () => {
  assert.equal(
    countLine([
      [43, "collaborator"],
      [12, "label"],
      [96, "release"],
    ]),
    "43 collaborators, 12 labels and 96 releases",
  );
  assert.equal(
    countLine([
      [7, "artist"],
      [21, "release"],
    ]),
    "7 artists and 21 releases",
  );
  assert.equal(countLine([[5, "release"]]), "5 releases");
});

test("says one collaborator rather than 1 collaborators", () => {
  assert.equal(
    countLine([
      [1, "collaborator"],
      [1, "label"],
    ]),
    "1 collaborator and 1 label",
  );
});

test("drops what the corpus does not have rather than printing a zero", () => {
  assert.equal(
    countLine([
      [0, "collaborator"],
      [3, "label"],
      [0, "release"],
    ]),
    "3 labels",
  );
});

test("says nothing at all when there is nothing to count", () => {
  assert.equal(
    countLine([
      [0, "collaborator"],
      [0, "label"],
    ]),
    null,
  );
  assert.equal(countLine([]), null);
});

test("groups the thousands, because a description is prose", () => {
  assert.equal(countLine([[1987, "release"]]), "1,987 releases");
});
