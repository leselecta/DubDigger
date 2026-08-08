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
  return out.map((part) => part.replace(/\s*[[(].*$/s, "").replace(/\s+/g, " ").trim()).filter(Boolean);
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
