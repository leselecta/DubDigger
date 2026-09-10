import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Standing in the two ranked lists, and the one discography that is capped.
 *
 * Alias expansion is what puts a core artist's other recording names in the
 * core band, and `ALIAS_BAND_KEEP` is what stops one man's 74 alias names from
 * being the whole of the first page. Both halves need pinning: the cap has to
 * bite on Voigt, and it must not bite on anyone else, which is the failure a
 * general "two rows per person" rule would have been.
 *
 * Ids are the real ones, because the rule names them. The corpus around them
 * is built by hand.
 */
const file = path.join(mkdtempSync(path.join(tmpdir(), "dubdigger-band-")), "test.sqlite");

const VOIGT = 16162;
const GAS = 4986;
const MIKE_INK = 6349;
const BASIC_CHANNEL = 13117;
const MAURIZIO = 1002;
const SCENE_LABEL = 255;

{
  const db = new Database(file);
  db.exec(`
    CREATE TABLE artists (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE labels (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE releases (id INTEGER PRIMARY KEY, title TEXT NOT NULL, year INTEGER);
    CREATE TABLE artist_relations (artist_id INTEGER NOT NULL, related_id INTEGER NOT NULL, kind TEXT NOT NULL, related_name TEXT NOT NULL DEFAULT '', PRIMARY KEY (artist_id, related_id, kind)) WITHOUT ROWID;
    CREATE TABLE release_artists (release_id INTEGER NOT NULL, position INTEGER NOT NULL, artist_id INTEGER NOT NULL, name TEXT NOT NULL, join_phrase TEXT, PRIMARY KEY (release_id, position)) WITHOUT ROWID;
    CREATE TABLE release_labels (release_id INTEGER NOT NULL, position INTEGER NOT NULL, label_id INTEGER NOT NULL, name TEXT NOT NULL, catno TEXT, PRIMARY KEY (release_id, position)) WITHOUT ROWID;
    CREATE TABLE artist_coverage (artist_id INTEGER PRIMARY KEY, release_count INTEGER NOT NULL DEFAULT 0, first_year INTEGER, last_year INTEGER);
    CREATE TABLE label_roster (label_id INTEGER NOT NULL, artist_id INTEGER NOT NULL, release_count INTEGER NOT NULL, first_year INTEGER, last_year INTEGER, PRIMARY KEY (label_id, artist_id)) WITHOUT ROWID;
  `);

  const artist = db.prepare("INSERT INTO artists (id, name) VALUES (?, ?)");
  const cover = db.prepare("INSERT INTO artist_coverage VALUES (?, ?, ?, ?)");
  const rel = db.prepare("INSERT INTO artist_relations VALUES (?, ?, 'alias', ?)");
  const release = db.prepare("INSERT INTO releases VALUES (?, ?, ?)");
  const line = db.prepare("INSERT INTO release_artists VALUES (?, 0, ?, ?, NULL)");
  const onLabel = db.prepare("INSERT INTO release_labels VALUES (?, 0, ?, 'Label', NULL)");

  db.prepare("INSERT INTO labels VALUES (?, ?)").run(SCENE_LABEL, "Basic Channel");

  const names: [number, string][] = [
    [VOIGT, "Wolfgang Voigt"],
    [GAS, "Gas"],
    [MIKE_INK, "Mike Ink"],
    [BASIC_CHANNEL, "Basic Channel"],
    [MAURIZIO, "Maurizio"],
  ];

  /*
   * Twelve releases each, all on a scene label, so every one of them clears
   * `ALIAS_BAND_FLOOR` on its own. The cap is then the only thing that can
   * separate them, which is what the assertions below are reading.
   */
  let next = 1;
  for (const [id, name] of names) {
    artist.run(id, name);
    cover.run(id, 12, 1994, 2004);
    for (let i = 0; i < 12; i++) {
      release.run(next, `${name} ${i}`, 1994 + i);
      line.run(next, id, name);
      onLabel.run(next, SCENE_LABEL);
      next++;
    }
  }

  rel.run(VOIGT, GAS, "Gas");
  rel.run(VOIGT, MIKE_INK, "Mike Ink");
  rel.run(BASIC_CHANNEL, MAURIZIO, "Maurizio");
  db.close();
}

process.env.DUBDIGGER_DB = file;
const { getTopArtists } = await import("../src/lib/queries.ts");

const standing = (id: number) => getTopArtists().find((a) => a.id === id)?.standing;

test("a core artist and a kept alias both hold the core band", () => {
  assert.equal(standing(VOIGT), "core");
  assert.equal(standing(GAS), "core");
});

test("Voigt's other names fall to the named band rather than off the list", () => {
  assert.equal(standing(MIKE_INK), "named");
});

test("the cap is one discography, and reaches no other core artist's aliases", () => {
  assert.equal(standing(BASIC_CHANNEL), "core");
  assert.equal(standing(MAURIZIO), "core");
});
