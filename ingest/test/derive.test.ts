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
  }[],
): Database.Database {
  const db = openDb(":memory:");
  const r = db.prepare("INSERT INTO releases (id, title, year, is_seed) VALUES (?, ?, ?, 1)");
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
    r.run(rel.id, `Release ${rel.id}`, rel.year ?? null);
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
  } as never);

  const solo = db.prepare("SELECT credited_releases, collaborator_count FROM artist_coverage WHERE artist_id = 11").get();
  assert.deepEqual(solo, { credited_releases: 1, collaborator_count: 0 });
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
