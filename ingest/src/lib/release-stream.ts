import fs from "node:fs";
import zlib from "node:zlib";
import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";
import { SaxesParser } from "saxes";

export interface ParsedArtistRef {
  id: number;
  name: string;
  /** Free text like "&" or "feat." — preserved, never interpreted. */
  joinPhrase: string | null;
}

export interface ParsedCredit {
  id: number;
  name: string;
  /** Raw Discogs role string. Never normalised in v1. */
  role: string;
}

export interface ParsedLabelRef {
  /**
   * null when the dump gives no usable id, which happens on unlinked labels and
   * on the "Not On Label" placeholder used for self-releases. Such a label has
   * no Discogs page to pivot to, so it cannot be a corpus entity, but the name
   * and catalogue number are still real and are kept.
   */
  id: number | null;
  name: string;
  catno: string | null;
}

export interface ParsedFormat {
  name: string;
  /** How many of this carrier: a double LP is qty 2. Absent reads as 1. */
  qty: number;
  /** Free text on the carrier itself, "Clear Vinyl" and the like. */
  text: string | null;
  /** "12\"", "45 RPM", "Album". Stored unassembled: the sentence is a display decision. */
  descriptions: string[];
}

export interface ParsedTrack {
  /** "A1", or null on a heading row, which the dump writes as a track. */
  position: string | null;
  title: string;
  duration: string | null;
}

export interface ParsedRelease {
  id: number;
  title: string;
  year: number | null;
  /**
   * The date as the dump wrote it: "1994-03-00", "1996", "1997-09-22". Kept
   * whole because `year` throws away most of it, and a sleeve prints a date.
   */
  released: string | null;
  country: string | null;
  artists: ParsedArtistRef[];
  credits: ParsedCredit[];
  labels: ParsedLabelRef[];
  formats: ParsedFormat[];
  /**
   * Read, but never made into entities. Titles and positions only: the track
   * level's own <artists> and <extraartists> stay out, which is the trap the
   * whole-subtree skip used to guard against and which is now guarded by depth.
   */
  tracks: ParsedTrack[];
  styles: string[];
  /**
   * Coarser than styles, and the only thing that separates reggae dub from
   * electronic dub: both carry the style "Dub", but the genre differs.
   */
  genres: string[];
}

/**
 * Streams a Discogs releases dump, yielding one thin release object at a time.
 *
 * The dump is 100+ GB uncompressed, so nothing is ever buffered beyond the
 * release currently being assembled, and everything outside the projected field
 * set is dropped as it goes past.
 *
 * The trap this guards against: <artists> and <extraartists> also appear *inside*
 * <tracklist>, with the same shape. Track-level credits must not be mistaken for
 * release-level ones. The subtree used to be skipped whole for that reason; it
 * is now read for titles and positions, and the guard is depth instead: only
 * <position>, <title> and <duration> sitting directly under a track that sits
 * directly under the tracklist are taken. Everything else in there, the track's
 * own people included, still goes past untouched.
 */
export async function* streamReleases(
  input: Readable | AsyncIterable<Buffer | string>,
): AsyncGenerator<ParsedRelease> {
  const ready: ParsedRelease[] = [];
  const parser = new SaxesParser();

  let release: ParsedRelease | null = null;
  let releasedRaw: string | null = null;
  let pending: { id: number; name: string; join: string | null; role: string } | null =
    null;
  let pendingTrack: ParsedTrack | null = null;
  let stack: string[] = [];
  let text = "";
  let inTracklist = false;

  parser.on("error", (err) => {
    throw err;
  });

  parser.on("opentag", (node) => {
    const name = node.name;

    if (release === null) {
      if (name !== "release") return; // the <releases> root, and anything stray
      const id = Number(node.attributes["id"]);
      release = {
        id,
        title: "",
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
      };
      releasedRaw = null;
      pendingTrack = null;
      inTracklist = false;
      pending = null;
      stack = [name];
      text = "";
      return;
    }

    stack.push(name);
    text = "";

    if (name === "tracklist" && stack.length === 2) inTracklist = true;
    if (inTracklist) {
      // Only the top level of the list. A sub_tracks group opens two deeper,
      // and its entries are parts of the track above rather than tracks.
      if (name === "track" && stack.length === 3) {
        pendingTrack = { position: null, title: "", duration: null };
      }
      return;
    }

    const parent = stack[stack.length - 2];

    if (name === "artist" && stack.length === 3 && (parent === "artists" || parent === "extraartists")) {
      pending = { id: 0, name: "", join: null, role: "" };
      return;
    }

    // Formats carry the carrier in attributes and the rest in child elements.
    if (name === "format" && stack.length === 3 && parent === "formats") {
      const qty = Number(node.attributes["qty"]);
      release.formats.push({
        name: node.attributes["name"] ?? "",
        qty: Number.isInteger(qty) && qty > 0 ? qty : 1,
        text: (node.attributes["text"] ?? "").trim() || null,
        descriptions: [],
      });
    }

    // Labels carry everything in attributes rather than child elements, and the
    // id attribute is not always there.
    if (name === "label" && stack.length === 3 && parent === "labels") {
      const catno = (node.attributes["catno"] ?? "").trim();
      const id = Number(node.attributes["id"]);
      release.labels.push({
        id: Number.isInteger(id) ? id : null,
        name: node.attributes["name"] ?? "",
        catno: catno || null,
      });
    }
  });

  parser.on("text", (chunk) => {
    if (release !== null) text += chunk;
  });

  parser.on("closetag", (node) => {
    if (release === null) return;

    const name = node.name;
    stack.pop();

    if (name === "release" && stack.length === 0) {
      release.released = releasedRaw;
      release.year = parseYear(releasedRaw);
      ready.push(release);
      release = null;
      text = "";
      return;
    }

    if (name === "tracklist" && stack.length === 1) {
      inTracklist = false;
      text = "";
      return;
    }
    if (inTracklist) {
      const value = text.trim();
      text = "";

      if (name === "track" && stack.length === 2) {
        // A track with neither a position nor a title is an empty element the
        // dump leaves behind, not a piece of music.
        if (pendingTrack !== null && (pendingTrack.title !== "" || pendingTrack.position !== null)) {
          release.tracks.push(pendingTrack);
        }
        pendingTrack = null;
      } else if (pendingTrack !== null && stack.length === 3 && stack[2] === "track") {
        if (name === "position") pendingTrack.position = value || null;
        else if (name === "title") pendingTrack.title = value;
        else if (name === "duration") pendingTrack.duration = value || null;
      }
      return;
    }

    const value = text.trim();
    text = "";
    const depth = stack.length; // depth of the element we just closed out of

    if (depth === 1) {
      if (name === "title") release.title = value;
      else if (name === "released") releasedRaw = value;
      else if (name === "country") release.country = value || null;
      return;
    }

    if (depth === 2) {
      if (name === "style" && stack[1] === "styles") {
        release.styles.push(value);
      } else if (name === "genre" && stack[1] === "genres") {
        release.genres.push(value);
      } else if (name === "artist" && pending !== null) {
        if (stack[1] === "artists") {
          release.artists.push({
            id: pending.id,
            name: pending.name,
            joinPhrase: pending.join,
          });
        } else if (stack[1] === "extraartists") {
          release.credits.push({
            id: pending.id,
            name: pending.name,
            role: pending.role,
          });
        }
        pending = null;
      }
      return;
    }

    if (depth === 3 && pending !== null) {
      if (name === "id") pending.id = Number(value);
      else if (name === "name") pending.name = value;
      else if (name === "join") pending.join = value || null;
      else if (name === "role") pending.role = value;
      return;
    }

    if (depth === 4 && name === "description" && stack[1] === "formats") {
      release.formats.at(-1)?.descriptions.push(value);
    }
  });

  // Decode incrementally: a multi-byte character can straddle a chunk boundary,
  // and this dump is full of them.
  const decoder = new StringDecoder("utf8");

  for await (const chunk of input) {
    const str = typeof chunk === "string" ? chunk : decoder.write(chunk);
    if (str) parser.write(str);
    while (ready.length > 0) yield ready.shift()!;
  }

  const tail = decoder.end();
  if (tail) parser.write(tail);
  parser.close();

  while (ready.length > 0) yield ready.shift()!;
}

/** Opens a dump by path, transparently gunzipping .gz files as they stream. */
export function openDump(file: string): Readable {
  const raw = fs.createReadStream(file, { highWaterMark: 1 << 20 });
  return file.endsWith(".gz") ? raw.pipe(zlib.createGunzip()) : raw;
}

/** "1994-03-00", "1996" and "1997-09-22" all yield a usable year; junk yields null. */
function parseYear(raw: string | null): number | null {
  if (!raw) return null;
  const match = /^(\d{4})/.exec(raw.trim());
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1000 ? year : null;
}
