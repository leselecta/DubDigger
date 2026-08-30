import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The suggest query, against a corpus built by hand.
 *
 * The ranking is worth a unit test on its own, because it is the part that has
 * already been wrong once: sorting on the grade made a one-record imprint with
 * a perfect ratio beat the label the scene is named after. The SQL is the other
 * half, since a label's scene figure is built from a release count and an
 * artist's is read off a column, and the two have to end up in one unit.
 *
 * The database is a temp file rather than :memory:, because the app opens its
 * own handle by path and read-only.
 */
const file = path.join(mkdtempSync(path.join(tmpdir(), "dubdigger-")), "test.sqlite");

{
  const db = new Database(file);
  db.exec(`
    CREATE TABLE artists (id INTEGER PRIMARY KEY, name TEXT NOT NULL, real_name TEXT, profile TEXT, urls TEXT);
    CREATE TABLE labels  (id INTEGER PRIMARY KEY, name TEXT NOT NULL, profile TEXT, urls TEXT);
    CREATE TABLE artist_coverage (artist_id INTEGER PRIMARY KEY, release_count INTEGER NOT NULL DEFAULT 0, seed_releases INTEGER NOT NULL DEFAULT 0, relevance TEXT NOT NULL DEFAULT 'none');
    CREATE TABLE corpus_artists (artist_id INTEGER PRIMARY KEY, is_seed INTEGER NOT NULL DEFAULT 0, channel_a INTEGER NOT NULL DEFAULT 0, channel_b INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE label_coverage (label_id INTEGER PRIMARY KEY, line_artist_count INTEGER NOT NULL DEFAULT 0, seed_artist_count INTEGER NOT NULL DEFAULT 0, seed_ratio REAL, relevance TEXT NOT NULL DEFAULT 'none');
    CREATE TABLE release_labels (release_id INTEGER NOT NULL, position INTEGER NOT NULL, label_id INTEGER NOT NULL, name TEXT NOT NULL, catno TEXT, PRIMARY KEY (release_id, position)) WITHOUT ROWID;
    CREATE VIRTUAL TABLE artist_search USING fts5(name, content='artists', content_rowid='id', tokenize='unicode61');
    CREATE VIRTUAL TABLE label_search  USING fts5(name, content='labels',  content_rowid='id', tokenize='unicode61');
  `);

  const artist = db.prepare("INSERT INTO artists (id, name) VALUES (?, ?)");
  const cover = db.prepare("INSERT INTO artist_coverage VALUES (?, ?, ?, ?)");
  const corpus = db.prepare("INSERT INTO corpus_artists VALUES (?, ?, ?, ?)");
  const label = db.prepare("INSERT INTO labels (id, name) VALUES (?, ?)");
  const grade = db.prepare("INSERT INTO label_coverage VALUES (?, ?, ?, ?, ?)");
  const release = db.prepare("INSERT INTO release_labels VALUES (?, 0, ?, ?, NULL)");

  // Columns: release_count, seed_releases, grade. The scene figure and the
  // grade are set against each other on purpose, since sorting on either alone
  // is the bug this file exists to catch.
  artist.run(1, "Basic Channel");
  cover.run(1, 100, 80, "very high");
  corpus.run(1, 1, 0, 0);

  // 5,000 releases and the most raw scene work of the three, on the bottom
  // grade: four steps of halving put it under a smaller, better-graded name.
  artist.run(2, "Bassline Bob");
  cover.run(2, 5000, 64, "none");
  corpus.run(2, 0, 1, 0);

  artist.run(3, "Basement Jaxx");
  cover.run(3, 300, 40, "low");
  corpus.run(3, 0, 0, 1);

  // A label sharing a name with an artist, which is the case the type column
  // exists for: "Chain Reaction" is both, and so is this.
  label.run(10, "Basic Channel");
  grade.run(10, 40, 30, 0.75, "very high");
  for (let i = 0; i < 50; i++) release.run(i, 10, "Basic Channel");

  label.run(11, "Bassment Records");
  grade.run(11, 4, 0, 0, "none");
  for (let i = 100; i < 102; i++) release.run(i, 11, "Bassment Records");

  // The exact-name pair. On the scene figure alone Dubplate wins, 30 against
  // the label's 40 halved for its grade. Typing the label's name exactly is
  // worth that step back, and the "(3)" is Discogs' disambiguator rather than
  // anything anyone types.
  artist.run(4, "Dubplate");
  cover.run(4, 40, 30, "very high");
  corpus.run(4, 0, 1, 0);

  label.run(12, "Dub (3)");
  grade.run(12, 20, 10, 0.667, "high");
  for (let i = 200; i < 260; i++) release.run(i, 12, "Dub (3)");

  db.exec("INSERT INTO artist_search(artist_search) VALUES('rebuild')");
  db.exec("INSERT INTO label_search(label_search) VALUES('rebuild')");
  db.close();
}

process.env.DUBDIGGER_DB = file;
const { suggest, matchTerm, SUGGEST_MIN_CHARS } = await import("../src/lib/queries.ts");

test("quotes the term and gives it a trailing wildcard", () => {
  assert.equal(matchTerm("basic"), '"basic"*');
  assert.equal(matchTerm("  basic  "), '"basic"*');
});

test("escapes a quote rather than handing FTS5 broken syntax", () => {
  assert.equal(matchTerm('bas"ic'), '"bas""ic"*');
  assert.doesNotThrow(() => suggest('bas"'));
  assert.doesNotThrow(() => suggest("bas*("));
});

test("ranks on scene work, discounted by the grade rather than gated by it", () => {
  const names = suggest("bas", 8).map((s) => `${s.name} (${s.kind})`);
  assert.deepEqual(names, [
    // 80 releases of scene work at the top grade, undiscounted.
    "Basic Channel (artist)",
    // 50 releases at a 0.75 roster share is 37, also undiscounted.
    "Basic Channel (label)",
    // 40 at `low` is 5, which beats 64 at `none` at 4. The grade separates
    // them; on raw scene work alone the order would reverse.
    "Basement Jaxx (artist)",
    "Bassline Bob (artist)",
    // No scene work at all, so no amount of grading lifts it.
    "Bassment Records (label)",
  ]);
});

test("typing a name exactly is worth one step of the grade", () => {
  // Neither is typed exactly here. Dubplate is 30 undiscounted; the label is
  // 40 halved to 20 for its grade.
  assert.deepEqual(
    suggest("du", 8).map((s) => s.name),
    ["Dubplate", "Dub (3)"],
  );

  // Now the label is typed exactly, gets its step back, and 40 beats 30.
  // Discogs' disambiguator is not part of the name, which is what makes a
  // query of "dub" exact against a label stored as "Dub (3)".
  assert.deepEqual(
    suggest("dub", 8).map((s) => s.name),
    ["Dub (3)", "Dubplate"],
  );
});

test("carries the grade and the kind, which is what a row has to say", () => {
  const [first] = suggest("basic");
  assert.deepEqual(first, {
    id: 1,
    name: "Basic Channel",
    kind: "artist",
    relevance: "very high",
  });
});

test("says nothing until there is enough to say it about", () => {
  assert.equal(SUGGEST_MIN_CHARS, 2);
  assert.deepEqual(suggest("b"), []);
  assert.deepEqual(suggest(" "), []);
  assert.deepEqual(suggest(""), []);
  assert.equal(suggest("ba").length > 0, true);
});

test("shows three, because a dropdown is read at a glance", () => {
  assert.equal(suggest("bas").length, 3);
  assert.equal(suggest("bas", 2).length, 2);
  // Asking for more than there are gives what there is, not three.
  assert.equal(suggest("bas", 8).length, 5);
});
