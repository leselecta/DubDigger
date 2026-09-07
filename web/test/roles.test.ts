import { test } from "node:test";
import assert from "node:assert/strict";
import { creditLine, rankCredits, summariseRoles } from "../src/lib/roles";

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

test("keeps the role when the qualifier comes first", () => {
  // parts() truncates from the first bracket, which is right for
  // "Engineer [At Basing Street]" and wrong when the qualifier leads: the role
  // is what follows it, and truncating from character zero threw the whole
  // credit away. Found in the dump as "[Type &] Layout", the one stored string
  // in 281,018 that summarised to nothing at all.
  assert.deepEqual(summariseRoles(["[Type &] Layout"]), ["Design"]);
  assert.deepEqual(summariseRoles(["[performer] Guitar"]), ["Guitar"]);
  assert.deepEqual(summariseRoles(["Bass, [Some] Percussion"]), ["Bass", "Percussion"]);
});

test("still says nothing for a qualifier with no role attached to it", () => {
  // The other half of the same shape, and it must stay dropped: a comma split
  // a qualifier away from its role, so there is no work being named here.
  assert.deepEqual(summariseRoles(["Engineer, [mix]"]), ["Engineering"]);
  assert.deepEqual(summariseRoles(["[Pedals]"]), []);
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

/**
 * The order a release page lists its credits in.
 *
 * There is no authorial order to respect: the dump hands them back sorted by
 * role string, so 800% Ndagga opens on two bass players and reaches Mark
 * Ernestus, who produced, engineered and mixed it, at position six of
 * twenty-one. Ranking by how much of the record a person touched is the same
 * rule the rest of the site runs on, and the row shows the reason, since the
 * roles it sorts on are the roles it prints.
 */
test("the person who did most on the record comes first", () => {
  const rows = [
    { name: "Thierno Sarr", roles: ["Bass"] },
    { name: "Mark Ernestus", roles: ["Engineer", "Mixed By", "Producer"] },
    { name: "Laye Lo", roles: ["Drums"] },
  ];
  assert.deepEqual(
    rankCredits(rows).map((r) => r.name),
    ["Mark Ernestus", "Thierno Sarr", "Laye Lo"],
  );
});

test("it counts the roles the row prints, not the strings the dump stored", () => {
  // One stored string can hold several roles, and the collapsing can take
  // several down to one. Sorting on anything but the printed line would put a
  // row holding two roles under a row holding one.
  const rows = [
    { name: "Three strings, one role", roles: ["Engineer", "Engineer [Assistant]", "Engineering"] },
    { name: "One string, two roles", roles: ["Bass, Drums"] },
  ];
  assert.deepEqual(
    rankCredits(rows).map((r) => r.name),
    ["One string, two roles", "Three strings, one role"],
  );
});

test("a tie keeps the order the dump gave", () => {
  const rows = [{ name: "B", roles: ["Bass"] }, { name: "A", roles: ["Drums"] }];
  assert.deepEqual(
    rankCredits(rows).map((r) => r.name),
    ["B", "A"],
  );
});

test("ranking never drops a credit, including one it can name nothing in", () => {
  const rows = [{ name: "A", roles: ["[Pedals]"] }, { name: "B", roles: ["Bass"] }];
  assert.equal(rankCredits(rows).length, 2);
  assert.equal(rankCredits(rows)[0]!.name, "B");
});
