/**
 * Discogs role strings, said the way a person would say them.
 *
 * Ingest stores the role exactly as the dump wrote it, and logs every distinct
 * one, because that raw string is the record. This is the other end: the same
 * credit read out loud. "Produced By", "Producer" and "Producer [Produced By]"
 * are one fact about a person, and a row that lists all three is listing the
 * data entry rather than the work.
 *
 * Two things happen here, and they are separate:
 *
 * 1. **A name.** The bracketed qualifier goes ("Engineer [At Basing Street
 *    Studios]" is still engineering), the variants collapse, and the result is
 *    a noun: Production, Arrangement, Mastering.
 * 2. **One mention each.** Rhett Davies engineered for Eno sixteen ways across
 *    335 records. The row says Engineering, once.
 *
 * Nothing is thrown away that the vocabulary does not recognise: an unknown
 * role keeps its raw wording and sorts to the end, so a rare credit stays
 * visible and the gap in this table stays visible with it.
 */

/**
 * The vocabulary, in the order a row reads it.
 *
 * Order is the priority: what someone made comes before how it was cut, which
 * comes before what they played, which comes before the sleeve and the office.
 * When a row is capped, the tail is what falls off, so this order decides what
 * a digger sees first.
 *
 * Each entry is a canonical name and the raw forms that mean it, matched on a
 * loosened key (lowercase, hyphens read as spaces), so "Written-By", "Written
 * By" and "written-by" all land on the same line without being listed thrice.
 */
const VOCABULARY: [canonical: string, forms: string[]][] = [
  // Authorship: whose record this is.
  ["Production", ["producer", "produced by", "co producer", "coproducer", "reissue producer", "compilation producer", "additional producer", "producer additional"]],
  ["Executive Production", ["executive producer", "executive production", "exec producer"]],
  ["Writing", ["written by", "songwriter", "writer", "co writer"]],
  ["Composition", ["composed by", "composer"]],
  ["Music", ["music by"]],
  ["Lyrics", ["lyrics by", "words by", "text by", "lyricist", "lyrics"]],
  ["Arrangement", ["arranged by", "arranger", "arrangement"]],
  ["Orchestration", ["orchestrated by", "orchestration"]],
  ["Adaptation", ["adapted by"]],

  // The studio and the cut: how the record was made and made physical.
  ["Engineering", ["engineer", "engineering", "engineered by", "assistant engineer", "sound engineer"]],
  ["Recording", ["recorded by", "recording", "recording by", "field recording"]],
  ["Mixing", ["mixed by", "mixing", "mix"]],
  ["Mastering", ["mastered by", "mastering"]],
  ["Remastering", ["remastered by", "remastering"]],
  ["Lacquer Cut", ["lacquer cut by", "lacquer cut", "cut by", "plated by"]],
  ["Programming", ["programmed by", "programming", "drum programming", "beats"]],
  ["Sequencing", ["sequenced by", "sequencer"]],
  ["Editing", ["edited by", "editor", "post production"]],
  ["Sound Design", ["sound designer", "sound design"]],
  ["Transfer", ["transferred by", "tape op", "technician"]],

  // Selection: the work of choosing rather than making.
  ["DJ Mix", ["dj mix"]],
  ["Remix", ["remix", "remixed by", "additional remix"]],
  ["Compilation", ["compiled by", "compilation"]],
  ["Curation", ["curated by"]],

  // Playing.
  ["Performance", ["performer", "musician", "instruments", "soloist", "played by"]],
  ["Band", ["band", "backing band", "ensemble", "orchestra", "group"]],
  ["Featuring", ["featuring", "guest", "guest artist"]],
  ["Direction", ["directed by", "conductor", "conducted by", "leader", "music director", "musical director"]],
  ["Vocals", ["vocals", "voice", "vocal", "singer", "harmony vocals", "soprano vocals", "alto vocals", "tenor vocals", "bass vocals", "baritone vocals"]],
  ["Lead Vocals", ["lead vocals", "lead vocal", "solo vocals"]],
  ["Backing Vocals", ["backing vocals", "background vocals", "chorus", "choir"]],
  ["Rap", ["rap", "rapper", "mc"]],
  ["Guitar", ["guitar", "electric guitar", "acoustic guitar", "lead guitar", "rhythm guitar", "slide guitar", "pedal steel guitar", "twelve string guitar"]],
  ["Bass", ["bass", "bass guitar", "electric bass", "acoustic bass", "double bass", "contrabass", "upright bass"]],
  ["Drums", ["drums", "drum", "drum kit", "electronic drums", "cymbal", "drum machine"]],
  ["Percussion", ["percussion", "congas", "bongos", "tambourine", "handclaps", "tabla", "bells", "marimba", "glockenspiel", "vibraphone", "xylophone", "gong", "shaker"]],
  ["Keyboards", ["keyboards", "keyboard", "clavinet", "harmonium", "mellotron"]],
  ["Piano", ["piano", "electric piano", "acoustic piano"]],
  ["Organ", ["organ", "electric organ", "hammond organ"]],
  ["Synthesizer", ["synthesizer", "synth", "moog", "synthesiser"]],
  ["Electronics", ["electronics", "effects", "sampler", "computer", "loops", "sounds", "noises", "scratches", "turntables", "tape", "vocoder", "theremin", "samples"]],
  ["Strings", ["strings", "violin", "viola", "cello", "harp", "fiddle", "string quartet", "mandolin", "banjo", "sitar", "bouzouki", "ukulele", "zither"]],
  ["Brass", ["brass", "horns", "horn", "trumpet", "trombone", "tuba", "flugelhorn", "french horn"]],
  ["Woodwind", ["woodwind", "saxophone", "tenor saxophone", "alto saxophone", "soprano saxophone", "baritone saxophone", "clarinet", "bass clarinet", "flute", "oboe", "bassoon", "recorder", "whistle"]],
  ["Harmonica", ["harmonica", "melodica"]],
  ["Accordion", ["accordion"]],

  // The sleeve.
  ["Artwork", ["artwork", "artwork by", "cover", "sleeve", "illustration", "painting", "graphics"]],
  ["Design", ["design", "graphic design", "layout", "design concept", "typography", "concept by"]],
  ["Art Direction", ["art direction", "creative director", "art director"]],
  ["Photography", ["photography", "photography by", "photographer"]],
  ["Film", ["film director", "film producer", "camera operator", "cameraman", "video editor", "film editor", "video director", "lighting", "animation"]],
  ["Styling", ["make up", "hair", "stylist", "wardrobe", "model"]],

  // Words on the sleeve, and words about it.
  ["Liner Notes", ["liner notes", "sleeve notes", "notes"]],
  ["Translation", ["translated by", "translation"]],
  ["Narration", ["narrator", "read by", "voice actor", "presenter", "interviewee", "interviewer"]],

  // The office. Real credits, and the last thing a digger is looking for.
  ["Management", ["management", "manager", "product manager", "project manager", "production manager", "booking"]],
  ["A&R", ["a&r", "a&r coordinator"]],
  ["Promotion", ["promotion", "public relations", "marketing"]],
  ["Coordination", ["coordinator", "supervised by", "contractor", "crew"]],
  ["Legal", ["legal"]],
  ["Other", ["other"]],
];

/** Loosened form → canonical name, and canonical name → its place in the order. */
const NAMES = new Map<string, string>();
const RANK = new Map<string, number>();
VOCABULARY.forEach(([canonical, forms], rank) => {
  RANK.set(canonical, rank);
  NAMES.set(key(canonical), canonical);
  for (const form of forms) NAMES.set(key(form), canonical);
});

/** Anything the vocabulary has no name for sorts after everything it does. */
const UNKNOWN_RANK = VOCABULARY.length;

/** The match key: case, hyphens and doubled spaces are not distinctions. */
function key(role: string): string {
  return role.toLowerCase().replace(/[-_/]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * One stored credit into its parts.
 *
 * A credit arrives either as one role or as several joined by commas, and the
 * bracketed qualifier can hold commas of its own: "Engineer [Sigma Sound, New
 * York]" is one role, not two. So the split only cuts at depth zero.
 *
 * The qualifier usually follows the role, which is why the trailing one is cut
 * by truncating from the first bracket. Sometimes it leads instead, and then
 * truncating from the first bracket starts at character zero and throws the
 * role away with it: "[Type &] Layout" is a sleeve credit, and it was the one
 * string in 281,018 that came out of here as nothing at all. So a leading
 * qualifier is removed before the trailing one is cut. 47 stored strings have
 * one, 59 occurrences, and every one of them was losing a real role.
 *
 * A part that is ONLY a qualifier still yields nothing, and should: "[mix]" in
 * "Engineer, [mix]" is a comma split from the role it belonged to, so there is
 * no work left in it to name.
 */
function parts(credit: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of credit) {
    if (char === "[" || char === "(") depth++;
    else if (char === "]" || char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      out.push(current);
      current = "";
    } else current += char;
  }
  out.push(current);
  return out
    .map((part) =>
      part
        .replace(/^\s*[[(][^\])]*[\])]/, "")
        .replace(/\s*[[(].*$/s, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);
}

/**
 * Stored credit strings → the roles a row states, once each and in order.
 *
 * Nothing is held back. The collapsing is what shortens the row: David Byrne's
 * hundred-and-one credits with Eno are twenty-two distinct roles, and a digger
 * reading a row wants all twenty-two, in an order that puts the record before
 * the sleeve.
 */
export function summariseRoles(credits: string[]): string[] {
  const seen = new Map<string, number>();
  for (const credit of credits) {
    for (const part of parts(credit)) {
      const name = NAMES.get(key(part)) ?? part;
      if (!seen.has(name)) seen.set(name, RANK.get(name) ?? UNKNOWN_RANK);
    }
  }

  return [...seen.keys()].sort((a, b) => seen.get(a)! - seen.get(b)!);
}

/** The same, as the line a row prints. */
export function creditLine(credits: string[]): string {
  return summariseRoles(credits).join(" · ");
}

/**
 * The order a release lists its credits in: how much of the record each person
 * touched, most first.
 *
 * There is no authorial order to preserve here. The dump hands credits back
 * sorted by role string, so 800% Ndagga opens on two bass players and reaches
 * Mark Ernestus, who produced, engineered and mixed it, at six of twenty-one.
 * Ranking by weight is what the rest of the site does, and the row carries the
 * reason with it, since the roles it sorts on are the roles it prints.
 *
 * It counts named roles rather than stored strings, for the same reason: a row
 * showing two roles must not sit under a row showing one, and the collapsing
 * means those two figures are not the same number.
 *
 * Ties keep the order they came in, by index rather than by trusting the sort
 * to be stable, so the dump's own order is what breaks them.
 */
export function rankCredits<T extends { roles: string[] }>(rows: readonly T[]): T[] {
  return rows
    .map((row, i) => ({ row, i, held: summariseRoles(row.roles).length }))
    .sort((a, b) => b.held - a.held || a.i - b.i)
    .map((entry) => entry.row);
}

/**
 * Who made the sleeve rather than the record.
 *
 * The corpus is a music corpus and reads as one, except for the designers and
 * photographers who hold Discogs artist ids like everybody else. A page that
 * calls Timothy Saccenti an artist beside Pole is not wrong about either and is
 * unhelpful about both, so the eyebrow says which.
 *
 * The markers are the seed rule's own `packagingRoles` in `ingest/src/config.ts`,
 * spelled again here rather than imported, for the reason the rest of this file
 * is not imported by ingest: the two workspaces do not share types, ingest
 * writes the database and the app only reads it. Keep the two lists in step.
 * They exist because of the sentence that rule already makes — a photographer is
 * not a musician — and this is that sentence said on the page instead of at the
 * corpus boundary.
 *
 * Two gates, both measured on 2026-09-11 against the published file:
 *
 * - **80% of their credits**, because almost everyone has cut a sleeve once.
 *   Will Bankhead is 373 visual of 383 and Ben Drury 237 of 242, so a strict
 *   "all of them" would miss the two clearest designers in the corpus.
 * - **Never on an artist line**, which is what keeps Wolfgang Voigt out. He has
 *   47 visual credits and would trip any share test, and he also released 124
 *   records of his own: a musician who also draws, not a designer.
 *
 * Between them: 13,269 designers and 5,464 photographers, 4.2% of the corpus.
 * Pole reads plain, on one visual credit in 1,047, and so does von Oswald on
 * none in 556.
 *
 * Liner notes count as the designer's rather than a writer's. Simone's call on
 * 2026-09-11, and it follows the packaging list, which has always held them
 * alongside the sleeve they are printed on.
 */
const VISUAL_MARKERS = [
  "photograph",
  "artwork",
  "design",
  "illustration",
  "layout",
  "sleeve",
  "liner notes",
];

/** Below this there is nothing to be a majority of. */
const MIN_VISUAL_CREDITS = 3;
const MIN_VISUAL_SHARE = 0.8;

export function visualCraft(
  credits: readonly string[],
  releasesOnArtistLine: number,
): "designer" | "photographer" | null {
  if (releasesOnArtistLine > 0 || credits.length < MIN_VISUAL_CREDITS) return null;

  let visual = 0;
  let photography = 0;
  for (const credit of credits) {
    const lower = credit.toLowerCase();
    if (!VISUAL_MARKERS.some((marker) => lower.includes(marker))) continue;
    visual++;
    if (lower.includes("photograph")) photography++;
  }

  if (visual / credits.length < MIN_VISUAL_SHARE) return null;
  return photography * 2 > visual ? "photographer" : "designer";
}
