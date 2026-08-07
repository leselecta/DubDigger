import test from "node:test";
import assert from "node:assert/strict";

import { judgeTotalsCache, type TotalsCacheState } from "../src/lib/totals-cache.ts";

const fresh: TotalsCacheState = {
  cached: 132_571,
  builtFrom: "discogs_20260801_releases.xml.gz",
  dumpOnDisk: "discogs_20260801_releases.xml.gz",
  uncovered: 0,
};

test("a cache built from the dump on disk, covering every seed artist, is reused", () => {
  assert.deepEqual(judgeTotalsCache(fresh), { action: "reuse", warning: null });
});

test("a newer dump invalidates the cache", () => {
  // The failure this exists to stop: pass 1 does not clear the cache, so six
  // months later this would report last dump's figures without a word.
  const verdict = judgeTotalsCache({
    ...fresh,
    dumpOnDisk: "discogs_20270201_releases.xml.gz",
  });
  assert.equal(verdict.action, "rescan");
  assert.match((verdict as { why: string }).why, /20260801.*20270201/);
});

test("a seed artist with no cached total invalidates the cache", () => {
  // Same dump, but pass 1 has run with different dials. Every query inner joins
  // the cache, so uncovered artists would vanish from the analysis rather than
  // show up as missing.
  const verdict = judgeTotalsCache({ ...fresh, uncovered: 4_012 });
  assert.equal(verdict.action, "rescan");
  assert.match((verdict as { why: string }).why, /4,012 seed artists/);
});

test("a cache that does not say where it came from is not trusted", () => {
  assert.equal(judgeTotalsCache({ ...fresh, builtFrom: null }).action, "rescan");
});

test("an empty cache is scanned", () => {
  assert.equal(judgeTotalsCache({ ...fresh, cached: 0 }).action, "rescan");
});

test("--rescan wins over a cache that looks fine", () => {
  assert.equal(judgeTotalsCache(fresh, true).action, "rescan");
});

test("with the dump deleted the cache is reused, but says what it rests on", () => {
  // The releases dump is deliberately deleted once the corpus settles. Refusing
  // here would leave no way to read a cache that is probably still current.
  const verdict = judgeTotalsCache({ ...fresh, dumpOnDisk: null, uncovered: 99 });
  assert.equal(verdict.action, "reuse");
  assert.match((verdict as { warning: string }).warning, /discogs_20260801_releases/);
});
