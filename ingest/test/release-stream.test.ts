import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { streamReleases, type ParsedRelease } from "../src/lib/release-stream.ts";

const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/releases.xml",
);

async function parseFixture(): Promise<ParsedRelease[]> {
  const out: ParsedRelease[] = [];
  for await (const release of streamReleases(fs.createReadStream(fixture))) {
    out.push(release);
  }
  return out;
}

test("yields every release in the file", async () => {
  const releases = await parseFixture();
  assert.deepEqual(
    releases.map((r) => r.id),
    [1, 2, 3, 4],
  );
});

test("captures main artists with join phrases in order", async () => {
  const [first] = await parseFixture();
  assert.deepEqual(first!.artists, [
    { id: 10, name: "Basic Channel", joinPhrase: "&" },
    { id: 11, name: "Maurizio", joinPhrase: null },
  ]);
});

test("captures extraartist credits with raw, unnormalised role strings", async () => {
  const [first] = await parseFixture();
  assert.deepEqual(first!.credits, [
    { id: 20, name: "Moritz Von Oswald", role: "Producer" },
    { id: 21, name: "Mark Ernestus", role: "Engineer [Recording]" },
  ]);
});

test("ignores artists and credits nested inside the tracklist", async () => {
  const [first] = await parseFixture();
  const ids = [...first!.artists, ...first!.credits].map((a) => a.id);
  assert.ok(!ids.includes(999), "track-level artist leaked into release artists");
  assert.ok(!ids.includes(998), "track-level credit leaked into release credits");
});

test("takes the release title, not the first track title", async () => {
  const [first] = await parseFixture();
  assert.equal(first!.title, "Quadrant Dub");
});

test("reads labels from attributes, keeping every label on the release", async () => {
  const releases = await parseFixture();
  assert.deepEqual(releases[1]!.labels, [
    { id: 501, name: "Chain Reaction", catno: "CR-01" },
    { id: 502, name: "Reissue Label", catno: "CR-01-B" },
  ]);
});

test("collects all styles, since a release carries several at once", async () => {
  const releases = await parseFixture();
  assert.deepEqual(releases[0]!.styles, ["Dub Techno", "Techno"]);
  assert.deepEqual(releases[1]!.styles, ["Dub Techno", "Minimal"]);
});

test("derives the year from a partial or full release date", async () => {
  const releases = await parseFixture();
  assert.equal(releases[0]!.year, 1994); // "1994-03-00"
  assert.equal(releases[1]!.year, 1996); // "1996"
  assert.equal(releases[3]!.year, 1997); // "1997-09-22"
});

test("survives a release with no styles, labels or release date", async () => {
  const releases = await parseFixture();
  const bare = releases[2]!;
  assert.equal(bare.title, "Elevations");
  assert.deepEqual(bare.styles, []);
  assert.deepEqual(bare.labels, []);
  assert.deepEqual(bare.credits, []);
  assert.equal(bare.year, null);
});

test("keeps the Various placeholder artist rather than crashing on it", async () => {
  const releases = await parseFixture();
  // Filtering placeholders is the caller's job (see config.isPlaceholderArtist);
  // the parser must report faithfully what the dump says.
  assert.deepEqual(releases[1]!.artists, [
    { id: 194, name: "Various", joinPhrase: null },
  ]);
});

test("decodes entities and multi-byte characters split across chunks", async () => {
  const xml = fs.readFileSync(fixture);
  // One byte at a time is the worst case for UTF-8 boundary handling.
  const byteStream = Readable.from(
    (function* () {
      for (const byte of xml) yield Buffer.from([byte]);
    })(),
  );

  const out: ParsedRelease[] = [];
  for await (const release of streamReleases(byteStream)) out.push(release);

  assert.equal(out[3]!.title, "Homogénic");
  assert.equal(out[3]!.artists[0]!.name, "Björk");
  assert.equal(out[0]!.artists[0]!.joinPhrase, "&");
});
