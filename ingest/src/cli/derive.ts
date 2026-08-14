/**
 * Builds the precomputed tables the web app reads. Run last, after pass 2 and
 * entities.
 *
 *   npm run derive --workspace ingest
 *   npm run derive --workspace ingest -- --max-people 30
 */
import fs from "node:fs";
import { paths, derive as deriveConfig } from "../config.ts";
import { openDb } from "../db/open.ts";
import { runDerive } from "../steps/derive.ts";

const argv = process.argv.slice(2);
const i = argv.indexOf("--max-people");
const maxPeople = i === -1 ? deriveConfig.maxPeoplePerRelease : Number(argv[i + 1]);

const db = openDb();
if ((db.prepare("SELECT count(*) FROM corpus_artists").pluck().get() as number) === 0) {
  console.error("No corpus artists. Run pass2 first.");
  process.exit(1);
}

console.log(`Derive`);
console.log(`  max people per release   ${maxPeople}  (above this, no collaboration pairs)\n`);

const started = Date.now();
const stats = await runDerive(db, {
  maxPeoplePerRelease: maxPeople,
  onStep: (name) => console.log(`    ${name}...`),
});

const n = (v: number) => v.toLocaleString("en-GB");
console.log(`
  artist_collaborators   ${n(stats.artistCollaborators)}
  artist_labels          ${n(stats.artistLabels)}
  label_roster           ${n(stats.labelRoster)}
  artist_coverage        ${n(stats.artistCoverage)}
  label_coverage         ${n(stats.labelGrades.reduce((t, g) => t + g.labels, 0))}
  compilations unpaired  ${n(stats.releasesSkippedForPairs)}

${stats.lineage
  .map((t) => `  ${t.name.padEnd(23)}${n(t.tagged)} tagged, ${n(t.lifted)} lifted to the floor`)
  .join("\n")}

${stats.labelGrades.map((g) => `  labels ${g.relevance.padEnd(16)}${n(g.labels)}`).join("\n")}

  elapsed                ${((Date.now() - started) / 1000).toFixed(1)}s
`);

// Honest absence is a product rule, so it gets reported rather than hidden.
const noCredits = db
  .prepare("SELECT count(*) FROM artist_coverage WHERE release_count > 0 AND credited_releases = 0")
  .pluck()
  .get() as number;
const solo = db
  .prepare(
    "SELECT count(*) FROM artist_coverage WHERE credited_releases > 0 AND collaborator_count = 0",
  )
  .pluck()
  .get() as number;

console.log(`  no credits recorded    ${n(noCredits)}   (nobody has entered them)`);
console.log(`  worked alone           ${n(solo)}   (credits exist, no collaborators)\n`);

const size = fs.statSync(paths.db).size / (1 << 30);
console.log(`  Database: ${paths.db} (${size.toFixed(2)} GB)`);
