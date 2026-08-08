import { test } from "node:test";
import assert from "node:assert/strict";
import { creditLine, summariseRoles } from "../src/lib/roles";

test("names a role the way a person would say it", () => {
  assert.deepEqual(summariseRoles(["Producer"]), ["Production"]);
  assert.deepEqual(summariseRoles(["Arranged By"]), ["Arrangement"]);
  assert.deepEqual(summariseRoles(["Written-By"]), ["Writing"]);
  assert.deepEqual(summariseRoles(["Mastered By"]), ["Mastering"]);
});

test("reads the variants Discogs spells differently as one role", () => {
  const forms = ["Producer", "Produced By", "Producer [Produced By]", "Co-producer"];
  assert.deepEqual(summariseRoles(forms), ["Production"]);
  assert.deepEqual(summariseRoles(["Written-By", "Written By", "Songwriter"]), ["Writing"]);
});

test("drops the bracketed qualifier that makes every credit unique", () => {
  const raw = [
    "Engineer [Additional Engineering]",
    "Engineer [At Basing Street Studios]",
    "Engineer [Engineered By]",
  ];
  assert.deepEqual(summariseRoles(raw), ["Engineering"]);
});

test("splits a combined credit, and not on a comma inside brackets", () => {
  assert.deepEqual(summariseRoles(["Guitar, Bass, Keyboards"]), ["Guitar", "Bass", "Keyboards"]);
  assert.deepEqual(summariseRoles(["Engineer [Sigma Sound, New York]"]), ["Engineering"]);
});

test("states a role once, however many times it was credited", () => {
  const raw = [
    "Producer",
    "Producer, Written-By",
    "Written-By, Mixed By",
    "Producer [Produced By], Songwriter",
  ];
  assert.deepEqual(summariseRoles(raw), ["Production", "Writing", "Mixing"]);
});

test("puts authorship first, playing next, and the sleeve last", () => {
  const raw = ["Design", "Guitar", "Management", "Producer", "Mixed By"];
  assert.deepEqual(summariseRoles(raw), [
    "Production",
    "Mixing",
    "Guitar",
    "Design",
    "Management",
  ]);
});

test("keeps a role it has no name for rather than dropping it", () => {
  assert.deepEqual(summariseRoles(["Producer", "Ondes Martenot"]), ["Production", "Ondes Martenot"]);
});

test("keeps the whole list, however long it collapses to", () => {
  const raw = ["Producer, Written-By, Mixed By, Guitar, Bass, Drums, Design, Management"];
  assert.equal(
    creditLine(raw),
    "Production · Writing · Mixing · Guitar · Bass · Drums · Design · Management",
  );
});

test("says nothing when there is nothing credited", () => {
  assert.deepEqual(summariseRoles([]), []);
  assert.equal(creditLine([""]), "");
});
