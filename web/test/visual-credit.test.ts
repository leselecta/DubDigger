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

/* Three of each, comfortably clear of the two-credit floor asserted below. */
const three = (role: string) => [role, role, role];

test("a sleeve is visual work, however the dump spells it", () => {
  assert.equal(visualCraft(three("Photography By"), 0), "photographer");
  assert.equal(visualCraft(["Design", "Artwork", "Design [Sleeve]"], 0), "designer");
  assert.equal(visualCraft(three("Illustration"), 0), "designer");
  assert.equal(visualCraft(three("Sleeve Notes"), 0), "writer");
  assert.equal(visualCraft(three("Layout"), 0), "designer");
  assert.equal(visualCraft(three("Artwork By [Cover]"), 0), "designer");
});

test("liner notes are packaging, and the person who wrote them is a writer", () => {
  assert.equal(visualCraft(["Liner Notes", "Liner Notes", "Liner Notes"], 0), "writer");
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

test("two credits pointing one way is enough, one is not", () => {
  /*
   * Monir Pourataei, the case that set the floor at two. One design credit and
   * one photography credit is a tie, and a tie takes the broader word, so he
   * reads designer rather than photographer.
   */
  assert.equal(
    visualCraft(["Design Concept [Visuelles Konzept & Cover Idee]", "Photography By [Alle Fotos]"], 0),
    "designer",
  );
  assert.equal(visualCraft(["Design", "Design"], 0), "designer");
  assert.equal(visualCraft(["Design"], 0), null);
  assert.equal(visualCraft([], 0), null);
});

test("the sleeve words the seed rule's list misses are visual too", () => {
  // Found by reading the commonest unmatched roles on mostly-visual people.
  assert.equal(visualCraft(three("Cover"), 0), "designer");
  assert.equal(visualCraft(three("Art Direction"), 0), "designer");
  assert.equal(visualCraft(three("Graphics"), 0), "designer");
  assert.equal(visualCraft(three("Painting"), 0), "designer");
  assert.equal(visualCraft(three("Typography"), 0), "designer");
  assert.equal(visualCraft(three("Creative Director"), 0), "designer");
});

test("John Harten, the case that found them", () => {
  /*
   * 64 credits, 49 matched by the seed rule's list alone, which is 76.6% and
   * just under the floor. Cover and Graphics are the difference, and he is a
   * sleeve designer either way.
   */
  const harten = [
    ...Array(20).fill("Artwork"), ...Array(11).fill("Design"),
    ...Array(5).fill("Layout"), ...Array(5).fill("Cover"),
    ...Array(4).fill("Artwork, Photography By"), "Layout, Design",
    ...Array(2).fill("Graphics"),
    ...Array(3).fill("Written-By"), ...Array(3).fill("Performer"),
    ...Array(2).fill("Band [Cologne Tape]"),
  ];
  assert.equal(visualCraft(harten, 0), "designer");
});

test("a sleeve note is packaging, but the person who wrote it is a writer", () => {
  assert.equal(visualCraft(three("Liner Notes"), 0), "writer");
  assert.equal(visualCraft(three("Sleeve Notes"), 0), "writer");
  // "Sleeve" is a marker on its own, and a sleeve design is not writing.
  assert.equal(visualCraft(three("Design [Sleeve]"), 0), "designer");
});

test("notes are asked before photography, so a writer is never a designer", () => {
  assert.equal(visualCraft(["Liner Notes", "Liner Notes", "Photography By"], 0), "writer");
  assert.equal(visualCraft(["Liner Notes", "Photography By", "Photography By"], 0), "photographer");
});

test("a sleeve-note writer is reachable even with lyrics beside the notes", () => {
  /*
   * Naomi Klein: four sleeve notes, two lyrics, no releases of her own. She is
   * 4 of 6 on the share test and under the floor, so the writer path is the
   * only way to her.
   */
  const klein = [
    "Liner Notes", "Lyrics By", "Lyrics By",
    "Liner Notes [Carnet De Viajes - Preface]", "Sleeve Notes",
    "Liner Notes [Carnet De Viajes - Preface]",
  ];
  assert.equal(visualCraft(klein, 0), "writer");
});

test("a songwriter with a couple of sleeve notes is not a writer", () => {
  // Fifty lyrics against two notes: more other text than notes, so no label.
  const songwriter = [...Array(50).fill("Lyrics By"), "Liner Notes", "Sleeve Notes"];
  assert.equal(visualCraft(songwriter, 0), null);
});

test("one music credit is enough to close the writer path", () => {
  assert.equal(visualCraft(["Liner Notes", "Liner Notes", "Lyrics By"], 0), "writer");
  assert.equal(visualCraft(["Liner Notes", "Liner Notes", "Lyrics By", "Guitar"], 0), null);
});

test("the writer path never reaches the other two words", () => {
  // All-photography stays photographer; the path only ever returns "writer".
  assert.equal(visualCraft(three("Photography By"), 0), "photographer");
  assert.equal(visualCraft(three("Design"), 0), "designer");
});
