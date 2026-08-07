/**
 * Acceptance check for the corpus, in the terms a digger would judge it by.
 *
 *   npm run check-corpus --workspace ingest
 *
 * Every dial in this project was tuned against named acts and labels rather
 * than against a curve, so those names are the real test suite for the data.
 * The unit tests prove the rules do what they say; this proves the rules were
 * the right ones.
 *
 * Exits non-zero if anything is on the wrong side, so a rebuild cannot quietly
 * regress the scene while the counts still look plausible.
 */
import { openDbReadOnly } from "../db/open.ts";

/** Labels that define the scene, or are close enough that losing them is a bug. */
const LABELS_IN = [
  "Chain Reaction",
  "Basic Channel",
  "Burial Mix",
  "Main Street Records",
  "Echocord",
  "Styrax Leaves",
  "echospace [detroit]",
  "Workshop",
  "Purple Print",
  "Moonshine Recordings",
  "Ostgut Ton",
  "Kompakt",
  "Tresor",
  "Modern Love",
];

/** Budget compilation and licensing outfits that only ever looked like scene labels. */
const LABELS_OUT = [
  "Sonotec",
  "E L M",
  "Top De Luxe",
  "ARISA",
  "Stoned Records",
  "Stars Vintage",
  // 23 scene artists of 147, so 16%: electronic, but a different scene.
  "Moonshine Music",
];

/**
 * Purpose Maker is deliberately absent. It is Jeff Mills' own imprint, a one
 * artist label, and seed label status only governs channel B, which admits
 * label mates. A one artist label has none. Mills is a seed artist doing 17.1%
 * of his work here, so he bridges and his catalogue arrives through channel A.
 */

/** People the tool exists to surface. */
const ARTISTS_IN = [
  "Basic Channel",
  "Moritz von Oswald",
  "Mark Ernestus",
  "Maurizio",
  "Vainqueur",
  "Rhythm & Sound",
  "Porter Ricks",
  "Massive Attack",
  "The Clash",
];

/**
 * What a sceptic types to see whether the tool is serious.
 *
 * These must not be CORE. They are allowed to be present as one hop
 * neighbours, because they genuinely are: each remaining route is a real
 * credit on a real record that really does credit someone in the scene.
 *
 * Three rules cut them hard, Mozart from 248 corpus releases to 85 and
 * Beethoven from 159 to 70, but one hop expansion is permissive by design and
 * a fourth rule would start cutting real neighbours to chase a shrinking tail.
 * The interface carries the distinction instead: core, collaborator, label
 * mate. Being visibly peripheral is honest. Being absent would be a lie about
 * what the data says.
 */
/**
 * People the tool should rank as the answer, not as a neighbour.
 *
 * These pin the relevance dials the way the lists above pin the corpus ones.
 * Jeff Mills is the boundary case at 15.4% of his output in the seed, which is
 * what put the high threshold at 15% rather than 20%; if a rebuild drops him to
 * medium the dial has drifted away from the act it was set by.
 */
const ARTISTS_HIGH = [
  "Basic Channel",
  "Rhythm & Sound",
  "Maurizio",
  "Vainqueur",
  "Moritz von Oswald",
  "Monolake",
  "Porter Ricks",
  "Jeff Mills",
];

const ARTISTS_NOT_CORE = [
  "Wolfgang Amadeus Mozart",
  "Ludwig van Beethoven",
  "The Beatles",
  "Lady Gaga",
  "Spice Girls",
  "Iron Maiden",
  "Black Sabbath",
  "Manowar",
  "Frank Sinatra",
  "Elvis Presley",
];

/**
 * The tradition dub techno came out of, which the scene measure cannot see.
 *
 * These are the names that made the lineage rule necessary: on relevance alone
 * King Tubby reads exactly as the Spice Girls do, because his catalogue is Dub
 * on genre Reggae and the seed only admits Dub on genre Electronic.
 */
const ARTISTS_ROOTS_DUB = [
  "King Tubby",
  "Scientist",
  "Prince Jammy",
  "Augustus Pablo",
  "Jah Shaka",
  "Yabby You",
  "Errol Thompson",
  "The Roots Radics",
  // Already high on relevance. The tag is additive, never a promotion.
  "Rhythm & Sound",
];

/**
 * Neighbours who are not ancestors, and must not pick the tag up.
 *
 * The afrobeat and new-jazz names are here because they were the other half of
 * the question: they read very low too, and unlike the dub names that is the
 * right answer. Nothing makes them upstream of this scene.
 */
const ARTISTS_NOT_ROOTS_DUB = [
  "Fela Kuti",
  "Antibalas",
  "Shabaka Hutchings",
  "Sun Ra",
  "Madonna",
  "Spice Girls",
  "Björk",
  "Depeche Mode",
  "Wolfgang Amadeus Mozart",
  "Basic Channel",
];

const db = openDbReadOnly();
let failures = 0;

const isSeedLabel = db.prepare(
  `SELECT count(*) FROM labels l JOIN seed_labels s ON s.label_id = l.id WHERE l.name = ?`,
);
const inCorpus = db.prepare(
  `SELECT count(*) FROM artists a JOIN corpus_artists m ON m.artist_id = a.id WHERE a.name = ?`,
);
const isCore = db.prepare(
  `SELECT count(*) FROM artists a JOIN corpus_artists m ON m.artist_id = a.id
    WHERE a.name = ? AND m.is_seed = 1`,
);
const isHigh = db.prepare(
  `SELECT count(*) FROM artists a JOIN artist_coverage c ON c.artist_id = a.id
    WHERE a.name = ? AND c.relevance = 'high'`,
);
const isRootsDub = db.prepare(
  `SELECT count(*) FROM artists a JOIN artist_coverage c ON c.artist_id = a.id
    WHERE a.name = ? AND c.lineage = 'roots dub'`,
);

function check(kind: string, name: string, want: boolean, got: number) {
  const ok = want ? got > 0 : got === 0;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${kind.padEnd(6)} ${name.padEnd(26)}` +
      `${want ? "expected  " : "must not be"}  ${got > 0 ? "yes" : "no"}`,
  );
}

console.log("Seed labels\n");
for (const name of LABELS_IN) check("label", name, true, isSeedLabel.pluck().get(name) as number);
console.log();
for (const name of LABELS_OUT) check("label", name, false, isSeedLabel.pluck().get(name) as number);

console.log("\nCorpus artists\n");
for (const name of ARTISTS_IN) check("artist", name, true, inCorpus.pluck().get(name) as number);
console.log();
for (const name of ARTISTS_NOT_CORE) {
  check("artist", name, false, isCore.pluck().get(name) as number);
}

console.log("\nHigh relevance\n");
for (const name of ARTISTS_HIGH) check("artist", name, true, isHigh.pluck().get(name) as number);
console.log();
for (const name of ARTISTS_NOT_CORE) {
  check("artist", name, false, isHigh.pluck().get(name) as number);
}

console.log("\nRoots dub lineage\n");
for (const name of ARTISTS_ROOTS_DUB) {
  check("artist", name, true, isRootsDub.pluck().get(name) as number);
}
console.log();
for (const name of ARTISTS_NOT_ROOTS_DUB) {
  check("artist", name, false, isRootsDub.pluck().get(name) as number);
}

console.log(
  failures === 0
    ? "\nAll good.\n"
    : `\n${failures} on the wrong side of the line.\n`,
);
process.exit(failures === 0 ? 0 : 1);
