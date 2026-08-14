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
 * Traditions the scene measure cannot see, and the tag each must carry.
 *
 * These are the names that made the lineage rules necessary: on scene work
 * alone King Tubby and Underground Resistance both read exactly as the Spice
 * Girls do, one because his catalogue is Dub on genre Reggae and the seed only
 * admits Dub on genre Electronic, the other because Techno was kept out of the
 * seed for being too broad.
 */
const ARTISTS_LINEAGE: [name: string, tradition: string][] = [
  ["King Tubby", "roots dub"],
  ["Scientist", "roots dub"],
  ["Prince Jammy", "roots dub"],
  ["Augustus Pablo", "roots dub"],
  ["Jah Shaka", "roots dub"],
  ["Yabby You", "roots dub"],
  ["Errol Thompson", "roots dub"],
  ["The Roots Radics", "roots dub"],
  // Already high on scene work. A tradition describes, it does not promote.
  ["Rhythm & Sound", "roots dub"],
  ["Fela Kuti", "afrobeat"],
  ["Antibalas", "afrobeat"],
  ["Underground Resistance", "detroit techno"],
  ["Rhythim Is Rhythim", "detroit techno"],
  ["Kevin Saunderson", "detroit techno"],
  ["Octave One", "detroit techno"],
  ["Theo Parrish", "detroit techno"],
  ["Gilles Peterson", "uk jazz"],
  ["Matthew Halsall", "uk jazz"],
  ["Nubya Garcia", "uk jazz"],
  ["Moses Boyd", "uk jazz"],
  ["Bradley Zero", "uk jazz"],
  // Talkin' Loud, and the reason it is not "uk jazz": drum and bass on the
  // same imprint. Both read as the acid jazz line, one step rather than two.
  // The generation above the dub line: reggae, and not a dub record between
  // them. Toots is the name that prompted the rule, reading level with the
  // Spice Girls until it existed.
  ["Toots & The Maytals", "reggae"],
  ["Burning Spear", "reggae"],
  ["Culture", "reggae"],
  ["Bob Marley", "reggae"],
  ["Roni Size", "acid jazz and DNB"],
  ["Krust", "acid jazz and DNB"],
  ["Galliano", "acid jazz and DNB"],
  // The generation after, and the same failure from the other side: these read
  // low or nothing at all while Pinch, Shackleton and Peverelist read high off
  // the same scene, because the seed only sees the half of it recorded in
  // Berlin's styles. El-B and MJ Cole are here to keep the garage side of the
  // rule honest: drop the UK Garage style and only they and Wookie fall out.
  ["Burial", "dubstep and uk garage"],
  ["Kode9", "dubstep and uk garage"],
  ["Skream", "dubstep and uk garage"],
  ["Loefah", "dubstep and uk garage"],
  ["Silkie", "dubstep and uk garage"],
  ["Kromestar", "dubstep and uk garage"],
  ["El-B", "dubstep and uk garage"],
  ["MJ Cole", "dubstep and uk garage"],
];

/**
 * Nobody a tradition may reach.
 *
 * Sun Ra and John Zorn are here because a genre-wide jazz rule was measured and
 * rejected: at these dials genre Jazz tags 11,281 artists and lifts 4,360,
 * headed by Zorn and two mastering engineers, all of them present because Bill
 * Laswell produced half of New York's avant-garde. The uk jazz rule names nine
 * labels instead, and these three have no releases between them on any of
 * them. If one ever turns up tagged, a rule has started reading a hub as a
 * heritage.
 *
 * Shabaka Hutchings was on this list and has been taken off it. Under the label
 * rule he is a miss rather than a rejection, on 1 of 13 because the corpus
 * holds his Impulse! records and not his Brownswood ones, so asserting he stays
 * untagged would pin the wrong thing.
 */
const ARTISTS_NO_LINEAGE = [
  "Sun Ra",
  "John Zorn",
  "Peter Brötzmann",
  "Evan Parker",
  "Madonna",
  "Spice Girls",
  "Björk",
  "Depeche Mode",
  "Wolfgang Amadeus Mozart",
  "Basic Channel",
];

/** The merged scale: what a tradition is worth, and what it must not be worth. */
const ARTISTS_AT_LEAST_MEDIUM = [
  "King Tubby",
  "Scientist",
  "Fela Kuti",
  "Underground Resistance",
  "Rhythim Is Rhythim",
  "Gilles Peterson",
  "Matthew Halsall",
  // Burial reading low was the complaint that added the dubstep rule. Skream
  // and Silkie were reading nothing.
  "Burial",
  "Kode9",
  "Skream",
  "Silkie",
];

/**
 * Lifted, but only one step.
 *
 * The acid jazz and reggae lines floor at low, so these must be present and
 * graded, and must NOT reach medium. Bob Marley on the same footing as King
 * Tubby would be the floor doing more than it was asked to: reggae is where dub
 * came from, which is a step further out than dub itself.
 */
const ARTISTS_LOW_ONLY = ["Roni Size", "Krust", "Toots & The Maytals", "Bob Marley"];

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
const hasLineage = db.prepare(
  `SELECT count(*) FROM artists a JOIN artist_coverage c ON c.artist_id = a.id
    WHERE a.name = ? AND c.lineage = ?`,
);
const anyLineage = db.prepare(
  `SELECT count(*) FROM artists a JOIN artist_coverage c ON c.artist_id = a.id
    WHERE a.name = ? AND c.lineage IS NOT NULL`,
);
const atLeastMedium = db.prepare(
  `SELECT count(*) FROM artists a JOIN artist_coverage c ON c.artist_id = a.id
    WHERE a.name = ? AND c.relevance IN ('high', 'medium')`,
);
const isLow = db.prepare(
  `SELECT count(*) FROM artists a JOIN artist_coverage c ON c.artist_id = a.id
    WHERE a.name = ? AND c.relevance = 'low'`,
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

// The top step of the label scale IS the seed-label rule, which is what lets a
// page say "high" and the corpus say "scene label" and mean one thing. If these
// two counts ever part, the display has quietly forked from the definition.
const seedLabelCount = db.prepare("SELECT count(*) FROM seed_labels").pluck().get() as number;
const highLabelCount = db
  .prepare("SELECT count(*) FROM label_coverage WHERE relevance = 'high'")
  .pluck()
  .get() as number;
const agree = seedLabelCount === highLabelCount;
if (!agree) failures++;
console.log(
  `\n  ${agree ? "ok  " : "FAIL"}  label  ${"high = seed labels".padEnd(26)}` +
    `${highLabelCount.toLocaleString("en-GB")} of ${seedLabelCount.toLocaleString("en-GB")}`,
);

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

console.log("\nLineage\n");
for (const [name, tradition] of ARTISTS_LINEAGE) {
  check(tradition, name, true, hasLineage.pluck().get(name, tradition) as number);
}
console.log();
for (const name of ARTISTS_NO_LINEAGE) {
  check("none", name, false, anyLineage.pluck().get(name) as number);
}

console.log("\nLifted to the floor\n");
for (const name of ARTISTS_AT_LEAST_MEDIUM) {
  check("medium+", name, true, atLeastMedium.pluck().get(name) as number);
}
console.log();
for (const name of ARTISTS_NOT_CORE) {
  check("medium+", name, false, atLeastMedium.pluck().get(name) as number);
}
console.log();
for (const name of ARTISTS_LOW_ONLY) {
  check("low", name, true, isLow.pluck().get(name) as number);
}

console.log(
  failures === 0
    ? "\nAll good.\n"
    : `\n${failures} on the wrong side of the line.\n`,
);
process.exit(failures === 0 ? 0 : 1);
