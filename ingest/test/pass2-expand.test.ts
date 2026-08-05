import test from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";

import { openDb } from "../src/db/open.ts";
import { runPass2, type Pass2Options } from "../src/steps/pass2-expand.ts";
import type { ParsedRelease } from "../src/lib/release-stream.ts";

function release(partial: Partial<ParsedRelease> & { id: number }): ParsedRelease {
  return {
    title: `Release ${partial.id}`,
    year: null,
    artists: [],
    credits: [],
    labels: [],
    styles: [],
    genres: [],
    ...partial,
  };
}

const artist = (id: number) => ({ id, name: `Artist ${id}`, joinPhrase: null });
const credit = (id: number, role = "Producer") => ({ id, name: `Artist ${id}`, role });
const label = (id: number) => ({ id, name: `Label ${id}`, catno: null });

/** A database with pass 1's output already in place. */
function seeded(seedArtists: number[], seedLabels: number[]): Database.Database {
  const db = openDb(":memory:");
  const a = db.prepare("INSERT INTO seed_artists (artist_id, seed_releases) VALUES (?, 1)");
  for (const id of seedArtists) a.run(id);
  const l = db.prepare(
    `INSERT INTO seed_labels (label_id, seed_artist_count, total_artist_count, seed_ratio)
     VALUES (?, 2, 2, 1.0)`,
  );
  for (const id of seedLabels) l.run(id);
  return db;
}

const ids = (db: Database.Database, sql: string): number[] =>
  db.prepare(sql).all().map((r) => Object.values(r as object)[0] as number);

async function pass2(
  db: Database.Database,
  releases: ParsedRelease[],
  options: Pass2Options = {},
) {
  return runPass2(db, releases, options);
}

test("channel A keeps a release that credits a seed artist", async () => {
  const db = seeded([10], []);
  const stats = await pass2(db, [
    release({ id: 1, artists: [artist(10)] }),
    release({ id: 2, artists: [artist(99)] }),
  ]);

  assert.equal(stats.keptChannelA, 1);
  assert.deepEqual(ids(db, "SELECT id FROM releases ORDER BY id"), [1]);
  assert.equal(db.prepare("SELECT channel_a FROM releases WHERE id = 1").pluck().get(), 1);
});

test("channel A also fires on an extraartist credit, not just the artist line", async () => {
  // Following the engineer is the whole point of the tool.
  const db = seeded([20], []);
  const stats = await pass2(db, [release({ id: 1, artists: [artist(99)], credits: [credit(20)] })]);
  assert.equal(stats.keptChannelA, 1);
});

test("channel B keeps a release on a seed label even with no seed artist on it", async () => {
  // The pure label-mate. Without this channel, label rosters come out
  // silently incomplete, which breaks the query a label page exists to answer.
  const db = seeded([10], [500]);
  const stats = await pass2(db, [release({ id: 1, artists: [artist(99)], labels: [label(500)] })]);

  assert.equal(stats.keptChannelB, 1);
  assert.equal(stats.keptChannelA, 0);
  assert.equal(db.prepare("SELECT channel_b FROM releases WHERE id = 1").pluck().get(), 1);
});

test("a release qualifying on both channels is tagged with both", async () => {
  const db = seeded([10], [500]);
  const stats = await pass2(db, [release({ id: 1, artists: [artist(10)], labels: [label(500)] })]);

  assert.equal(stats.keptBoth, 1);
  const row = db.prepare("SELECT channel_a, channel_b FROM releases WHERE id = 1").get() as {
    channel_a: number;
    channel_b: number;
  };
  assert.deepEqual(row, { channel_a: 1, channel_b: 1 });
});

test("drops a release that matches neither channel", async () => {
  const db = seeded([10], [500]);
  const stats = await pass2(db, [release({ id: 1, artists: [artist(99)], labels: [label(999)] })]);

  assert.equal(stats.totalKept, 0);
  assert.equal(db.prepare("SELECT count(*) FROM releases").pluck().get(), 0);
});

test("harvests artists from kept releases, tagged with how they arrived", async () => {
  const db = seeded([10], [500]);
  await pass2(db, [
    release({ id: 1, artists: [artist(10), artist(11)] }), // channel A
    release({ id: 2, artists: [artist(12)], labels: [label(500)] }), // channel B
  ]);

  const rows = db
    .prepare("SELECT artist_id, is_seed, channel_a, channel_b FROM corpus_artists ORDER BY artist_id")
    .all();
  assert.deepEqual(rows, [
    { artist_id: 10, is_seed: 1, channel_a: 1, channel_b: 0 },
    { artist_id: 11, is_seed: 0, channel_a: 1, channel_b: 0 },
    { artist_id: 12, is_seed: 0, channel_a: 0, channel_b: 1 },
  ]);
});

test("stops at one hop: a newly admitted artist does not pull in their own back catalogue", async () => {
  // Artist 11 arrives via a collaboration with seed artist 10. Release 2 is
  // theirs alone and must NOT be kept, or expansion runs away and eventually
  // swallows most of techno.
  const db = seeded([10], []);
  const stats = await pass2(db, [
    release({ id: 1, artists: [artist(10), artist(11)] }),
    release({ id: 2, artists: [artist(11)] }),
  ]);

  assert.equal(stats.totalKept, 1);
  assert.deepEqual(ids(db, "SELECT id FROM releases"), [1]);
});

test("placeholder artists never enter the corpus or trigger a channel", async () => {
  const db = seeded([10], [500]);
  await pass2(db, [
    release({
      id: 1,
      artists: [{ id: 194, name: "Various", joinPhrase: null }],
      labels: [label(500)],
    }),
  ]);
  assert.deepEqual(ids(db, "SELECT artist_id FROM corpus_artists"), []);
});

test("placeholder labels never trigger channel B", async () => {
  const db = seeded([10], [1818]);
  const stats = await pass2(db, [
    release({ id: 1, artists: [artist(99)], labels: [{ id: 1818, name: "Not On label", catno: null }] }),
  ]);
  assert.equal(stats.totalKept, 0);
});

test("the channel A tie-strength dial filters one-off guest spots", async () => {
  // Artist 11 appears on one seed-artist release, artist 12 on two. At a
  // threshold of 2 only artist 12 earns channel A membership.
  const db = seeded([10], []);
  await pass2(
    db,
    [
      release({ id: 1, artists: [artist(10), artist(11), artist(12)] }),
      release({ id: 2, artists: [artist(10), artist(12)] }),
    ],
    { channelAMinSharedReleases: 2 },
  );

  const admitted = ids(db, "SELECT artist_id FROM corpus_artists WHERE channel_a = 1 ORDER BY artist_id");
  assert.ok(admitted.includes(12), "artist 12 has two ties and should be in");
  assert.ok(!admitted.includes(11), "artist 11 has one tie and should be filtered");
});

test("keeps pass 1's seed releases and their is_seed flag intact", async () => {
  const db = seeded([10], []);
  db.prepare("INSERT INTO releases (id, title, year, is_seed) VALUES (1, 'Seed', 1994, 1)").run();

  await pass2(db, [release({ id: 1, artists: [artist(10)] })]);

  const row = db.prepare("SELECT is_seed, channel_a FROM releases WHERE id = 1").get();
  assert.deepEqual(row, { is_seed: 1, channel_a: 1 });
});

test("a second run replaces the first rather than layering on top of it", async () => {
  const db = seeded([10], []);
  db.prepare("INSERT INTO releases (id, title, year, is_seed) VALUES (99, 'Seed', 1994, 1)").run();

  await pass2(db, [release({ id: 1, artists: [artist(10), artist(11)] })]);
  await pass2(db, [release({ id: 2, artists: [artist(10), artist(12)] })]);

  assert.deepEqual(ids(db, "SELECT id FROM releases ORDER BY id"), [2, 99], "run 1 releases survived");
  assert.ok(!ids(db, "SELECT artist_id FROM corpus_artists").includes(11), "run 1 artists survived");
});

test("rebuilds the bulk-load indexes it drops", async () => {
  // The indexes are dropped for the load and recreated after. If that recreate
  // is ever skipped, every artist page query degrades to a full table scan and
  // nothing visibly fails.
  const db = seeded([10], []);
  await pass2(db, [release({ id: 1, artists: [artist(10)] })]);

  const indexes = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_release%'")
    .pluck()
    .all() as string[];

  for (const expected of [
    "idx_release_artists_artist",
    "idx_release_credits_artist",
    "idx_release_labels_label",
    "idx_release_styles_style",
  ]) {
    assert.ok(indexes.includes(expected), `${expected} was not rebuilt`);
  }
});
