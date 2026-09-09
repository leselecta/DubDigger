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
    CREATE TABLE releases (id INTEGER PRIMARY KEY, title TEXT NOT NULL, year INTEGER);
    CREATE TABLE release_artists (release_id INTEGER NOT NULL, position INTEGER NOT NULL, artist_id INTEGER NOT NULL, name TEXT NOT NULL, join_phrase TEXT, PRIMARY KEY (release_id, position)) WITHOUT ROWID;
    CREATE TABLE release_rank (release_id INTEGER PRIMARY KEY, weight REAL NOT NULL DEFAULT 0, year INTEGER) WITHOUT ROWID;
    CREATE VIRTUAL TABLE artist_search  USING fts5(name,  content='artists',  content_rowid='id', tokenize='unicode61');
    CREATE VIRTUAL TABLE label_search   USING fts5(name,  content='labels',   content_rowid='id', tokenize='unicode61');
    CREATE VIRTUAL TABLE release_search USING fts5(title, content='releases', content_rowid='id', tokenize='unicode61');
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

  /*
   * Records, which is what the third tab holds and the second one is made of.
   *
   * Weighted below every name on purpose: a record inherits its lead artist's
   * figure and is halved once, so on the merged tab the names come first and
   * the tab row is what a reader uses to get past them. Two pressings of one
   * record are here because the collapse has to keep being pinned, and a
   * record whose lead artist the corpus never admitted is here because a title
   * has to stay findable without one.
   */
  const record = db.prepare("INSERT INTO releases VALUES (?, ?, ?)");
  const by = db.prepare("INSERT INTO release_artists VALUES (?, 0, ?, ?, NULL)");
  const weigh = db.prepare("INSERT INTO release_rank VALUES (?, ?, ?)");

  record.run(500, "Basic Sound", 1993);
  by.run(500, 1, "Basic Channel");
  weigh.run(500, 3, 1993);

  record.run(501, "Basic Sound", 1998);
  by.run(501, 1, "Basic Channel");
  weigh.run(501, 3, 1998);

  record.run(502, "Bassline Trak", 2001);
  by.run(502, 2, "Bassline Bob");
  weigh.run(502, 2, 2001);

  record.run(503, "Basement Dub", 2004);
  by.run(503, 99, "Someone Uncredited");
  weigh.run(503, 1, 2004);

  db.exec("INSERT INTO artist_search(artist_search) VALUES('rebuild')");
  db.exec("INSERT INTO label_search(label_search) VALUES('rebuild')");
  db.exec("INSERT INTO release_search(release_search) VALUES('rebuild')");
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
  const names = suggest("bas", 8).names.map((s) => `${s.name} (${s.kind})`);
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
    suggest("du", 8).names.map((s) => s.name),
    ["Dubplate", "Dub (3)"],
  );

  // Now the label is typed exactly, gets its step back, and 40 beats 30.
  // Discogs' disambiguator is not part of the name, which is what makes a
  // query of "dub" exact against a label stored as "Dub (3)".
  assert.deepEqual(
    suggest("dub", 8).names.map((s) => s.name),
    ["Dub (3)", "Dubplate"],
  );
});

test("carries the grade and the kind, which is what a row has to say", () => {
  const [first] = suggest("basic").names;
  assert.deepEqual(first, {
    id: 1,
    name: "Basic Channel",
    kind: "artist",
    relevance: "very high",
    artist: null,
  });
});

test("a record carries who made it, and no grade at all", () => {
  const [first] = suggest("basic sound").releases;
  assert.deepEqual(first, {
    id: 500,
    name: "Basic Sound",
    kind: "release",
    relevance: null,
    artist: "Basic Channel",
  });

  // Findable by title with nobody the corpus admitted behind it.
  assert.deepEqual(suggest("basement dub").releases[0]?.artist, "Someone Uncredited");
});

test("the three tabs are three slices of one ranking, not three rankings", () => {
  const { names, releases, all } = suggest("bas", 8);

  // Every row is on the merged tab, and in the order the merged tab has it.
  const order = all.map((s) => `${s.kind}:${s.id}`);
  for (const group of [names, releases]) {
    const seen = group.map((s) => `${s.kind}:${s.id}`).filter((k) => order.includes(k));
    assert.deepEqual(seen, order.filter((k) => seen.includes(k)));
  }

  assert.equal(
    names.every((s) => s.kind !== "release"),
    true,
  );
  assert.equal(
    releases.every((s) => s.kind === "release"),
    true,
  );
});

test("names come before records on the merged tab, which is why names is the default", () => {
  // A record inherits its maker's figure halved, so it cannot outrank them.
  assert.equal(suggest("bas", 8).all[0]?.kind, "artist");
});

test("two pressings of one record are one row", () => {
  // 500 and 501 are the same title by the same act, and the earlier one wins.
  const titles = suggest("basic sound", 8).releases;
  assert.deepEqual(
    titles.map((s) => s.id),
    [500],
  );
});

test("says nothing until there is enough to say it about", () => {
  assert.equal(SUGGEST_MIN_CHARS, 2);
  for (const query of ["b", " ", ""]) {
    assert.deepEqual(suggest(query), { names: [], releases: [], all: [] });
  }
  assert.equal(suggest("ba").all.length > 0, true);
});

test("shows four a tab, because a dropdown is read at a glance", () => {
  const four = suggest("bas");
  assert.equal(four.names.length, 4);
  assert.equal(four.all.length, 4);

  assert.equal(suggest("bas", 2).names.length, 2);

  // Asking for more than there are gives what there is, not four.
  assert.equal(suggest("bas", 8).names.length, 5);
  assert.equal(suggest("bas", 8).releases.length, 3);
});
