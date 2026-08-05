import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const ingestRoot = path.resolve(here, "..");

/**
 * Every tunable dial for corpus selection lives here.
 * Change a number, re-run the affected pass, compare the reported counts.
 */

export const paths = {
  /** Downloaded Discogs dumps, kept gzipped. Never decompressed to disk. */
  dumps: path.join(ingestRoot, "data/dumps"),
  /** Small truncated copies of the dumps, for developing against. */
  samples: path.join(ingestRoot, "data/samples"),
  /** Persisted seed sets and role logs — the definitional core of the corpus. */
  artifacts: path.join(ingestRoot, "data/artifacts"),
  /** Raw + derived tables. This file is the ingest working database. */
  db: path.join(ingestRoot, "data/dubdigger.sqlite"),
};

/**
 * Pass 1 seed rule.
 *
 * A flat style list does not work. Measured on the 20260801 dump, filtering on
 * {Dub Techno, Deep Techno, Dub, Ambient, Minimal} produced 702,038 seed
 * releases and 430,440 seed artists, and the seed label table came out topped by
 * EMI, Columbia, Sony and Virgin. The styles were the problem, not the label
 * dials: the core two accounted for only 6.7% of those releases. "Dub" was
 * pulling in the reggae catalogue, "Minimal" minimalist classical, and "Ambient"
 * new age and soundtrack work.
 *
 * Genre is what separates them. Reggae dub and electronic dub share the style
 * "Dub" but differ by genre, so the broad styles are gated behind one.
 *
 * Techno is deliberately absent from both tiers: too broad, and the one-hop
 * expansion in pass 2 already reaches into it through real connections.
 */
export const seedStyles = {
  /** Unambiguous. Admitted whatever the genre. */
  core: new Set(["Dub Techno", "Deep Techno"]),
  /** Real scene styles that are also used far outside it. Gated by genre. */
  broad: new Set(["Minimal", "Dub"]),
  /** The gate for the broad tier. */
  genres: new Set(["Electronic"]),
  /**
   * Broad styles needing more than a genre gate: admitted only alongside one of
   * these. Ambient is the case that forced this, being enormous even within
   * Electronic.
   */
  needsTechno: new Set(["Ambient"]),
  technoStyles: new Set(["Techno", "Minimal Techno", "Dub Techno", "Deep Techno"]),
};

export function isSeedRelease(styles: string[], genres: string[]): boolean {
  if (styles.some((s) => seedStyles.core.has(s))) return true;
  if (!genres.some((g) => seedStyles.genres.has(g))) return false;
  if (styles.some((s) => seedStyles.broad.has(s))) return true;

  return (
    styles.some((s) => seedStyles.needsTechno.has(s)) &&
    styles.some((s) => seedStyles.technoStyles.has(s))
  );
}

/**
 * A label becomes a seed label only if BOTH hold. Flat counts alone don't work:
 * a 500-artist label clearing "2+ seed artists" is noise, not signal, so the bar
 * has to scale with roster size.
 */
export const seedLabel = {
  /** Floor: guards against a tiny label qualifying on one coincidence. */
  minSeedArtists: 2,
  /**
   * Ratio: guards against a large label qualifying on a single seed artist.
   *
   * Measured against the 20260801 dump there is a clean gap here, so this is
   * not a finger in the air. Majors land at 6-19% (EMI 6%, Sony 8%, Universal
   * 10%, Virgin 19%) while the scene labels land at 67-100%: Chain Reaction,
   * Basic Channel, Burial Mix, Rhythm & Sound, Echocord, Styrax Leaves,
   * Echospace and Main Street all at 100%, then Ostgut Ton 84%, Kompakt 81%,
   * Tresor 69%, Modern Love 67%. 0.50 sits in the empty middle.
   */
  minSeedArtistRatio: 0.5,
};

/**
 * Pass 2 expansion. One hop out, on both channels — never two.
 */
export const expansion = {
  /**
   * Channel A (collaboration) minimum tie strength: admit a non-seed artist only
   * if they appear on at least this many seed-artist releases.
   *
   * Note this governs which ARTISTS join the corpus, not which releases are
   * kept, so it does little to control corpus size on its own.
   */
  channelAMinSharedReleases: 1,

  /**
   * A seed artist only acts as a channel A bridge if at least this share of
   * their work sits inside the seed. null disables the check.
   *
   * This is the dial that controls corpus size. The first full pass 2 run
   * expanded 179,416 seed artists into 6,563,471 releases, a third of Discogs,
   * with 98% arriving through channel A. The cause was degree: the seed set
   * contains everyone credited on a seed release, including mastering
   * engineers who also worked on tens of thousands of unrelated records. Bob
   * Ludwig mastered something adjacent to the scene, and all 60,386 of his
   * releases walked in behind him.
   *
   * A flat cap on credits cannot fix it, because prolific scene producers look
   * the same as service hubs from the outside. Moritz von Oswald has 556
   * credits, so any cap tight enough to stop Bob Ludwig would also stop him.
   *
   * The share of work is what separates them, and it separates them cleanly.
   * Measured on the 20260801 corpus: Moritz von Oswald 42.8%, Mark Ernestus
   * 76.3%, against Bob Ludwig 0.2%, Bernie Grundman 0.3% and Beethoven 0.0%.
   * Nothing sits in between, so 0.10 has room on both sides.
   *
   * Suppressed artists stay in the corpus with their own pages and credits.
   * They simply stop being treated as evidence that two unrelated records
   * belong to the same scene.
   */
  channelAMinSeedRatio: 0.1 as number | null,
};

/**
 * Discogs uses placeholder artist entries that must never be treated as people,
 * or they become the most "collaborative" artist in the database by a mile.
 *
 * Verify these IDs against the artists dump before the first full run — the name
 * check below is the real safety net.
 */
export const PLACEHOLDER_ARTIST_IDS = new Set([194]); // "Various"
export const PLACEHOLDER_ARTIST_NAMES = new Set([
  "Various",
  "Unknown Artist",
  "No Artist",
  // Credited as Written-By on 27,068 releases in the 20260801 corpus. A
  // stand-in for public-domain authorship, not a person.
  "Traditional",
]);

export function isPlaceholderArtist(id: number, name: string): boolean {
  // A credit with no usable <id> parses as 0. There were 833,731 of them in the
  // first full corpus, which would have made "artist 0" the best connected
  // person in the database.
  if (id <= 0) return true;
  return PLACEHOLDER_ARTIST_IDS.has(id) || PLACEHOLDER_ARTIST_NAMES.has(name.trim());
}

/**
 * "Not On Label" is the label equivalent of "Various": a placeholder for
 * self-released records, not an imprint anyone signed to.
 *
 * Discogs mints a separate id per self-releasing artist ("Not On Label (X
 * Self-released)"), so there is no single id to exclude. Measured on the
 * 20260801 dump: 19,947 distinct ids share the name, and the generic bucket
 * alone gathered a 483,207 artist "roster" that topped the seed label table.
 */
export function isPlaceholderLabel(name: string): boolean {
  // Casing is inconsistent in the dump: label 1818 alone appears as
  // "Not On Label", "Not On label", "Not on Label" and "not on label".
  return name.trimStart().toLowerCase().startsWith("not on label");
}

/**
 * Building the derived tables.
 */
export const derive = {
  /**
   * Releases crediting more than this many people generate no collaboration
   * pairs.
   *
   * Two people co-credited on a record are collaborators. Two people on track 7
   * and track 31 of a forty-artist compilation are not, and treating them as
   * such would flood every ranking with strangers. It also matters for cost:
   * pairs grow with the square of the credit list, so one 200-credit box set
   * would produce forty thousand of them on its own.
   *
   * The release itself is still kept. Only the pairing is skipped.
   */
  maxPeoplePerRelease: 20,
};

/** Rows to keep when building a development sample from a full dump. */
export const SAMPLE_SIZE = 5000;
