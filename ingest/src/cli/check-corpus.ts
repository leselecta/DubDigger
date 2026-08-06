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

/** What a sceptic types to see whether the tool is serious. */
const ARTISTS_OUT = [
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

const db = openDbReadOnly();
let failures = 0;

const isSeedLabel = db.prepare(
  `SELECT count(*) FROM labels l JOIN seed_labels s ON s.label_id = l.id WHERE l.name = ?`,
);
const inCorpus = db.prepare(
  `SELECT count(*) FROM artists a JOIN corpus_artists m ON m.artist_id = a.id WHERE a.name = ?`,
);

function check(kind: string, name: string, want: boolean, got: number) {
  const ok = want ? got > 0 : got === 0;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${kind.padEnd(6)} ${name.padEnd(26)}` +
      `${want ? "expected in " : "expected out"}  ${got > 0 ? "present" : "absent"}`,
  );
}

console.log("Seed labels\n");
for (const name of LABELS_IN) check("label", name, true, isSeedLabel.pluck().get(name) as number);
console.log();
for (const name of LABELS_OUT) check("label", name, false, isSeedLabel.pluck().get(name) as number);

console.log("\nCorpus artists\n");
for (const name of ARTISTS_IN) check("artist", name, true, inCorpus.pluck().get(name) as number);
console.log();
for (const name of ARTISTS_OUT) check("artist", name, false, inCorpus.pluck().get(name) as number);

console.log(
  failures === 0
    ? "\nAll good.\n"
    : `\n${failures} on the wrong side of the line.\n`,
);
process.exit(failures === 0 ? 0 : 1);
