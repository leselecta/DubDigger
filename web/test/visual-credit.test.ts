import test from "node:test";
import assert from "node:assert/strict";
import { visualCraft } from "../src/lib/roles.ts";

/**
 * Who in this corpus made the sleeve rather than the record.
 *
 * The corpus is a music corpus and reads as one, except for the designers and
 * photographers who hold Discogs artist ids like everybody else. A page that
 * calls Timothy Saccenti an artist next to Pole is not wrong about either, and
 * it is unhelpful about both.
 *
 * The markers are the seed rule's own `packagingRoles`, for the reason that
 * rule gives: a photographer is not a musician. This is the same sentence said
 * on the page rather than at the corpus boundary.
 *
 * The two gates that keep it honest are measured in the assertions below: a
 * share floor, because almost everyone has cut a sleeve once, and "never on an
 * artist line", because someone who releases their own records is a musician
 * who also draws.
 */

/* Three of each, since fewer than three is below the floor asserted below. */
const three = (role: string) => [role, role, role];

test("a sleeve is visual work, however the dump spells it", () => {
  assert.equal(visualCraft(three("Photography By"), 0), "photographer");
  assert.equal(visualCraft(["Design", "Artwork", "Design [Sleeve]"], 0), "designer");
  assert.equal(visualCraft(three("Illustration"), 0), "designer");
  assert.equal(visualCraft(three("Sleeve Notes"), 0), "designer");
  assert.equal(visualCraft(three("Layout"), 0), "designer");
  assert.equal(visualCraft(three("Artwork By [Cover]"), 0), "designer");
});

test("liner notes are the designer's, by Simone's call on 2026-09-11", () => {
  assert.equal(visualCraft(["Liner Notes", "Liner Notes", "Liner Notes"], 0), "designer");
});

test("photography wins only when it is most of the visual work", () => {
  assert.equal(visualCraft(["Photography By", "Photography By", "Design"], 0), "photographer");
  assert.equal(visualCraft(["Photography By", "Design", "Artwork"], 0), "designer");
  // A tie is not a majority, so the broader word takes it.
  assert.equal(visualCraft(["Photography By", "Photography By", "Design", "Artwork"], 0), "designer");
});

test("someone who releases their own records is a musician who also draws", () => {
  // Wolfgang Voigt: 47 visual credits, and 124 releases of his own.
  const voigt = Array(47).fill("Artwork");
  assert.equal(visualCraft(voigt, 124), null);
  assert.equal(visualCraft(voigt, 0), "designer");
});

test("a stray sleeve credit does not make an engineer a designer", () => {
  // Pole: one visual credit in 1,047, all the rest mastering and cutting.
  const pole = ["Artwork", ...Array(1046).fill("Mastered By")];
  assert.equal(visualCraft(pole, 0), null);
});

test("too few credits to tell is not an answer", () => {
  assert.equal(visualCraft(["Design", "Design"], 0), null);
  assert.equal(visualCraft([], 0), null);
});
