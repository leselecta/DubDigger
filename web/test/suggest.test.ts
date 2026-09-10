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
    CREATE TABLE artist_coverage (artist_id INTEGER PRIMARY KEY, release_count INTEGER NOT NULL DEFAULT 0, seed_releases INTEGER NOT NULL DEFAULT 0, relevance TEXT NOT NULL DEFAULT 'none', lineage TEXT, override_reason TEXT);
    CREATE TABLE corpus_artists (artist_id INTEGER PRIMARY KEY, is_seed INTEGER NOT NULL DEFAULT 0, channel_a INTEGER NOT NULL DEFAULT 0, channel_b INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE label_coverage (label_id INTEGER PRIMARY KEY, line_artist_count INTEGER NOT NULL DEFAULT 0, seed_artist_count INTEGER NOT NULL DEFAULT 0, seed_ratio REAL, relevance TEXT NOT NULL DEFAULT 'none', seed_releases INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE release_labels (release_id INTEGER NOT NULL, position INTEGER NOT NULL, label_id INTEGER NOT NULL, name TEXT NOT NULL, catno TEXT, PRIMARY KEY (release_id, position)) WITHOUT ROWID;
    CREATE TABLE releases (id INTEGER PRIMARY KEY, title TEXT NOT NULL, year INTEGER);
    CREATE TABLE release_artists (release_id INTEGER NOT NULL, position INTEGER NOT NULL, artist_id INTEGER NOT NULL, name TEXT NOT NULL, join_phrase TEXT, PRIMARY KEY (release_id, position)) WITHOUT ROWID;
    CREATE TABLE release_rank (release_id INTEGER PRIMARY KEY, weight REAL NOT NULL DEFAULT 0, year INTEGER) WITHOUT ROWID;
    CREATE VIRTUAL TABLE artist_search  USING fts5(name,  content='artists',  content_rowid='id', tokenize='unicode61');
    CREATE VIRTUAL TABLE label_search   USING fts5(name,  content='labels',   content_rowid='id', tokenize='unicode61');
    CREATE VIRTUAL TABLE release_search USING fts5(title, content='releases', content_rowid='id', tokenize='unicode61');
  `);

  const artist = db.prepare("INSERT INTO artists (id, name) VALUES (?, ?)");
  const cover = db.prepare("INSERT INTO artist_coverage VALUES (?, ?, ?, ?, ?, ?)");
  const corpus = db.prepare("INSERT INTO corpus_artists VALUES (?, ?, ?, ?)");
  const label = db.prepare("INSERT INTO labels (id, name) VALUES (?, ?)");
  const grade = db.prepare("INSERT INTO label_coverage VALUES (?, ?, ?, ?, ?, ?)");
  const release = db.prepare("INSERT INTO release_labels VALUES (?, 0, ?, ?, NULL)");

  // Artists: release_count, seed_releases, grade, lineage. Labels: line artists,
  // seed artists, ratio, grade, and the measured scene figure the sort reads.
  // The scene figure and
  // the grade are set against each other on purpose, since sorting on either
  // alone is the bug this file exists to catch.
  artist.run(1, "Basic Channel");
  cover.run(1, 100, 80, "very high", null, null);
  corpus.run(1, 1, 0, 0);

  // 5,000 releases and the most raw scene work of the three, on the bottom
  // grade: four steps of halving put it under a smaller, better-graded name.
  artist.run(2, "Bassline Bob");
  cover.run(2, 5000, 64, "none", null, null);
  corpus.run(2, 0, 1, 0);

  artist.run(3, "Basement Jaxx");
  cover.run(3, 300, 40, "low", null, null);
  corpus.run(3, 0, 0, 1);

  // A label sharing a name with an artist, which is the case the type column
  // exists for: "Chain Reaction" is both, and so is this.
  label.run(10, "Basic Channel");
  grade.run(10, 40, 30, 0.75, "very high", 37);
  for (let i = 0; i < 50; i++) release.run(i, 10, "Basic Channel");

  label.run(11, "Bassment Records");
  grade.run(11, 4, 0, 0, "none", 0);
  for (let i = 100; i < 102; i++) release.run(i, 11, "Bassment Records");

  // The exact-name pair. On the scene figure alone Dubplate wins, 30 against
  // the label's 40 halved for its grade. Typing the label's name exactly is
  // worth that step back, and the "(3)" is Discogs' disambiguator rather than
  // anything anyone types.
  artist.run(4, "Dubplate");
  cover.run(4, 40, 30, "very high", null, null);
  corpus.run(4, 0, 1, 0);

  label.run(12, "Dub (3)");
  grade.run(12, 20, 10, 0.667, "high", 40);
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

  /*
   * The inheritance cases, which are three and not one.
   *
   * A compilation has no single maker, so it takes its label's grade: `Various`
   * is a fact about the record rather than a hole in the data. An artist the
   * corpus graded `none` keeps `none` even on a top-step label, because
   * `artist_coverage.relevance` is NOT NULL and only a missing row falls
   * through — regrading a measured artist on the room they released in would be
   * the fallback quietly overwriting an answer it was only meant to replace.
   */
  label.run(13, "Comp Rooms");
  grade.run(13, 30, 25, 0.83, "very high", 25);

  record.run(504, "Comp Rooms Vol 1", 2010);
  by.run(504, 97, "Various");
  weigh.run(504, 0, 2010);
  release.run(504, 13, "Comp Rooms");

  release.run(502, 13, "Comp Rooms");

  /*
   * Enough of one name to fill a pool, so `capped` has something to be true
   * about. RANK_POOL is 200 a kind, and the point of the flag is that a count
   * measured under a cap is not a total: the heading has to say "Closest 200"
   * rather than claim it counted them.
   */
  for (let i = 0; i < 201; i++) {
    artist.run(1000 + i, `Padded ${i}`);
    cover.run(1000 + i, 1, 0, "none", null, null);
    corpus.run(1000 + i, 0, 1, 0);
  }

  /*
   * The lineage family, and the reason it is here rather than on `main` alone.
   *
   * The seed measures dub techno, so it scores a Jamaican dub engineer at
   * nothing however large the catalogue. That is what lineage exists to say,
   * and reading the bare measure as a sort key put 2,820 lifted artists on a
   * score of exactly zero. Three readers of that measure feed this file:
   * `artistPool`, `releasePool` and `release_rank.weight`, and each one had to
   * be fixed separately.
   */
  artist.run(5, "King Tubby");
  cover.run(5, 220, 0, "medium", "roots dub", null);
  corpus.run(5, 0, 1, 0);

  // A tradition never lowers anyone: 18 measured beats the 110 halved to 10.
  artist.run(6, "Tubby Deep");
  cover.run(6, 20, 18, "very high", "roots dub", null);
  corpus.run(6, 0, 1, 0);

  artist.run(7, "Tubby Isiah");
  cover.run(7, 30, 6, "high", null, null);
  corpus.run(7, 0, 0, 1);

  label.run(14, "Jah Tubbys");
  grade.run(14, 20, 15, 0.5, "very high", 14);
  for (let i = 300; i < 328; i++) release.run(i, 14, "Jah Tubbys");

  /*
   * A record by a lifted artist, which is the third reader. `releasePool` sets
   * a record's scene figure from its lead artist's coverage row, so a record of
   * King Tubby's inherited his zero and sorted under every namesake even once
   * he himself ranked correctly. The weight here is only the pool cut; what
   * orders the row is the figure `releasePool` reads.
   */
  record.run(505, "Tubby Dub", 1975);
  by.run(505, 5, "King Tubby");
  weigh.run(505, 27, 1975);

  /*
   * Two names at the top step, one of them typed exactly. `very high` is step
   * 0, so taking a step off the discount had nothing to take: the bonus was a
   * no-op for exactly the names most likely to be typed in full. As a doubling
   * it applies at every grade, and this is the only pair in this file that can
   * tell the two spellings apart.
   */
  artist.run(8, "Vertigo Deep");
  cover.run(8, 25, 20, "very high", null, null);
  corpus.run(8, 0, 1, 0);

  label.run(15, "Vertigo (2)");
  grade.run(15, 20, 18, 0.9, "very high", 12);
  for (let i = 400; i < 412; i++) release.run(i, 15, "Vertigo (2)");

  /*
   * Someone named by hand, whom the seed scores at nothing.
   *
   * This is the case an override exists for and also the case that quietly
   * fails: the grade is only a discount on `seed_releases`, so promoting an
   * artist on zero leaves zero, and the word moves on the page while the search
   * order does not. Floored on the corpus count the way a tradition is.
   */
  artist.run(20, "Vertex Hand");
  cover.run(20, 60, 0, "high", null, "named by hand");
  corpus.run(20, 0, 1, 0);

  artist.run(21, "Vertex Measured");
  cover.run(21, 10, 8, "high", null, null);
  corpus.run(21, 0, 1, 0);

  db.exec("INSERT INTO artist_search(artist_search) VALUES('rebuild')");
  db.exec("INSERT INTO label_search(label_search) VALUES('rebuild')");
  db.exec("INSERT INTO release_search(release_search) VALUES('rebuild')");
  db.close();
}

process.env.DUBDIGGER_DB = file;
const { suggest, search, matchTerm, SUGGEST_MIN_CHARS } = await import("../src/lib/queries.ts");

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
    // 37 releases of its own inside the cluster, also undiscounted.
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

test("a tradition is scored on work the seed cannot see", () => {
  // `seed_releases` is blind to dub, reggae, dubstep, Detroit, afrobeat and
  // jazz by construction, which is why lineage exists at all. Reading it as
  // the sort key put 2,820 lifted artists on a score of exactly zero and
  // returned Commodore C 64 above Commodo. So a tradition scores on the
  // corpus output instead, halved for the fact that the corpus cannot say
  // which part of it is the tradition, and floored at the measured figure.
  assert.deepEqual(
    suggest("tub", 8).names.map((s) => s.name),
    [
      // 220 releases halved to 110, then two steps for `medium`: 27.5.
      "King Tubby",
      // The floor holding: 18 measured, not the 10 the halving would give.
      "Tubby Deep",
      // 14 releases of its own inside the cluster, undiscounted.
      "Jah Tubbys",
      // No tradition, so the measured figure stands: 6 halved for `high`.
      "Tubby Isiah",
    ],
  );
});

test("a record inherits the lifted figure, not the measure that cannot see it", () => {
  // The third reader, and the one that actually orders the row: `release_rank`
  // is only the pool cut, and `artistPool` fixes the artist alone. A record of
  // King Tubby's took his bare zero and sorted under every namesake even once
  // he ranked first himself, which is the same bug wearing the same number one
  // function along.
  //
  // 110 lifted, two steps for `medium`, then one more for being a record
  // rather than the name that made it: 13.75, which lands it between the
  // label at 14 and Tubby Isiah at 3.
  assert.deepEqual(
    suggest("tub", 8).all.map((s) => `${s.kind}:${s.name}`),
    [
      "artist:King Tubby",
      "artist:Tubby Deep",
      "label:Jah Tubbys",
      "release:Tubby Dub",
      "artist:Tubby Isiah",
    ],
  );
});

test("an exact name is worth a doubling at every grade, the top one included", () => {
  // Not typed exactly, so the measured figures stand: 20 beats 12.
  assert.deepEqual(
    suggest("vertig", 8).names.map((s) => s.name),
    ["Vertigo Deep", "Vertigo (2)"],
  );

  // Typed exactly. Both are `very high`, which is the case the old spelling
  // could not express: `step - 1` has nothing to subtract at step 0, so the
  // label stayed on 12 and lost. Doubled, 24 beats 20.
  assert.deepEqual(
    suggest("vertigo", 8).names.map((s) => s.name),
    ["Vertigo (2)", "Vertigo Deep"],
  );
});

test("a hand-written promotion has to survive the sort, not just the page", () => {
  // Vertex Hand has no seed work at all and is named in the config; Vertex
  // Measured has 8 measured releases. Both read `high`, so the grade discounts
  // them identically and only the figure separates them.
  //
  // On `seed_releases` alone the named artist scores zero and loses to anyone,
  // which is the lineage bug of 2026-09-08 arriving on a name somebody chose
  // deliberately. Floored at half the corpus count, 30 beats 8.
  assert.deepEqual(
    suggest("vertex", 8).names.map((s) => s.name),
    ["Vertex Hand", "Vertex Measured"],
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

/*
 * The results column, and where each row's word comes from.
 *
 * The grade was never a new claim on a record: `rankHits` halves a record's
 * weight by the lead artist's grade and always has, so the order was already
 * built on the inherited word. These pin which of the two answered, because one
 * column now reads from two places.
 */
const graded = (query: string, name: string) => search(query, 40).hits.find((h) => h.name === name)!;

test("a name answers for its own grade, and carries no source", () => {
  const hit = graded("basic", "Basic Channel");
  assert.equal(hit.relevance, "very high");
  assert.equal(hit.gradedOn, null);
});

test("a record inherits the lead artist's grade", () => {
  const hit = graded("basic sound", "Basic Sound");
  assert.equal(hit.relevance, "very high");
  assert.equal(hit.gradedOn, "artist");
});

test("a compilation with no maker inherits the label's instead", () => {
  const hit = graded("comp rooms vol", "Comp Rooms Vol 1");
  assert.equal(hit.relevance, "very high");
  assert.equal(hit.gradedOn, "label");
});

test("an artist graded none keeps none, whatever label they released on", () => {
  // Bassline Trak is on Comp Rooms, which is `very high`. Its maker is measured
  // at `none`, and a measured answer is not replaced by a fallback.
  const hit = graded("bassline trak", "Bassline Trak");
  assert.equal(hit.relevance, "none");
  assert.equal(hit.gradedOn, "artist");
});

test("a record with neither has neither, rather than a borrowed word", () => {
  const hit = graded("basement dub", "Basement Dub");
  assert.equal(hit.relevance, "none");
  assert.equal(hit.gradedOn, "none");
});

test("inheriting cannot move the ranking, because the score it divides is zero", () => {
  // Comp Rooms Vol 1 has no seed releases, so `sceneScore` is 0 / 2**step
  // whatever the step. Giving it the label's `very high` changes the divisor
  // and not the quotient: it still sorts below the label that lent it the word.
  // The merged tab, explicitly: `search` now defaults to names, where a record
  // is not, so the cross-kind order is only visible on "all".
  const names = search("comp rooms", 40, "all").hits.map((h) => h.name);
  assert.equal(names.indexOf("Comp Rooms") < names.indexOf("Comp Rooms Vol 1"), true);
});

/*
 * The results page splits the same ranking into the same three tabs.
 *
 * Slices, not filters: a row keeps the position it already had, so the tabs
 * cannot disagree with the order. The tab is in the URL, and `"auto"` is the
 * page arriving without one.
 */
test("the results page counts every tab, whichever one it answers", () => {
  const r = search("bas", 40, "names");
  assert.equal(r.counts.names + r.counts.releases, r.counts.all);
  assert.equal(r.counts.names > 0 && r.counts.releases > 0, true);

  // The counts do not change with the tab; only what is on the page does.
  assert.deepEqual(search("bas", 40, "releases").counts, r.counts);
});

test("a tab answers with its own kind, and its own truncation", () => {
  assert.equal(
    search("bas", 40, "names").hits.every((h) => h.kind !== "release"),
    true,
  );
  assert.equal(
    search("bas", 40, "releases").hits.every((h) => h.kind === "release"),
    true,
  );

  // `truncated` is of the open tab, since the heading counts what is on it.
  const one = search("bas", 1, "releases");
  assert.equal(one.hits.length, 1);
  assert.equal(one.truncated, true);
});

test("auto opens on names, and falls through when names is empty", () => {
  assert.equal(search("bas", 40).kind, "names");

  // "Comp Rooms Vol 1" is a record; no artist or label matches that phrase, so
  // the page would open on an empty Artists & Labels without the fallback.
  const comp = search("comp rooms vol", 40);
  assert.equal(comp.counts.names, 0);
  assert.equal(comp.kind, "releases");
  assert.equal(comp.hits.length > 0, true);
});

test("an asked-for tab is answered even when it is empty", () => {
  // Clicking a 0 tab is a real address and has to render, rather than falling
  // through to a tab the reader did not ask for.
  const empty = search("comp rooms vol", 40, "names");
  assert.equal(empty.kind, "names");
  assert.deepEqual(empty.hits, []);
  assert.equal(empty.counts.all > 0, true);
});

test("a tab is a slice of one ranking, so it never reorders", () => {
  const all = search("bas", 40, "all").hits.map((h) => `${h.kind}:${h.id}`);
  for (const kind of ["names", "releases"] as const) {
    const tab = search("bas", 40, kind).hits.map((h) => `${h.kind}:${h.id}`);
    assert.deepEqual(tab, all.filter((k) => tab.includes(k)));
  }
});

/*
 * Paging, and the one number the heading must never invent.
 */
test("a tab pages with ?show=, and says how many are left", () => {
  const first = search("padded", 40, "names");
  assert.equal(first.hits.length, 40);
  assert.equal(first.truncated, true);

  const more = search("padded", 80, "names");
  assert.equal(more.hits.length, 80);
  assert.equal(more.truncated, true);

  // The count does not move as the page lengthens; only the rows do.
  assert.equal(more.counts.names, first.counts.names);
});

test("a count measured under the cap is reported as a cap, not a total", () => {
  // 201 artists match, the pool takes 200, and the heading must not claim to
  // have counted them: "Closest 200" rather than "200 found".
  const capped = search("padded", 40, "names");
  assert.equal(capped.counts.names, 200);
  assert.equal(capped.capped.names, true);

  // A query the pool did not clip reports an honest total.
  const real = search("echocord vainqueur bas", 40, "names");
  assert.equal(real.capped.names, false);
  assert.equal(search("bas", 40, "names").capped.names, false);
});

test("capped is per kind, so a full names pool does not mislabel releases", () => {
  const r = search("padded", 40, "names");
  assert.equal(r.capped.names, true);
  assert.equal(r.capped.releases, false);
  // The merged tab is capped if either half was.
  assert.equal(r.capped.all, true);
});

test("paging past the end gives what there is, and stops offering more", () => {
  const all = search("bas", 1000, "names");
  assert.equal(all.truncated, false);
  assert.equal(all.hits.length, all.counts.names);
});
