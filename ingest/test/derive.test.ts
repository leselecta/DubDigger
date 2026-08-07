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
    (rel.labels ?? []).forEach((id, i) => l.run(rel.id, i, id, `Label ${id}`));
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

  assert.equal(relevanceOf(db, 10), "high");
  assert.equal(relevanceOf(db, 11), "high");
  assert.equal(relevanceOf(db, 12), "medium");
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
  db.prepare("SELECT seed_releases, seed_share, relevance, lineage FROM artist_coverage WHERE artist_id = ?").get(id);

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

test("roots dub is tagged as lineage, and never as relevance", async () => {
  // The tradition the scene came out of. Reggae dub is invisible to a seed that
  // admits Dub only on genre Electronic, so no relevance grade can reach it.
  const roots = { seed: false, styles: ["Dub"], genres: ["Reggae"] };
  const db = corpus([
    { id: 1, artists: [10], ...roots },
    { id: 2, artists: [10], ...roots },
    { id: 3, artists: [10], ...roots },
    { id: 4, artists: [10], ...roots },
    { id: 5, artists: [10], ...roots },
    { id: 6, artists: [10], seed: false },
  ]);
  await runDerive(db);

  assert.deepEqual(coverageOf(db, 10), {
    seed_releases: 0,
    seed_share: null,
    relevance: "none",
    lineage: "roots dub",
  });
});

test("lineage needs both the floor and the share", async () => {
  const roots = { seed: false, styles: ["Dub"], genres: ["Reggae"] };
  // 11 has four roots records, all they ever made: pure, but under the floor.
  // 12 has five, in a catalogue of fifty: a body of them, but a side project.
  const db = corpus([
    { id: 1, artists: [11], ...roots },
    { id: 2, artists: [11], ...roots },
    { id: 3, artists: [11], ...roots },
    { id: 4, artists: [11], ...roots },
    ...Array.from({ length: 5 }, (_, i) => ({ id: 100 + i, artists: [12], ...roots })),
    ...Array.from({ length: 45 }, (_, i) => ({ id: 200 + i, artists: [12], seed: false })),
  ]);
  await runDerive(db);

  assert.equal(db.prepare("SELECT lineage FROM artist_coverage WHERE artist_id = 11").pluck().get(), null);
  assert.equal(db.prepare("SELECT lineage FROM artist_coverage WHERE artist_id = 12").pluck().get(), null);
});

test("dub on any other genre is not the roots tradition", async () => {
  // The genre is the whole distinction: electronic dub is the scene itself, and
  // tagging it as an ancestor of itself would say nothing.
  const db = corpus(
    Array.from({ length: 6 }, (_, i) => ({
      id: i + 1,
      artists: [10],
      styles: ["Dub", "Dub Techno"],
      genres: ["Electronic"],
    })),
  );
  await runDerive(db);
  assert.equal(db.prepare("SELECT lineage FROM artist_coverage WHERE artist_id = 10").pluck().get(), null);
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
