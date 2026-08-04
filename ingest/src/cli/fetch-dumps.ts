/**
 * Downloads the latest Discogs monthly dumps we need: artists, labels, releases.
 * Files stay gzipped on disk — the releases dump is 100+ GB uncompressed and is
 * only ever read as a stream.
 *
 *   npm run fetch-dumps --workspace ingest
 *   npm run fetch-dumps --workspace ingest -- --only releases
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { paths } from "../config.ts";

const BUCKET = "https://discogs-data-dumps.s3.us-west-2.amazonaws.com";
const WANTED = ["artists", "labels", "releases"] as const;

async function listKeys(year: number): Promise<string[]> {
  const res = await fetch(`${BUCKET}?list-type=2&prefix=data/${year}/`);
  if (!res.ok) throw new Error(`Bucket listing failed: ${res.status} ${res.statusText}`);
  const xml = await res.text();
  return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!);
}

/** Finds the newest dump of each wanted type, walking back a year if needed. */
async function latestDumps(only: string[]): Promise<Map<string, string>> {
  const thisYear = new Date().getFullYear();
  const keys = [...(await listKeys(thisYear)), ...(await listKeys(thisYear - 1))];
  const found = new Map<string, string>();

  for (const type of WANTED) {
    if (only.length > 0 && !only.includes(type)) continue;
    const matches = keys
      .filter((k) => k.endsWith(`_${type}.xml.gz`))
      .sort()
      .reverse();
    if (matches.length === 0) throw new Error(`No ${type} dump found in the bucket.`);
    found.set(type, matches[0]!);
  }
  return found;
}

async function download(key: string, dest: string): Promise<void> {
  if (fs.existsSync(dest)) {
    console.log(`  already have ${path.basename(dest)} — skipping`);
    return;
  }

  const res = await fetch(`${BUCKET}/${key}`);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed for ${key}: ${res.status} ${res.statusText}`);
  }

  const total = Number(res.headers.get("content-length") ?? 0);
  let seen = 0;
  let lastLogged = 0;

  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on("data", (chunk: Buffer) => {
    seen += chunk.length;
    if (seen - lastLogged < 100 << 20) return; // log every 100 MB
    lastLogged = seen;
    const pct = total ? ` (${((seen / total) * 100).toFixed(1)}%)` : "";
    console.log(`  ${(seen / (1 << 30)).toFixed(2)} GB${pct}`);
  });

  // Download to a temp name so an interrupted run can't leave a half file that
  // looks complete on the next go.
  const partial = `${dest}.partial`;
  await pipeline(body, fs.createWriteStream(partial));
  fs.renameSync(partial, dest);
}

const onlyIndex = process.argv.indexOf("--only");
const only = onlyIndex === -1 ? [] : process.argv.slice(onlyIndex + 1);

fs.mkdirSync(paths.dumps, { recursive: true });
const dumps = await latestDumps(only);

for (const [type, key] of dumps) {
  const dest = path.join(paths.dumps, path.basename(key));
  console.log(`${type}: ${key}`);
  await download(key, dest);
}

console.log(`\nDumps in ${paths.dumps}`);
