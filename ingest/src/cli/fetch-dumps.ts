/**
 * Downloads the monthly Discogs dumps we need: artists, labels, releases.
 * Files stay gzipped on disk. The releases dump is over 100 GB uncompressed and
 * is only ever read as a stream, never expanded to disk.
 *
 *   npm run fetch-dumps --workspace ingest
 *   npm run fetch-dumps --workspace ingest -- --only labels
 *   npm run fetch-dumps --workspace ingest -- --date 20260801
 *
 * Note: the S3 bucket that used to serve these (discogs-data-dumps.s3...) now
 * refuses anonymous access, including listing. data.discogs.com is the supported
 * route. It does NOT honour Range requests, so an interrupted download restarts
 * from zero rather than resuming.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { paths } from "../config.ts";

const BASE = "https://data.discogs.com";
const WANTED = ["artists", "labels", "releases"] as const;

// data.discogs.com sits behind Cloudflare and rate limits listing requests.
const USER_AGENT = "DubDigger/0.1 (+https://github.com/leselecta/DubDigger)";

/** Longest we will sit and wait on a 429 before handing the decision back. */
const MAX_BACKOFF_SECONDS = 120;

/**
 * Fetches with a descriptive agent, backing off politely on 429 and 5xx.
 *
 * Cloudflare answers a tripped rate limit with a Retry-After measured in tens of
 * minutes. Sleeping for that long looks identical to a hang, so anything beyond
 * MAX_BACKOFF_SECONDS is reported instead of waited out.
 */
async function get(url: string, attempt = 1): Promise<Response> {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (res.ok) return res;

  const retryable = res.status === 429 || res.status >= 500;
  if (!retryable || attempt >= 4) return res;

  const advised = Number(res.headers.get("retry-after")) || 0;
  if (advised > MAX_BACKOFF_SECONDS) {
    const mins = Math.ceil(advised / 60);
    throw new Error(
      `Rate limited by data.discogs.com. It is asking for ${mins} more minute(s).\n` +
        `Nothing was downloaded. Wait it out and run the same command again.`,
    );
  }

  const wait = advised * 1000 || 2000 * 2 ** (attempt - 1);
  console.log(`    ${res.status}, retrying in ${Math.round(wait / 1000)}s...`);
  await new Promise((r) => setTimeout(r, wait));
  return get(url, attempt + 1);
}

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

/** Lists a year's directory, grouped by dump date. */
async function listYear(year: number): Promise<Map<string, Set<string>>> {
  const res = await get(`${BASE}/?prefix=data/${year}/`);
  if (!res.ok) throw new Error(`Listing ${year} failed: ${res.status} ${res.statusText}`);
  const html = await res.text();

  const byDate = new Map<string, Set<string>>();
  for (const [, date, type] of html.matchAll(/discogs_(\d{8})_([a-z]+)\.xml\.gz/g)) {
    if (!byDate.has(date!)) byDate.set(date!, new Set());
    byDate.get(date!)!.add(type!);
  }
  return byDate;
}

/** Newest dump date that actually has every file we need, walking back a year. */
async function resolveDate(): Promise<{ date: string; year: number }> {
  const pinned = flag("date");
  const thisYear = new Date().getFullYear();

  for (const year of [thisYear, thisYear - 1]) {
    const byDate = await listYear(year);
    const dates = [...byDate.keys()].sort().reverse();
    for (const date of dates) {
      if (pinned && date !== pinned) continue;
      const have = byDate.get(date)!;
      if (WANTED.every((t) => have.has(t))) return { date, year };
    }
  }
  throw new Error(pinned ? `No complete dump dated ${pinned}.` : "No complete dump found.");
}

function downloadUrl(year: number, file: string): string {
  return `${BASE}/?download=${encodeURIComponent(`data/${year}/${file}`)}`;
}

async function fetchChecksums(year: number, date: string): Promise<Map<string, string>> {
  const res = await get(downloadUrl(year, `discogs_${date}_CHECKSUM.txt`));
  if (!res.ok) throw new Error(`Checksums unavailable: ${res.status}`);

  const map = new Map<string, string>();
  for (const line of (await res.text()).trim().split("\n")) {
    const [hash, file] = line.trim().split(/\s+/);
    if (hash && file) map.set(file, hash);
  }
  return map;
}

async function download(url: string, dest: string, expected: string | undefined) {
  const res = await get(url);
  if (!res.ok || !res.body) {
    throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  }

  const total = Number(res.headers.get("content-length") ?? 0);
  const hash = crypto.createHash("sha256");
  let seen = 0;
  let lastLogged = 0;

  const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
  body.on("data", (chunk: Buffer) => {
    hash.update(chunk);
    seen += chunk.length;
    if (seen - lastLogged < 250 << 20) return; // log every 250 MB
    lastLogged = seen;
    const pct = total ? ` (${((seen / total) * 100).toFixed(1)}%)` : "";
    process.stdout.write(`    ${(seen / (1 << 30)).toFixed(2)} GB${pct}\n`);
  });

  // Write to a .partial name so an interrupted run cannot leave behind a
  // truncated file that looks complete next time.
  const partial = `${dest}.partial`;
  try {
    await pipeline(body, fs.createWriteStream(partial));
  } catch (err) {
    fs.rmSync(partial, { force: true });
    throw err;
  }

  const actual = hash.digest("hex");
  if (expected && actual !== expected) {
    fs.rmSync(partial, { force: true });
    throw new Error(`Checksum mismatch.\n  expected ${expected}\n  actual   ${actual}`);
  }

  fs.renameSync(partial, dest);
  console.log(`    ok, sha256 ${expected ? "verified" : actual}`);
}

const only = flag("only");
const types = only ? WANTED.filter((t) => t === only) : [...WANTED];
if (types.length === 0) throw new Error(`--only must be one of: ${WANTED.join(", ")}`);

const { date, year } = await resolveDate();
console.log(`Discogs dump ${date}\n`);

fs.mkdirSync(paths.dumps, { recursive: true });
const checksums = await fetchChecksums(year, date);

for (const type of types) {
  const file = `discogs_${date}_${type}.xml.gz`;
  const dest = path.join(paths.dumps, file);

  if (fs.existsSync(dest)) {
    console.log(`  ${file}\n    already downloaded, skipping`);
    continue;
  }

  console.log(`  ${file}`);
  await download(downloadUrl(year, file), dest, checksums.get(file));
}

console.log(`\nDumps in ${paths.dumps}`);
