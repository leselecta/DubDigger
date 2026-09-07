import test from "node:test";
import assert from "node:assert/strict";
import { formatLine, releasedOn } from "../src/lib/view";

/**
 * The carrier, assembled from the parts the dump stores.
 *
 * Ingest keeps name, qty, descriptions and text separately, so the sentence is
 * written here and can change without a re-ingest. The order is Discogs' own,
 * which is also the order a digger reads: what it is, then how big and how
 * fast, then anything peculiar about the pressing.
 */
test("names the carrier, then its descriptions", () => {
  assert.equal(
    formatLine([{ name: "Vinyl", qty: 1, text: null, descriptions: ['12"', "45 RPM"] }]),
    'Vinyl, 12", 45 RPM',
  );
});

test("says how many when there is more than one", () => {
  assert.equal(
    formatLine([{ name: "Vinyl", qty: 2, text: null, descriptions: ["LP", "Album"] }]),
    "2× Vinyl, LP, Album",
  );
});

test("free text about the pressing comes last", () => {
  assert.equal(
    formatLine([{ name: "Vinyl", qty: 1, text: "Clear", descriptions: ['12"'] }]),
    'Vinyl, 12", Clear',
  );
});

test("a record issued on two carriers says both", () => {
  assert.equal(
    formatLine([
      { name: "Vinyl", qty: 2, text: null, descriptions: ['12"'] },
      { name: "CD", qty: 1, text: null, descriptions: ["Album"] },
    ]),
    '2× Vinyl, 12" + CD, Album',
  );
});

test("nothing recorded reads as nothing, not as an empty sentence", () => {
  assert.equal(formatLine([]), null);
  assert.equal(formatLine([{ name: "", qty: 1, text: null, descriptions: [] }]), null);
});

/**
 * The date, as much of it as the dump has.
 *
 * Measured on the sample: 98.5% of records carry a date and only 31% of those
 * are a full one, so a year on its own is the common case rather than the
 * degraded one. Each shape prints as itself and never pads what it does not
 * know: "1996" must not become "1 Jan 1996".
 */
test("a full date reads the way it is written here", () => {
  assert.equal(releasedOn("2019-01-25"), "25 Jan 2019");
});

test("a month with no day says the month", () => {
  assert.equal(releasedOn("1994-03-00"), "Mar 1994");
  assert.equal(releasedOn("1994-03"), "Mar 1994");
});

test("a year on its own stays a year", () => {
  assert.equal(releasedOn("1996"), "1996");
  assert.equal(releasedOn("1996-00-00"), "1996");
});

test("junk and nothing both read as nothing", () => {
  assert.equal(releasedOn(null), null);
  assert.equal(releasedOn(""), null);
  assert.equal(releasedOn("?"), null);
  assert.equal(releasedOn("19"), null);
});

test("an impossible month is not printed as one", () => {
  // Contributor-entered, so "2019-13-01" exists. Falling back to the year says
  // less and says nothing wrong.
  assert.equal(releasedOn("2019-13-01"), "2019");
  assert.equal(releasedOn("2019-01-45"), "Jan 2019");
});
