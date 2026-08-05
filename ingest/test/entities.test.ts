import test from "node:test";
import assert from "node:assert/strict";

import { openDb } from "../src/db/open.ts";
import { runEntities } from "../src/steps/entities.ts";
import type { ParsedEntity } from "../src/lib/entity-stream.ts";

const entity = (
  id: number,
  name: string,
  realName: string | null = null,
  profile: string | null = null,
): ParsedEntity => ({ id, name, realName, profile, urls: [], relations: [] });

function corpus(artistIds: number[], labelIds: number[]) {
  const db = openDb(":memory:");
  const a = db.prepare("INSERT INTO corpus_artists (artist_id, is_seed) VALUES (?, 1)");
  for (const id of artistIds) a.run(id);
  db.prepare("INSERT INTO releases (id, title, is_seed) VALUES (1, 'R', 1)").run();
  const l = db.prepare(
    "INSERT INTO release_labels (release_id, position, label_id, name) VALUES (1, ?, ?, 'x')",
  );
  labelIds.forEach((id, i) => l.run(i, id));
  return db;
}

test("keeps only the entities the corpus references", async () => {
  // Storing all nine million Discogs artists would bloat the served file for
  // no gain, and keeping it small is the whole architectural point.
  const db = corpus([10], [500]);
  const stats = await runEntities(db, {
    artists: [entity(10, "Basic Channel"), entity(999, "Someone Else")],
    labels: [entity(500, "Chain Reaction"), entity(998, "Other Label")],
  });

  assert.equal(stats.artistsScanned, 2);
  assert.equal(stats.artistsKept, 1);
  assert.equal(stats.labelsKept, 1);
  assert.deepEqual(db.prepare("SELECT id, name FROM artists").all(), [
    { id: 10, name: "Basic Channel" },
  ]);
});

test("reports corpus entities the dump does not contain", async () => {
  const db = corpus([10, 11], [500]);
  const stats = await runEntities(db, { artists: [entity(10, "Basic Channel")], labels: [] });
  assert.equal(stats.artistsMissing, 1);
  assert.equal(stats.labelsMissing, 1);
});

test("builds a search index that finds an artist by name", async () => {
  const db = corpus([10], []);
  await runEntities(db, { artists: [entity(10, "Basic Channel")], labels: [] });

  const hit = db
    .prepare("SELECT rowid FROM artist_search WHERE artist_search MATCH ?")
    .pluck()
    .get("Channel");
  assert.equal(hit, 10, "search should resolve straight to the artist id");
});

test("stores the profile, which is CC0 dump data rather than a live API call", async () => {
  const db = corpus([10], []);
  await runEntities(db, {
    artists: [entity(10, "Basic Channel", null, "Berlin duo. Founded [l=Chain Reaction].")],
    labels: [],
  });
  assert.equal(
    db.prepare("SELECT profile FROM artists WHERE id = 10").pluck().get(),
    "Berlin duo. Founded [l=Chain Reaction].",
  );
});

test("a second run replaces the first rather than layering on top of it", async () => {
  const db = corpus([10], []);
  await runEntities(db, { artists: [entity(10, "Old Name")], labels: [] });
  await runEntities(db, { artists: [entity(10, "New Name")], labels: [] });

  assert.equal(db.prepare("SELECT count(*) FROM artists").pluck().get(), 1);
  assert.equal(db.prepare("SELECT name FROM artists WHERE id = 10").pluck().get(), "New Name");
});
