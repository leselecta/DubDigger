import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { streamEntities, type ParsedEntity } from "../src/lib/entity-stream.ts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function parse(kind: "artist" | "label"): Promise<ParsedEntity[]> {
  const file = path.join(fixtures, kind === "artist" ? "artists.xml" : "labels.xml");
  const out: ParsedEntity[] = [];
  for await (const e of streamEntities(fs.createReadStream(file), kind)) out.push(e);
  return out;
}

test("reads every artist in the dump", async () => {
  const artists = await parse("artist");
  assert.deepEqual(
    artists.map((a) => a.id),
    [10, 20, 30],
  );
});

test("takes the artist's own name, not an alias or a group name", async () => {
  // <name> appears again inside namevariations, aliases, members and groups.
  // The same nesting trap as the release tracklist.
  const [basicChannel] = await parse("artist");
  assert.equal(basicChannel!.name, "Basic Channel");
  assert.equal(basicChannel!.realName, "Moritz Von Oswald & Mark Ernestus");
});

test("keeps the profile as raw Discogs markup, to be rendered later", async () => {
  // [a=] and [l=] are typed references, so a bio can become links into this
  // tool's own pages. Parsing them here would throw that away.
  const [basicChannel] = await parse("artist");
  assert.equal(basicChannel!.profile, "Berlin duo.");
});

test("collects the entity's own urls without descending into aliases", async () => {
  const [basicChannel] = await parse("artist");
  assert.deepEqual(basicChannel!.urls, [
    "https://basicchannel.com",
    "https://en.wikipedia.org/wiki/Basic_Channel",
  ]);
});

test("does not mistake a group name for the artist's own", async () => {
  const artists = await parse("artist");
  assert.equal(artists[1]!.name, "Moritz Von Oswald");
});

test("survives an artist with no realname", async () => {
  const artists = await parse("artist");
  assert.equal(artists[2]!.name, "Vainqueur");
  assert.equal(artists[2]!.realName, null);
});

test("reads every label in the dump", async () => {
  const labels = await parse("label");
  assert.deepEqual(
    labels.map((l) => l.id),
    [500, 501, 504],
  );
});

test("takes the label's own name, not a sublabel or parent name", async () => {
  // <label> nests inside <sublabels>, so a naive parser reads three labels
  // where there is one, and picks up "Burial Mix" as the name.
  const [chainReaction] = await parse("label");
  assert.equal(chainReaction!.id, 500);
  assert.equal(chainReaction!.name, "Chain Reaction");
});

test("labels have no realname field", async () => {
  const [chainReaction] = await parse("label");
  assert.equal(chainReaction!.realName, null);
});
