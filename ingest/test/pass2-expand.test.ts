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
  return runPass2(db, () => releases, options);
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
  // Artist 10 is present because seed artists are corpus members by definition,
  // whether or not this pass happened to see them on anything.
  assert.ok(!ids(db, "SELECT artist_id FROM corpus_artists").includes(194));
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

test("a seed artist who barely works in the scene stops acting as a bridge", async () => {
  // Artist 10 was credited on 1 seed release out of 4 appearances (25%), and
  // artist 11 on 1 of 1 (100%). At a 50% floor only artist 11 bridges. This is
  // the Bob Ludwig case: he mastered a few scene records among 60,386, and
  // every one of the rest walked in behind him.
  const db = seeded([10, 11], []);
  db.prepare("UPDATE seed_artists SET seed_releases = 1 WHERE artist_id = 10").run();

  const stats = await pass2(
    db,
    [
      release({ id: 1, credits: [credit(10, "Mastered By")], artists: [artist(90)] }),
      release({ id: 2, credits: [credit(10, "Mastered By")], artists: [artist(91)] }),
      release({ id: 3, credits: [credit(10, "Mastered By")], artists: [artist(92)] }),
      release({ id: 4, artists: [artist(11), artist(93)] }),
    ],
    { channelAMinSeedRatio: 0.5 },
  );

  assert.equal(stats.suppressedBridges, 1, "artist 10 does 25% of their work here");
  assert.deepEqual(ids(db, "SELECT id FROM releases ORDER BY id"), [4]);
  assert.ok(!ids(db, "SELECT artist_id FROM corpus_artists").includes(90));
});

test("a prolific artist who works mostly in the scene keeps bridging", async () => {
  // Moritz von Oswald has 556 credits, so any flat cap tight enough to stop a
  // mastering hub would also stop him. 42.8% of his work is in the seed.
  const db = seeded([10], []);
  db.prepare("UPDATE seed_artists SET seed_releases = 3 WHERE artist_id = 10").run();

  const stats = await pass2(
    db,
    [
      release({ id: 1, artists: [artist(10), artist(90)] }),
      release({ id: 2, artists: [artist(10), artist(91)] }),
      release({ id: 3, artists: [artist(10)] }),
      release({ id: 4, artists: [artist(10)] }),
    ],
    { channelAMinSeedRatio: 0.5 },
  );

  assert.equal(stats.suppressedBridges, 0, "3 of 4 appearances are in the seed");
  assert.equal(stats.totalKept, 4);
});

test("the bridge check can be switched off", async () => {
  const db = seeded([10], []);
  const stats = await pass2(db, [release({ id: 1, artists: [artist(10)] })], {
    channelAMinSeedRatio: null,
  });
  assert.equal(stats.suppressedBridges, 0);
  assert.equal(stats.totalKept, 1);
});

test("a crowded release is kept but admits nobody new", async () => {
  // Track 7 and track 31 of a compilation share shelf space, not a record.
  // This is how a gospel album and an Italian punk anthology each put an
  // unrelated act called "Chain Reaction" into a dub techno corpus.
  const db = seeded([10], []);
  const crowd = Array.from({ length: 9 }, (_, i) => artist(100 + i));

  const stats = await pass2(
    db,
    [release({ id: 1, artists: [artist(10), ...crowd] })],
    { channelAMaxPeopleToAdmit: 8 },
  );

  assert.equal(stats.crowdedReleases, 1);
  assert.equal(stats.totalKept, 1, "the release itself is still kept");
  assert.deepEqual(
    ids(db, "SELECT artist_id FROM corpus_artists"),
    [10],
    "only the seed artist, nobody from the crowd",
  );
});

test("an intimate release still admits its people", async () => {
  const db = seeded([10], []);
  const stats = await pass2(
    db,
    [release({ id: 1, artists: [artist(10), artist(11)] })],
    { channelAMaxPeopleToAdmit: 8 },
  );

  assert.equal(stats.crowdedReleases, 0);
  assert.deepEqual(ids(db, "SELECT artist_id FROM corpus_artists ORDER BY artist_id"), [10, 11]);
});

test("a seed artist stays in the corpus even if only ever seen in a crowd", async () => {
  const db = seeded([10], []);
  const crowd = Array.from({ length: 9 }, (_, i) => artist(100 + i));
  await pass2(db, [release({ id: 1, artists: [artist(10), ...crowd] })], {
    channelAMaxPeopleToAdmit: 8,
  });
  assert.deepEqual(ids(db, "SELECT artist_id FROM corpus_artists WHERE is_seed = 1"), [10]);
});
