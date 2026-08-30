import test from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";

import { openDb } from "../src/db/open.ts";
import { runPass1, type Pass1Options } from "../src/steps/pass1-seed.ts";
import { seedLabel } from "../src/config.ts";
import type { ParsedRelease } from "../src/lib/release-stream.ts";

/** A release with only the fields a test cares about. */
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

async function pass1(releases: ParsedRelease[], options: Pass1Options = {}) {
  options = { minSeedRatio: null, ...options };
  const db = openDb(":memory:");
  const stats = await runPass1(db, () => releases, options);
  return { db, stats };
}

const ids = (db: Database.Database, sql: string): number[] =>
  db.prepare(sql).all().map((r) => Object.values(r as object)[0] as number);

test("keeps releases whose styles intersect the seed set", async () => {
  const { db, stats } = await pass1(
    [
      release({ id: 1, styles: ["Dub Techno", "Techno"] }),
      release({ id: 2, styles: ["House", "Disco"] }),
      release({ id: 3, styles: ["Ambient"] }),
    ],
    { isSeed: (s: string[]) => ["Dub Techno", "Ambient"].some((x) => s.includes(x)) },
  );

  assert.equal(stats.releasesScanned, 3);
  assert.equal(stats.seedReleases, 2);
  assert.deepEqual(ids(db, "SELECT id FROM releases ORDER BY id"), [1, 3]);
});

test("marks kept releases as seed", async () => {
  const { db } = await pass1([release({ id: 1, styles: ["Dub"] })], {
    isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)),
  });
  assert.equal(db.prepare("SELECT is_seed FROM releases WHERE id = 1").pluck().get(), 1);
});

test("collects seed artists from both the artist line and the credits", async () => {
  const { db, stats } = await pass1(
    [
      release({
        id: 1,
        styles: ["Dub"],
        artists: [artist(10)],
        credits: [credit(20), credit(21, "Engineer")],
      }),
    ],
    { isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)) },
  );

  assert.equal(stats.seedArtists, 3);
  assert.deepEqual(ids(db, "SELECT artist_id FROM seed_artists ORDER BY artist_id"), [10, 20, 21]);
});

test("does not take seed artists from releases outside the seed styles", async () => {
  const { db } = await pass1(
    [
      release({ id: 1, styles: ["Dub"], artists: [artist(10)] }),
      release({ id: 2, styles: ["House"], artists: [artist(99)] }),
    ],
    { isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)) },
  );
  assert.deepEqual(ids(db, "SELECT artist_id FROM seed_artists"), [10]);
});

test("keeps placeholder artists out of the seed set", async () => {
  // 194 is Various. Left in, it becomes the most collaborative artist alive.
  const { db } = await pass1(
    [
      release({
        id: 1,
        styles: ["Dub"],
        artists: [{ id: 194, name: "Various", joinPhrase: null }, artist(10)],
      }),
    ],
    { isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)) },
  );
  assert.deepEqual(ids(db, "SELECT artist_id FROM seed_artists"), [10]);
});

test("counts a seed artist's releases", async () => {
  const { db } = await pass1(
    [
      release({ id: 1, styles: ["Dub"], artists: [artist(10)] }),
      release({ id: 2, styles: ["Dub"], artists: [artist(10)] }),
      release({ id: 3, styles: ["Dub"], artists: [artist(11)] }),
    ],
    { isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)) },
  );
  assert.equal(
    db.prepare("SELECT seed_releases FROM seed_artists WHERE artist_id = 10").pluck().get(),
    2,
  );
});

test("logs every distinct role string, with occurrence counts", async () => {
  const { db, stats } = await pass1(
    [
      release({ id: 1, styles: ["Dub"], credits: [credit(20, "Engineer"), credit(21, "Producer")] }),
      release({ id: 2, styles: ["Dub"], credits: [credit(22, "Engineer")] }),
    ],
    { isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)) },
  );

  assert.equal(stats.distinctRoles, 2);
  assert.equal(
    db.prepare("SELECT occurrences FROM roles_seen WHERE role = 'Engineer'").pluck().get(),
    2,
  );
});

test("records the run so the database can explain itself", async () => {
  const { db } = await pass1([release({ id: 1, styles: ["Dub"] })], {
    isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)),
    sourceFile: "sample.xml",
  });
  const run = db.prepare("SELECT step, source_file, finished_at FROM ingest_runs").get() as
    | { step: string; source_file: string; finished_at: string }
    | undefined;

  assert.equal(run?.step, "pass1");
  assert.equal(run?.source_file, "sample.xml");
  assert.ok(run?.finished_at, "run was never closed out");
});

/*
 * Seed labels. Both a floor and a ratio have to hold. Flat counts alone don't
 * work: a 500-artist label clearing "2 or more seed artists" is noise, not a
 * signal that the label belongs to the scene.
 */

/** Builds one seed release plus enough filler to pad a label's roster. */
function labelWith(seedArtists: number[], fillerArtists: number[]): ParsedRelease[] {
  const out: ParsedRelease[] = [];
  let id = 1;
  for (const a of seedArtists) {
    // A seeded release: matches the style, and is on label 500.
    out.push(release({ id: id++, styles: ["Dub"], artists: [artist(a)], labels: [label(500)] }));
  }
  for (const a of fillerArtists) {
    // Same label, but nothing to do with the seed styles.
    out.push(release({ id: id++, styles: ["House"], artists: [artist(a)], labels: [label(500)] }));
  }
  return out;
}

test("a label with enough seed artists, densely enough, becomes a seed label", async () => {
  const { db, stats } = await pass1(labelWith([1, 2], [3]), {
    isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)),
    seedLabel: { minSeedArtists: 2, minSeedArtistRatio: 0.05, broad: seedLabel.broad },
  });

  assert.equal(stats.seedLabels, 1);
  const row = db.prepare("SELECT * FROM seed_labels WHERE label_id = 500").get() as {
    seed_artist_count: number;
    total_artist_count: number;
    seed_ratio: number;
  };
  assert.equal(row.seed_artist_count, 2);
  assert.equal(row.total_artist_count, 3);
  assert.ok(Math.abs(row.seed_ratio - 2 / 3) < 1e-9);
});

test("one seed artist fails the floor, however concentrated", async () => {
  // 1 of 2 is a 50% ratio, which clears the ratio easily. The floor is what
  // stops a tiny label qualifying on a single coincidence.
  const { db, stats } = await pass1(labelWith([1], [2]), {
    isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)),
    seedLabel: { minSeedArtists: 2, minSeedArtistRatio: 0.05, broad: seedLabel.broad },
  });

  assert.equal(stats.seedLabels, 0);
  assert.equal(db.prepare("SELECT count(*) FROM seed_labels").pluck().get(), 0);
});

test("two seed artists on a huge roster fail the ratio", async () => {
  // 2 of 100 is 2%, under the 5% floor. This is the case flat counts get wrong.
  const filler = Array.from({ length: 98 }, (_, i) => 100 + i);
  const { stats } = await pass1(labelWith([1, 2], filler), {
    isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)),
    seedLabel: { minSeedArtists: 2, minSeedArtistRatio: 0.05, broad: seedLabel.broad },
  });

  assert.equal(stats.seedLabels, 0);
});

test("a big roster at a third clears the second gate the first one shuts", async () => {
  // 25 seed artists of 60 is 41.7%: under the 50% the first gate wants, over
  // the 35% the second one accepts once there are 20 names behind it. This is
  // Ghostly at 48.7% and PAN at 41.9%, which is why the gate exists.
  const seeds = Array.from({ length: 25 }, (_, i) => i + 1);
  const filler = Array.from({ length: 35 }, (_, i) => 100 + i);
  const { stats } = await pass1(labelWith(seeds, filler), {
    isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)),
    seedLabel: { minSeedArtists: 2, minSeedArtistRatio: 0.5, broad: seedLabel.broad },
  });

  assert.equal(stats.seedLabels, 1);
});

test("a third of the roster is not enough on its own", async () => {
  // Same 41.7%, on 5 seed artists of 12. The floor of 20 is what makes 35%
  // mean something: without it the second gate would just be a lower ratio.
  const seeds = [1, 2, 3, 4, 5];
  const filler = Array.from({ length: 7 }, (_, i) => 100 + i);
  const { stats } = await pass1(labelWith(seeds, filler), {
    isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)),
    seedLabel: { minSeedArtists: 2, minSeedArtistRatio: 0.5, broad: seedLabel.broad },
  });

  assert.equal(stats.seedLabels, 0);
});

test("counts each artist once per label, however many releases they made", async () => {
  const releases = [
    release({ id: 1, styles: ["Dub"], artists: [artist(1)], labels: [label(500)] }),
    release({ id: 2, styles: ["Dub"], artists: [artist(1)], labels: [label(500)] }),
    release({ id: 3, styles: ["Dub"], artists: [artist(2)], labels: [label(500)] }),
    release({ id: 4, styles: ["House"], artists: [artist(3)], labels: [label(500)] }),
  ];
  const { db } = await pass1(releases, {
    isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)),
    seedLabel: { minSeedArtists: 2, minSeedArtistRatio: 0.05, broad: seedLabel.broad },
  });

  const row = db.prepare("SELECT * FROM seed_labels WHERE label_id = 500").get() as {
    seed_artist_count: number;
    total_artist_count: number;
  };
  assert.equal(row.seed_artist_count, 2, "artist 1 counted twice");
  assert.equal(row.total_artist_count, 3);
});

test("the roster spans the whole dump, not just the seed releases", async () => {
  // Label 500 has 2 seed artists but 20 other acts who never touched the style.
  // Only counting seed releases would show 2 of 2 and wrongly admit the label.
  const filler = Array.from({ length: 20 }, (_, i) => 100 + i);
  const { stats } = await pass1(labelWith([1, 2], filler), {
    isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)),
    seedLabel: { minSeedArtists: 2, minSeedArtistRatio: 0.5, broad: seedLabel.broad },
  });

  assert.equal(stats.seedLabels, 0, "roster was measured over seed releases only");
});

test("placeholder artists do not pad a label roster", async () => {
  const releases = [
    release({ id: 1, styles: ["Dub"], artists: [artist(1)], labels: [label(500)] }),
    release({ id: 2, styles: ["Dub"], artists: [artist(2)], labels: [label(500)] }),
    release({
      id: 3,
      styles: ["House"],
      artists: [{ id: 194, name: "Various", joinPhrase: null }],
      labels: [label(500)],
    }),
  ];
  const { db } = await pass1(releases, {
    isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)),
    seedLabel: { minSeedArtists: 2, minSeedArtistRatio: 0.05, broad: seedLabel.broad },
  });

  assert.equal(
    db.prepare("SELECT total_artist_count FROM seed_labels WHERE label_id = 500").pluck().get(),
    2,
  );
});

test("skips labels the dump gives no id for, and counts them", async () => {
  // "Not On Label" and unlinked labels have no id attribute. They cannot be
  // corpus entities, and bucketing them together would wrongly merge unrelated
  // self-releases into one label.
  const unidentified = { id: null, name: "Not On Label", catno: "NONE-1" };
  const { db, stats } = await pass1(
    [
      release({ id: 1, styles: ["Dub"], artists: [artist(1)], labels: [unidentified, label(500)] }),
      release({ id: 2, styles: ["House"], artists: [artist(2)], labels: [unidentified] }),
    ],
    { isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)) },
  );

  assert.equal(stats.labelsWithoutId, 2);
  assert.deepEqual(ids(db, "SELECT label_id FROM release_labels"), [500]);
  assert.equal(db.prepare("SELECT count(*) FROM seed_labels").pluck().get(), 0);
});

test("keeps the pairs table, so the label dials can be retuned without a rescan", async () => {
  const { db } = await pass1(labelWith([1, 2], [3]), { isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)) });
  // 3 artists on label 500. Re-reading 10.4 GB to change one threshold would be
  // a bad trade for the disk this costs.
  assert.equal(db.prepare("SELECT count(*) FROM label_artist_pairs").pluck().get(), 3);
});

test("a second run replaces the first rather than layering on top of it", async () => {
  // The bug this covers: INSERT OR REPLACE leaves behind every row the new run
  // does not happen to overwrite, so seed_artists becomes the union of both
  // runs and the seed labels are derived from a mixture. The reported counts
  // stay correct throughout, which is what makes it hard to spot.
  const db = openDb(":memory:");

  await runPass1(db, () => [release({ id: 1, styles: ["Ambient"], artists: [artist(10)] })], {
    isSeed: (s: string[]) => s.includes("Ambient"),
  });
  assert.deepEqual(ids(db, "SELECT artist_id FROM seed_artists"), [10]);

  // Now a stricter rule that admits nothing from the first run.
  const stats = await runPass1(
    db,
    () => [release({ id: 2, styles: ["Dub Techno"], artists: [artist(20)] })],
    { isSeed: (s: string[]) => s.includes("Dub Techno") },
  );

  assert.equal(stats.seedArtists, 1);
  assert.deepEqual(ids(db, "SELECT artist_id FROM seed_artists"), [20], "run 1 artists survived");
  assert.deepEqual(ids(db, "SELECT id FROM releases"), [2], "run 1 releases survived");
  assert.equal(db.prepare("SELECT count(*) FROM roles_seen").pluck().get(), 0);
});

test("recognises the Not On Label placeholder whatever its casing", async () => {
  // Label 1818 appears as "Not On Label", "Not On label", "Not on Label" and
  // "not on label" across the dump. A case-sensitive check let it through.
  const { db } = await pass1(
    [
      release({ id: 1, styles: ["Dub"], artists: [artist(1)], labels: [{ id: 1818, name: "Not On label", catno: null }] }),
      release({ id: 2, styles: ["Dub"], artists: [artist(2)], labels: [{ id: 1818, name: "not on label", catno: null }] }),
    ],
    { isSeed: (s: string[]) => ["Dub"].some((x) => s.includes(x)) },
  );

  assert.equal(db.prepare("SELECT count(*) FROM label_artist_pairs").pluck().get(), 0);
  assert.equal(db.prepare("SELECT count(*) FROM release_labels").pluck().get(), 0);
});

test("a credit with no usable id never becomes an artist", async () => {
  // 833,731 credits in the first full corpus parsed to id 0, which would have
  // made "artist 0" the best connected person in the database.
  const { db } = await pass1(
    [
      release({
        id: 1,
        styles: ["Dub"],
        artists: [artist(10)],
        credits: [{ id: 0, name: "Boku & Koibito", role: "Other [Spirits Lifted By]" }],
      }),
    ],
    { isSeed: (s: string[]) => s.includes("Dub") },
  );
  assert.deepEqual(ids(db, "SELECT artist_id FROM seed_artists"), [10]);
});

test("a packaging credit does not make someone part of the scene", async () => {
  // Otto Bettmann of the Bettmann photo archive is credited on 64 releases, 11
  // of them in the seed, so his 17.2% clears the bridge ratio honestly. He then
  // vouched a Frank Sinatra tribute into a dub techno corpus. He is a
  // photographer.
  const { db, stats } = await pass1(
    [
      release({
        id: 1,
        styles: ["Dub"],
        artists: [artist(10)],
        credits: [
          credit(20, "Photography By"),
          credit(21, "Artwork, Design"),
          credit(22, "Engineer"),
        ],
      }),
    ],
    { isSeed: (s: string[]) => s.includes("Dub") },
  );

  assert.equal(stats.packagingCredits, 2);
  assert.deepEqual(
    ids(db, "SELECT artist_id FROM seed_artists ORDER BY artist_id"),
    [10, 22],
    "the engineer belongs, the photographer and the designer do not",
  );
});

test("someone who also did musical work keeps their place", async () => {
  const { db } = await pass1(
    [
      release({ id: 1, styles: ["Dub"], credits: [credit(20, "Photography By")] }),
      release({ id: 2, styles: ["Dub"], credits: [credit(20, "Producer")] }),
    ],
    { isSeed: (s: string[]) => s.includes("Dub") },
  );
  assert.deepEqual(ids(db, "SELECT artist_id FROM seed_artists"), [20]);
});

test("an artist who barely works in the seed does not join it", async () => {
  // Nina Simone has 4 seed releases against a catalogue of 5,087, because
  // Luciano re-edited "Sinnerman". That is not scene membership.
  const releases = [
    release({ id: 1, styles: ["Dub"], artists: [artist(10)] }),
    ...Array.from({ length: 9 }, (_, i) =>
      release({ id: 100 + i, styles: ["Pop"], artists: [artist(10)] }),
    ),
    release({ id: 2, styles: ["Dub"], artists: [artist(11)] }),
  ];

  const { db, stats } = await pass1(releases, {
    isSeed: (s: string[]) => s.includes("Dub"),
    minSeedRatio: 0.2,
  });

  assert.equal(stats.seedCandidates, 2);
  assert.equal(stats.droppedByRatio, 1, "artist 10 does 1 of 10 releases here");
  assert.deepEqual(ids(db, "SELECT artist_id FROM seed_artists"), [11]);
});

test("the seed ratio can be switched off", async () => {
  const { stats } = await pass1(
    [
      release({ id: 1, styles: ["Dub"], artists: [artist(10)] }),
      release({ id: 2, styles: ["Pop"], artists: [artist(10)] }),
    ],
    { isSeed: (s: string[]) => s.includes("Dub"), minSeedRatio: null },
  );
  assert.equal(stats.droppedByRatio, 0);
  assert.equal(stats.seedArtists, 1);
});

test("a disqualifying style overrides a matching one", async () => {
  // "Film Music" is tagged Ambient, Minimal, Modern Classical and Soundtrack on
  // genre Electronic. It passes the Minimal gate, and then its sound engineer
  // becomes a seed artist, bridges, and brings the Amadeus soundtrack and
  // Mozart with him. A record tagged both Dub Techno and Soundtrack is a
  // soundtrack that borrowed the sound.
  const { db, stats } = await pass1([
    release({ id: 1, styles: ["Dub Techno"], genres: ["Electronic"], artists: [artist(10)] }),
    release({
      id: 2,
      styles: ["Ambient", "Minimal", "Modern Classical", "Soundtrack"],
      genres: ["Electronic"],
      artists: [artist(20)],
    }),
    release({ id: 3, styles: ["Dub Techno", "Soundtrack"], genres: ["Electronic"], artists: [artist(21)] }),
  ]);

  assert.equal(stats.seedReleases, 1);
  assert.deepEqual(ids(db, "SELECT id FROM releases"), [1]);
  assert.deepEqual(ids(db, "SELECT artist_id FROM seed_artists"), [10]);
});
