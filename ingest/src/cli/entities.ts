/**
 * Loads canonical artist and label names from their dumps, and builds the
 * search index. Run after pass 2, since it only keeps entities the corpus
 * references.
 *
 *   npm run entities --workspace ingest
 */
import fs from "node:fs";
import path from "node:path";
import { paths } from "../config.ts";
import { openDb } from "../db/open.ts";
import { openDump } from "../lib/release-stream.ts";
import { streamEntities } from "../lib/entity-stream.ts";
import { runEntities } from "../steps/entities.ts";

function newestDump(suffix: string): string {
  const match = fs
    .readdirSync(paths.dumps)
    .filter((f) => f.endsWith(suffix))
    .sort()
    .reverse()[0];
  if (!match) throw new Error(`No ${suffix} dump in ${paths.dumps}. Run fetch-dumps first.`);
  return path.join(paths.dumps, match);
}

const artistsDump = newestDump("_artists.xml.gz");
const labelsDump = newestDump("_labels.xml.gz");

const db = openDb();
const corpusArtists = db.prepare("SELECT count(*) FROM corpus_artists").pluck().get() as number;
if (corpusArtists === 0) {
  console.error("No corpus artists. Run pass2 first.");
  process.exit(1);
}

console.log(`Entities`);
console.log(`  artists  ${path.basename(artistsDump)}`);
console.log(`  labels   ${path.basename(labelsDump)}`);
console.log(`  wanted   ${corpusArtists.toLocaleString("en-GB")} corpus artists\n`);

const started = Date.now();
const stats = await runEntities(
  db,
  {
    artists: streamEntities(openDump(artistsDump), "artist"),
    labels: streamEntities(openDump(labelsDump), "label"),
  },
  { sourceFile: path.basename(artistsDump) },
);

const n = (v: number) => v.toLocaleString("en-GB");
console.log(`
  artists scanned   ${n(stats.artistsScanned)}
  artists kept      ${n(stats.artistsKept)}
  artists missing   ${n(stats.artistsMissing)}   (in corpus, absent from dump)

  labels scanned    ${n(stats.labelsScanned)}
  labels kept       ${n(stats.labelsKept)}
  labels missing    ${n(stats.labelsMissing)}

  relations         ${n(stats.relations)}   (aliases, members, groups)

  elapsed           ${((Date.now() - started) / 1000).toFixed(1)}s
`);

const sample = db
  .prepare("SELECT name FROM artists ORDER BY random() LIMIT 5")
  .pluck()
  .all() as string[];
console.log(`  Sample of corpus artists: ${sample.join(", ")}`);
