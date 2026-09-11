import test from "node:test";
import assert from "node:assert/strict";
import type Database from "better-sqlite3";

import { openDb } from "../src/db/open.ts";
import { enrichReleases } from "../src/steps/enrich-releases.ts";
import type { ParsedRelease } from "../src/lib/release-stream.ts";

function release(partial: Partial<ParsedRelease> & { id: number }): ParsedRelease {
  return {
    title: `Release ${partial.id}`,
    year: null,
    released: null,
    country: null,
    artists: [],
    credits: [],
    labels: [],
    formats: [],
    tracks: [],
    styles: [],
    genres: [],
    ...partial,
  };
}

/** A database holding a corpus of the given release ids and nothing else. */
function corpus(ids: number[]): Database.Database {
  const db = openDb(":memory:");
  const insert = db.prepare("INSERT INTO releases (id, title) VALUES (?, ?)");
  for (const id of ids) insert.run(id, `Release ${id}`);
  return db;
}

const rows = (db: Database.Database, sql: string) => db.prepare(sql).all() as Record<string, unknown>[];

test("writes the date and country onto a release already in the corpus", async () => {
  const db = corpus([1]);
  await enrichReleases(db, () => [
    release({ id: 1, released: "2019-01-25", country: "Germany" }),
  ]);

  assert.deepEqual(rows(db, "SELECT released, country FROM releases WHERE id = 1"), [
    { released: "2019-01-25", country: "Germany" },
  ]);
});

test("leaves the year alone, because the corpus is already graded on it", async () => {
  // year is written by pass 2 and read by every derived table. A backfill that
  // recomputed it would be re-deriving the corpus under a cosmetic change.
  const db = corpus([1]);
  db.prepare("UPDATE releases SET year = 1994 WHERE id = 1").run();
  await enrichReleases(db, () => [release({ id: 1, released: "2019-01-25", year: 2019 })]);

  assert.equal(db.prepare("SELECT year FROM releases WHERE id = 1").pluck().get(), 1994);
});

test("ignores a release the corpus does not hold", async () => {
  // The dump is 19.3M records and the corpus is 1.1M of them. Anything else
  // going past must leave nothing behind, tracks and formats included.
  const db = corpus([1]);
  const stats = await enrichReleases(db, () => [
    release({ id: 2, country: "France", tracks: [{ position: "A", title: "Nope", duration: null }] }),
  ]);

  assert.equal(stats.matched, 0);
  assert.equal(stats.scanned, 1);
  assert.deepEqual(rows(db, "SELECT * FROM release_tracks"), []);
  assert.deepEqual(rows(db, "SELECT count(*) AS n FROM releases WHERE country IS NOT NULL"), [
    { n: 0 },
  ]);
});

test("writes the tracklist in the order the record prints it", async () => {
  const db = corpus([1]);
  await enrichReleases(db, () => [
    release({
      id: 1,
      tracks: [
        { position: "A1", title: "Rise And Shine", duration: "6:12" },
        { position: null, title: "Side B", duration: null },
        { position: "B1", title: "Cruising", duration: null },
      ],
    }),
  ]);

  assert.deepEqual(rows(db, "SELECT seq, position, title, duration FROM release_tracks ORDER BY seq"), [
    { seq: 0, position: "A1", title: "Rise And Shine", duration: "6:12" },
    { seq: 1, position: null, title: "Side B", duration: null },
    { seq: 2, position: "B1", title: "Cruising", duration: null },
  ]);
});

test("keeps each format's parts, descriptions joined the way urls are", async () => {
  const db = corpus([1]);
  await enrichReleases(db, () => [
    release({
      id: 1,
      formats: [
        { name: "Vinyl", qty: 2, text: "Clear", descriptions: ['12"', "45 RPM"] },
        { name: "CD", qty: 1, text: null, descriptions: [] },
      ],
    }),
  ]);

  assert.deepEqual(
    rows(db, "SELECT position, name, qty, text, descriptions FROM release_formats ORDER BY position"),
    [
      { position: 0, name: "Vinyl", qty: 2, text: "Clear", descriptions: '12"\n45 RPM' },
      { position: 1, name: "CD", qty: 1, text: null, descriptions: "" },
    ],
  );
});

test("running it twice replaces rather than doubles", async () => {
  // It is one pass over a 10.4 GB file. It has to be safe to run again after an
  // interruption without leaving a record with its tracklist listed twice.
  const db = corpus([1]);
  const source = () => [
    release({
      id: 1,
      country: "UK",
      tracks: [{ position: "A", title: "Only", duration: null }],
      formats: [{ name: "Vinyl", qty: 1, text: null, descriptions: ["12\""] }],
    }),
  ];

  await enrichReleases(db, source);
  await enrichReleases(db, source);

  assert.equal(db.prepare("SELECT count(*) FROM release_tracks").pluck().get(), 1);
  assert.equal(db.prepare("SELECT count(*) FROM release_formats").pluck().get(), 1);
});

test("a re-run drops what the dump no longer says", async () => {
  const db = corpus([1]);
  await enrichReleases(db, () => [
    release({ id: 1, tracks: [{ position: "A", title: "Removed later", duration: null }] }),
  ]);
  await enrichReleases(db, () => [release({ id: 1, tracks: [] })]);

  assert.deepEqual(rows(db, "SELECT * FROM release_tracks"), []);
});

test("counts what it scanned and what it touched", async () => {
  const db = corpus([1, 2]);
  const stats = await enrichReleases(db, () => [
    release({ id: 1, tracks: [{ position: "A", title: "One", duration: null }] }),
    release({ id: 2, formats: [{ name: "CD", qty: 1, text: null, descriptions: [] }] }),
    release({ id: 99 }),
  ]);

  assert.deepEqual(stats, { scanned: 3, matched: 2, tracks: 1, formats: 1 });
});
