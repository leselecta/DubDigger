import test from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";

import { openDb } from "../src/db/open.ts";
import { runDerive } from "../src/steps/derive.ts";

/** Builds a corpus by hand: releases, who is on them, and where they came out. */
function corpus(
  releases: {
    id: number;
    year?: number | null;
    artists?: number[];
    credits?: [number, string][];
    labels?: number[];
    /** Defaults to a seed release, which is what most of these fixtures want. */
    seed?: boolean;
    styles?: string[];
    genres?: string[];
  }[],
): Database.Database {
  const db = openDb(":memory:");
  const r = db.prepare("INSERT INTO releases (id, title, year, is_seed) VALUES (?, ?, ?, ?)");
  const st = db.prepare("INSERT INTO release_styles (release_id, style) VALUES (?, ?)");
  const gn = db.prepare("INSERT INTO release_genres (release_id, genre) VALUES (?, ?)");
  const a = db.prepare(
    "INSERT INTO release_artists (release_id, position, artist_id, name) VALUES (?, ?, ?, ?)",
  );
  const c = db.prepare(
    "INSERT INTO release_credits (release_id, position, artist_id, name, role) VALUES (?, ?, ?, ?, ?)",
  );
  const l = db.prepare(
    "INSERT INTO release_labels (release_id, position, label_id, name) VALUES (?, ?, ?, ?)",
  );
  const ca = db.prepare("INSERT OR IGNORE INTO corpus_artists (artist_id, is_seed) VALUES (?, 1)");
  // Pass 1 writes one pair per (label, artist line) across the WHOLE dump, and
  // the label grade is measured against it, so the fixtures have to carry it
  // too. Credits are deliberately absent: an engineer on a record is not
  // evidence about who the label puts out.
  const lp = db.prepare(
    "INSERT OR IGNORE INTO label_artist_pairs (label_id, artist_id) VALUES (?, ?)",
  );
  // The label rows `entities` writes. label_coverage is driven from them, since
  // a label with no page is a label with nothing to grade.
  const lb = db.prepare("INSERT OR IGNORE INTO labels (id, name) VALUES (?, ?)");

  for (const rel of releases) {
    r.run(rel.id, `Release ${rel.id}`, rel.year ?? null, rel.seed === false ? 0 : 1);
    for (const s of rel.styles ?? []) st.run(rel.id, s);
    for (const g of rel.genres ?? []) gn.run(rel.id, g);
    (rel.artists ?? []).forEach((id, i) => {
      a.run(rel.id, i, id, `Artist ${id}`);
      ca.run(id);
    });
    (rel.credits ?? []).forEach(([id, role], i) => {
      c.run(rel.id, i, id, `Artist ${id}`, role);
      ca.run(id);
    });
    (rel.labels ?? []).forEach((id, i) => {
      l.run(rel.id, i, id, `Label ${id}`);
      lb.run(id, `Label ${id}`);
      for (const artist of rel.artists ?? []) lp.run(id, artist);
    });
  }
  return db;
}

test("ranks collaborators by shared releases, never alphabetically", async () => {
  // Frequency is the signal. The person on three records belongs above the
  // person on one, which is the whole bet of the project.
  const db = corpus([
    { id: 1, artists: [10, 11] },
    { id: 2, artists: [10, 11] },
    { id: 3, artists: [10, 11] },
    { id: 4, artists: [10, 12] },
  ]);
  await runDerive(db);

  const rows = db
    .prepare(
      "SELECT collaborator_id, shared_releases FROM artist_collaborators WHERE artist_id = 10 ORDER BY shared_releases DESC",
    )
    .all();
  assert.deepEqual(rows, [
    { collaborator_id: 11, shared_releases: 3 },
    { collaborator_id: 12, shared_releases: 1 },
  ]);
});

test("pairs the artist line with the credits, so engineers are collaborators", async () => {
  const db = corpus([{ id: 1, artists: [10], credits: [[20, "Engineer"]] }]);
  await runDerive(db);

  const row = db
    .prepare("SELECT collaborator_id, roles FROM artist_collaborators WHERE artist_id = 10")
    .get();
  assert.deepEqual(row, { collaborator_id: 20, roles: "Engineer" });
});

test("keeps the raw role strings a collaborator held, unnormalised", async () => {
  const db = corpus([
    { id: 1, artists: [10], credits: [[20, "Engineer [Recording]"]] },
    { id: 2, artists: [10], credits: [[20, "Mixed By"]] },
  ]);
  await runDerive(db);

  const roles = db
    .prepare("SELECT roles FROM artist_collaborators WHERE artist_id = 10")
    .pluck()
    .get() as string;
  assert.deepEqual(roles.split("\n").sort(), ["Engineer [Recording]", "Mixed By"]);
});

test("nobody collaborates with themselves", async () => {
  const db = corpus([{ id: 1, artists: [10], credits: [[10, "Producer"]] }]);
  await runDerive(db);
  assert.equal(
    db.prepare("SELECT count(*) FROM artist_collaborators WHERE artist_id = collaborator_id").pluck().get(),
    0,
  );
});

test("a big compilation makes no collaborators, but is still kept", async () => {
  // Track 7 and track 31 of a forty-artist compilation are not collaborators.
  const many = Array.from({ length: 25 }, (_, i) => 100 + i);
  const db = corpus([{ id: 1, artists: many }, { id: 2, artists: [100, 101] }]);
  const stats = await runDerive(db, { maxPeoplePerRelease: 20 });

  assert.equal(stats.releasesSkippedForPairs, 1);
  assert.equal(
    db.prepare("SELECT shared_releases FROM artist_collaborators WHERE artist_id = 100 AND collaborator_id = 101").pluck().get(),
    1,
    "only the two-artist release should count",
  );
  assert.equal(db.prepare("SELECT count(*) FROM releases").pluck().get(), 2);
});

test("artist labels carry release counts and the span of years", async () => {
  const db = corpus([
    { id: 1, artists: [10], labels: [500], year: 1994 },
    { id: 2, artists: [10], labels: [500], year: 1998 },
    { id: 3, artists: [10], labels: [501], year: 2003 },
  ]);
  await runDerive(db);

  const rows = db
    .prepare(
      "SELECT label_id, release_count, first_year, last_year FROM artist_labels WHERE artist_id = 10 ORDER BY release_count DESC",
    )
    .all();
  assert.deepEqual(rows, [
    { label_id: 500, release_count: 2, first_year: 1994, last_year: 1998 },
    { label_id: 501, release_count: 1, first_year: 2003, last_year: 2003 },
  ]);
});

test("label roster is ranked by release count", async () => {
  const db = corpus([
    { id: 1, artists: [10], labels: [500] },
    { id: 2, artists: [10], labels: [500] },
    { id: 3, artists: [11], labels: [500] },
  ]);
  await runDerive(db);

  const rows = db
    .prepare("SELECT artist_id, release_count FROM label_roster WHERE label_id = 500 ORDER BY release_count DESC")
    .all();
  assert.deepEqual(rows, [
    { artist_id: 10, release_count: 2 },
    { artist_id: 11, release_count: 1 },
  ]);
});

const labelGrade = (db: Database.Database, id: number) =>
  db.prepare("SELECT relevance FROM label_coverage WHERE label_id = ?").pluck().get(id);

/** A label with `total` acts on its line, `seeds` of them in the seed set. */
const roster = (labelId: number, total: number, seeds: number) => {
  const rows = Array.from({ length: total }, (_, i) => ({
    id: labelId * 10 + i,
    artists: [labelId * 100 + i],
    labels: [labelId],
  }));
  return {
    rows,
    seeds: Array.from({ length: seeds }, (_, i) => [labelId * 100 + i, 9, 10] as [number, number, number]),
  };
};

test("a label is graded on the same five steps as an artist", async () => {
  // Chain Reaction: everyone it puts out is in the cluster. The top step is the
  // seed-label rule itself, so what the corpus calls a scene label and what a
  // reader is told are one decision, not two.
  const pure = roster(500, 4, 4);
  // Ndagga: three of the seven acts it released are in the cluster. Under the
  // seed-label dial and nowhere near a major, which is the room the step below
  // the top exists for. Before the scale it read the same word as Columbia,
  // and before the fifth step it read the same word as Warp.
  const close = roster(650, 7, 3);
  // Warp: four of thirteen. Real ties, and not a room this scene lives in.
  const near = roster(600, 13, 4);
  // A major: one act in the cluster among twenty.
  const major = roster(700, 20, 1);

  const db = corpus([...pure.rows, ...close.rows, ...near.rows, ...major.rows]);
  seed(db, [...pure.seeds, ...close.seeds, ...near.seeds, ...major.seeds]);
  await runDerive(db);

  assert.equal(labelGrade(db, 500), "very high");
  assert.equal(labelGrade(db, 650), "high");
  assert.equal(labelGrade(db, 600), "medium");
  assert.equal(labelGrade(db, 700), "low");
});

test("the top label step is still exactly the seed-label rule", async () => {
  // The invariant check-corpus asserts, in miniature. Renaming the top step
  // must not move it: a label at the seed dial is very high and one a hair
  // under it is not, whatever the step below is called.
  const at = roster(510, 4, 2); // 50%, the dial itself
  const under = roster(520, 5, 2); // 40%, a hair under
  const db = corpus([...at.rows, ...under.rows]);
  seed(db, [...at.seeds, ...under.seeds]);
  await runDerive(db);

  assert.equal(labelGrade(db, 510), "very high");
  assert.equal(labelGrade(db, 520), "high");
});

test("a label ratio needs two names behind it", async () => {
  // One act, in the cluster, and nothing else: 100% of a roster of one. The
  // floor is what stops a single self-release reading as a scene label, and it
  // guards the middle step for the same reason it guards the top one.
  const one = roster(800, 1, 1);
  const db = corpus(one.rows);
  seed(db, one.seeds);
  await runDerive(db);

  assert.equal(labelGrade(db, 800), "low");
});

test("a label with nobody from the cluster on its line is graded, not skipped", async () => {
  const db = corpus(roster(900, 3, 0).rows);
  await runDerive(db);

  assert.deepEqual(db.prepare("SELECT seed_artist_count, line_artist_count, relevance FROM label_coverage WHERE label_id = 900").get(), {
    seed_artist_count: 0,
    line_artist_count: 3,
    relevance: "none",
  });
});

test("the label grade reads the artist line, not the roster the page lists", async () => {
  // The distinction that made this table necessary. A mastering engineer from
  // the cluster appears on the label page's roster and says nothing about who
  // the label puts out, so the grade must not count him. The roster still
  // lists him: two different questions, and the page has to answer both.
  const db = corpus([
    { id: 1, artists: [10], credits: [[11, "Mastered By"]], labels: [450] },
    { id: 2, artists: [10], credits: [[11, "Mastered By"]], labels: [450] },
  ]);
  seed(db, [[11, 9, 10]]);
  await runDerive(db);

  assert.equal(labelGrade(db, 450), "none");
  assert.equal(
    db.prepare("SELECT count(*) FROM label_roster WHERE label_id = 450").pluck().get(),
    2,
  );
});

test("coverage tells 'no credits recorded' apart from 'worked solo'", async () => {
  // The distinction the interface depends on. An empty result that looks like
  // an answer is worse than an honest "no data here".
  const db = corpus([
    { id: 1, artists: [10] }, // nobody has entered credits
    { id: 2, artists: [11], credits: [[11, "Producer"]] }, // credited, but alone
  ]);
  await runDerive(db);

  const undocumented = db.prepare("SELECT * FROM artist_coverage WHERE artist_id = 10").get() as {
    release_count: number;
    credited_releases: number;
    collaborator_count: number;
  };
  assert.deepEqual(undocumented, {
    artist_id: 10,
    release_count: 1,
    credited_releases: 0,
    collaborator_count: 0,
    label_count: 0,
    first_year: null,
    last_year: null,
    // On the one seed release in this fixture, and graded 'none' regardless:
    // the count is what the corpus holds, the grade is what pass 1 measured.
    seed_releases: 1,
    seed_share: null,
    scene_relevance: "none",
    relevance: "none",
    lineage: null,
  } as never);

  const solo = db.prepare("SELECT credited_releases, collaborator_count FROM artist_coverage WHERE artist_id = 11").get();
  assert.deepEqual(solo, { credited_releases: 1, collaborator_count: 0 });
});

/** Records what pass 1 measured about a seed artist: core releases, and total. */
function seed(db: Database.Database, rows: [id: number, seed: number, total: number | null][]) {
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO seed_artists (artist_id, seed_releases, total_releases) VALUES (?, ?, ?)",
  );
  for (const [id, n, total] of rows) stmt.run(id, n, total);
}

const relevanceOf = (db: Database.Database, id: number) =>
  db.prepare("SELECT relevance FROM artist_coverage WHERE artist_id = ?").pluck().get(id);

test("relevance needs both a body of core work and a share of the output", async () => {
  // The two failure modes it exists to avoid, side by side. 12 has the deepest
  // catalogue in the seed and is still not high, because it is a sliver of what
  // they do; 11 does almost nothing else and is.
  const db = corpus([{ id: 1, artists: [10, 11, 12] }]);
  seed(db, [
    [10, 61, 77], //  79%, Basic Channel
    [11, 8, 10], //   80% off a small output
    [12, 114, 1079], // 11%, Aphex Twin
  ]);
  await runDerive(db);

  assert.equal(relevanceOf(db, 10), "very high");
  assert.equal(relevanceOf(db, 11), "very high");
  assert.equal(relevanceOf(db, 12), "high");
});

test("the top step is more than half the output, and the one below reaches down", async () => {
  // The seam the fifth step opened. Everything here used to read one word.
  const db = corpus([{ id: 1, artists: [10, 11, 12, 13] }]);
  seed(db, [
    [10, 142, 145], //  98%, Fluxion: the scene and almost nothing else
    [11, 234, 609], //  38%, Moritz von Oswald: deep, and he does other things
    [12, 160, 1039], // 15%, Jeff Mills: the bar the old top step sat on
    [13, 114, 1079], // 11%, Aphex Twin: reaches high on volume, not on share
  ]);
  await runDerive(db);

  assert.equal(relevanceOf(db, 10), "very high");
  assert.equal(relevanceOf(db, 11), "high");
  assert.equal(relevanceOf(db, 12), "high");
  assert.equal(relevanceOf(db, 13), "high");
});

test("a deep catalogue with a thin share stops at high, not the top step", async () => {
  // The volume route reaches the step below the top and no further. Share is
  // what the top step measures, so a big number cannot buy it.
  const db = corpus([{ id: 1, artists: [10] }]);
  seed(db, [[10, 400, 4000]]); // 10%, a huge body of work
  await runDerive(db);
  assert.equal(relevanceOf(db, 10), "high");
});

test("the volume route needs a share behind it as well as a count", async () => {
  // 25 records is a body of work whatever else the artist did, which is medium.
  // It is not high unless a real fraction of the output is in the cluster.
  const db = corpus([{ id: 1, artists: [10] }]);
  seed(db, [[10, 25, 5000]]); // 0.5%
  await runDerive(db);
  assert.equal(relevanceOf(db, 10), "medium");
});

test("the five-release floor still guards the top step", async () => {
  // Two records out of two is 100%, and the floor is what stops it reading as
  // devotion. 31,809 artists sit in exactly this shape, which is why the floor
  // did not move when the step above it was added.
  const db = corpus([{ id: 1, artists: [10] }]);
  seed(db, [[10, 2, 2]]);
  await runDerive(db);
  assert.equal(relevanceOf(db, 10), "medium");
});

test("one record in the seed is low however pure it looks", async () => {
  // Share alone would read this as 100% and rank it above Moritz von Oswald.
  const db = corpus([{ id: 1, artists: [10] }]);
  seed(db, [[10, 1, 1]]);
  await runDerive(db);
  assert.equal(relevanceOf(db, 10), "low");
});

test("enough core work is medium whatever the share", async () => {
  const db = corpus([{ id: 1, artists: [10] }]);
  seed(db, [[10, 25, 5000]]); // 0.5%, but 25 records is a body of work
  await runDerive(db);
  assert.equal(relevanceOf(db, 10), "medium");
});

test("an artist who reached the corpus by one hop has no relevance grade", async () => {
  // Not a low score: they have no seed work at all. Mozart is here because a
  // record really does credit him, and the page should say only that.
  const db = corpus([{ id: 1, artists: [10] }]);
  await runDerive(db);
  assert.equal(relevanceOf(db, 10), "none");
  assert.equal(
    db.prepare("SELECT seed_share FROM artist_coverage WHERE artist_id = 10").pluck().get(),
    null,
  );
});

test("without a measured total nobody is graded high", async () => {
  // Pass 1 only counts totals when the seed ratio is on. Guessing a denominator
  // would be worse than declining to grade.
  const db = corpus([{ id: 1, artists: [10] }]);
  seed(db, [[10, 61, null]]);
  await runDerive(db);
  assert.equal(relevanceOf(db, 10), "medium");
});

const coverageOf = (db: Database.Database, id: number) =>
  db
    .prepare(
      "SELECT seed_releases, seed_share, scene_relevance, relevance, lineage FROM artist_coverage WHERE artist_id = ?",
    )
    .get(id);

test("seed releases are counted for artists the ratio rejected", async () => {
  // King Tubby: on real seed releases, but 0.51% of a reissue-inflated
  // catalogue, so pass 1 dropped him and the page reported nothing at all.
  const db = corpus([
    { id: 1, artists: [10] },
    { id: 2, credits: [[10, "Mixed By"]] },
    { id: 3, artists: [10], seed: false },
  ]);
  db.prepare("INSERT INTO seed_artist_totals (artist_id, total) VALUES (10, 400)").run();
  await runDerive(db);

  assert.deepEqual(coverageOf(db, 10), {
    seed_releases: 2,
    seed_share: 2 / 400,
    // Still not scene membership, and the share is what says so.
    scene_relevance: "none",
    relevance: "none",
    lineage: null,
  });
});

test("a release counts once when someone is on the artist line and in the credits", async () => {
  // Pass 1 counts appearances, which is why it has Jeff Mills at 160 where the
  // corpus holds 116 releases. What a page shows is releases.
  const db = corpus([{ id: 1, artists: [10], credits: [[10, "Producer"]] }]);
  db.prepare("INSERT INTO seed_artist_totals (artist_id, total) VALUES (10, 10)").run();
  await runDerive(db);

  assert.equal(
    db.prepare("SELECT seed_releases FROM artist_coverage WHERE artist_id = 10").pluck().get(),
    1,
  );
});

/** Five records in a tradition, plus one outside it: over both dials. */
const tradition = (id: number, tags: { styles?: string[]; genres?: string[]; labels?: number[] }) => [
  ...Array.from({ length: 5 }, (_, i) => ({ id: id * 1000 + i, artists: [id], seed: false, ...tags })),
  { id: id * 1000 + 9, artists: [id], seed: false },
];

test("a tradition lifts the grade to the floor, and keeps the measurement", async () => {
  // King Tubby. Reggae dub is invisible to a seed that admits Dub only on genre
  // Electronic, so no measure of the scene can reach him: 'none' is what the
  // corpus knows and 'medium' is what the tool says.
  const db = corpus(tradition(10, { styles: ["Dub"], genres: ["Reggae"] }));
  await runDerive(db);

  assert.deepEqual(coverageOf(db, 10), {
    seed_releases: 0,
    seed_share: null,
    scene_relevance: "none",
    relevance: "medium",
    lineage: "roots dub",
  });
});

test("a tradition lifts to the floor and no further", async () => {
  // 11 is already at the top step on scene work. The tag describes them; it
  // cannot promote them, and it must not demote them to the floor either.
  const db = corpus([
    ...tradition(11, { styles: ["Dub"], genres: ["Reggae"] }),
    { id: 500, artists: [11] },
  ]);
  seed(db, [[11, 61, 77]]);
  await runDerive(db);

  const row = coverageOf(db, 11) as { scene_relevance: string; relevance: string };
  assert.equal(row.scene_relevance, "very high");
  assert.equal(row.relevance, "very high");
});

test("afrobeat and detroit techno are traditions too", async () => {
  // Afrobeat off a style, Detroit off the imprints, because `Detroit Techno` is
  // not a Discogs style and `Techno` is too broad to be one.
  const db = corpus([
    ...tradition(12, { styles: ["Afrobeat"] }),
    ...tradition(13, { labels: [415] }), // Metroplex
  ]);
  await runDerive(db);

  assert.equal(db.prepare("SELECT lineage FROM artist_coverage WHERE artist_id = 12").pluck().get(), "afrobeat");
  assert.equal(db.prepare("SELECT relevance FROM artist_coverage WHERE artist_id = 12").pluck().get(), "medium");
  assert.equal(db.prepare("SELECT lineage FROM artist_coverage WHERE artist_id = 13").pluck().get(), "detroit techno");
});

test("a tradition can be read off more than one style", async () => {
  // Dubstep and UK garage are one tradition and two Discogs styles, so the rule
  // has to count them together. Three dubstep records and two garage ones is a
  // catalogue in that scene; neither style on its own reaches the floor of five,
  // and a rule that could only name one style would miss the artist entirely.
  const db = corpus([
    ...Array.from({ length: 3 }, (_, i) => ({ id: 21000 + i, artists: [21], seed: false, styles: ["Dubstep"] })),
    ...Array.from({ length: 2 }, (_, i) => ({ id: 21100 + i, artists: [21], seed: false, styles: ["UK Garage"] })),
    { id: 21999, artists: [21], seed: false },
  ]);
  await runDerive(db);

  assert.deepEqual(coverageOf(db, 21), {
    seed_releases: 0,
    seed_share: null,
    scene_relevance: "none",
    relevance: "medium",
    lineage: "dubstep and uk garage",
  });
});

test("a tradition can be read off the genre alone", async () => {
  // Reggae, and the reason it has to be: 17 of Toots & The Maytals' 45 records
  // carry a genre and no style at all, so a style rule cannot see them.
  const db = corpus(tradition(19, { genres: ["Reggae"] }));
  await runDerive(db);

  assert.deepEqual(coverageOf(db, 19), {
    seed_releases: 0,
    seed_share: null,
    scene_relevance: "none",
    relevance: "low",
    lineage: "reggae",
  });
});

test("dub claims a Jamaican artist before reggae does", async () => {
  // Both rules match a dub record on genre Reggae. The dub line is the closer
  // relation, and it runs first, so it wins and the grade is a step higher.
  const db = corpus(tradition(20, { styles: ["Dub"], genres: ["Reggae"] }));
  await runDerive(db);

  const row = coverageOf(db, 20) as { relevance: string; lineage: string };
  assert.equal(row.lineage, "roots dub");
  assert.equal(row.relevance, "medium");
});

test("a tradition lifts to its own floor, not to a shared one", async () => {
  // Acid jazz and jungle carry a Jamaican inheritance at one remove, so Talkin'
  // Loud lifts one step where the dub line lifts two.
  const db = corpus(tradition(18, { labels: [118] })); // Talkin' Loud
  await runDerive(db);

  assert.deepEqual(coverageOf(db, 18), {
    seed_releases: 0,
    seed_share: null,
    scene_relevance: "none",
    relevance: "low",
    lineage: "acid jazz and DNB",
  });
});

test("one tag per artist, styles before labels", async () => {
  // A Jamaican player who also cut for Metroplex reads as what they mostly are.
  const db = corpus([
    ...tradition(14, { styles: ["Dub"], genres: ["Reggae"], labels: [415] }),
  ]);
  await runDerive(db);
  assert.equal(db.prepare("SELECT lineage FROM artist_coverage WHERE artist_id = 14").pluck().get(), "roots dub");
});

test("dub on any other genre is not the roots tradition", async () => {
  // The genre is the whole distinction: electronic dub is the scene itself, and
  // tagging it as an ancestor of itself would say nothing.
  const db = corpus(tradition(15, { styles: ["Dub", "Dub Techno"], genres: ["Electronic"] }));
  await runDerive(db);
  assert.equal(db.prepare("SELECT lineage FROM artist_coverage WHERE artist_id = 15").pluck().get(), null);
});

test("a tradition needs both the floor and the share", async () => {
  const roots = { seed: false, styles: ["Dub"], genres: ["Reggae"] };
  // 16 has four roots records, all they ever made: pure, but under the floor.
  // 17 has five, in a catalogue of fifty: a body of them, but a side project.
  const db = corpus([
    { id: 1, artists: [16], ...roots },
    { id: 2, artists: [16], ...roots },
    { id: 3, artists: [16], ...roots },
    { id: 4, artists: [16], ...roots },
    ...Array.from({ length: 5 }, (_, i) => ({ id: 100 + i, artists: [17], ...roots })),
    ...Array.from({ length: 45 }, (_, i) => ({ id: 200 + i, artists: [17], seed: false })),
  ]);
  await runDerive(db);

  assert.equal(db.prepare("SELECT lineage FROM artist_coverage WHERE artist_id = 16").pluck().get(), null);
  assert.equal(db.prepare("SELECT lineage FROM artist_coverage WHERE artist_id = 17").pluck().get(), null);
});

test("a second run replaces the first rather than layering on top of it", async () => {
  const db = corpus([{ id: 1, artists: [10, 11] }]);
  await runDerive(db);
  await runDerive(db);
  assert.equal(
    db.prepare("SELECT shared_releases FROM artist_collaborators WHERE artist_id = 10").pluck().get(),
    1,
    "counts doubled, so the tables were not rebuilt",
  );
});
