/**
 * Writes a small, well-formed copy of a dump so passes can be developed and
 * proven correct in seconds rather than hours. Correctness on the sample first,
 * always, before anything touches the full file.
 *
 *   npm run make-sample --workspace ingest -- releases
 *   npm run make-sample --workspace ingest -- releases --size 20000
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createInterface } from "node:readline";
import { paths, SAMPLE_SIZE } from "../config.ts";

const type = process.argv[2];
if (!type || type.startsWith("--")) {
  console.error("Usage: make-sample <artists|labels|releases> [--size N]");
  process.exit(1);
}

const sizeIndex = process.argv.indexOf("--size");
const size = sizeIndex === -1 ? SAMPLE_SIZE : Number(process.argv[sizeIndex + 1]);

const source = fs
  .readdirSync(paths.dumps)
  .filter((f) => f.endsWith(`_${type}.xml.gz`))
  .sort()
  .reverse()[0];

if (!source) {
  console.error(`No ${type} dump in ${paths.dumps}. Run fetch-dumps first.`);
  process.exit(1);
}

fs.mkdirSync(paths.samples, { recursive: true });
const dest = path.join(paths.samples, `${type}-${size}.xml`);

// The dumps put each record's tags on their own lines, so counting closing tags
// line by line is enough to cut cleanly on a record boundary.
const singular = type.slice(0, -1); // releases -> release
const closeTag = `</${singular}>`;
const out = fs.createWriteStream(dest);
out.write(`<?xml version="1.0" encoding="UTF-8"?>\n<${type}>\n`);

const input = fs.createReadStream(path.join(paths.dumps, source)).pipe(zlib.createGunzip());
const lines = createInterface({ input, crlfDelay: Infinity });

let kept = 0;
let started = false;

for await (const line of lines) {
  const trimmed = line.trim();
  if (!started) {
    // Skip the XML declaration and the root open tag.
    if (!trimmed.startsWith(`<${singular} `) && !trimmed.startsWith(`<${singular}>`)) continue;
    started = true;
  }
  out.write(line + "\n");
  if (trimmed.endsWith(closeTag)) {
    kept++;
    if (kept >= size) break;
  }
}

lines.close();
input.destroy();
out.write(`</${type}>\n`);
await new Promise((resolve) => out.end(resolve));

const bytes = fs.statSync(dest).size;
console.log(`Wrote ${kept} ${singular} records to ${dest} (${(bytes / (1 << 20)).toFixed(1)} MB)`);
console.log(`Source: ${source}`);
