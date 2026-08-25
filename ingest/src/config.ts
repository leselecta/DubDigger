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

  /**
   * Styles that disqualify a release however it is otherwise tagged.
   *
   * The rule was allowlist only, which is not enough. A film score tagged
   * "Ambient, Minimal, Modern Classical, Soundtrack" on genre Electronic passes
   * the Minimal gate, and then the chain runs: the score enters the seed, its
   * sound engineer becomes a seed artist doing 29.7% of his work in scores, he
   * clears the bridge ratio, the Amadeus soundtrack arrives through channel A,
   * and Mozart walks in on its artist line. Three symptoms were patched before
   * the cause was traced.
   *
   * 9,078 of 259,415 seed releases carry one of these, so 3.5% of the seed.
   *
   * Field Recording is the debatable one, at 2,038 releases: there is a real
   * ambient and field recording overlap with this scene. Remove that entry if
   * the loss shows.
   */
  disqualifying: new Set([
    "Modern Classical",
    "Soundtrack",
    "Score",
    "Classical",
    "Opera",
    "Baroque",
    "Romantic",
    "Musical",
    "Spoken Word",
    "Contemporary",
    "Field Recording",
  ]),
};

export function isSeedRelease(styles: string[], genres: string[]): boolean {
  // Checked first, and it overrides everything. A record tagged both Dub Techno
  // and Soundtrack is a soundtrack that borrowed the sound.
  if (styles.some((s) => seedStyles.disqualifying.has(s))) return false;

  if (styles.some((s) => seedStyles.core.has(s))) return true;
  if (!genres.some((g) => seedStyles.genres.has(g))) return false;
  if (styles.some((s) => seedStyles.broad.has(s))) return true;

  return (
    styles.some((s) => seedStyles.needsTechno.has(s)) &&
    styles.some((s) => seedStyles.technoStyles.has(s))
  );
}

/**
 * Becoming a seed artist. Two rules, both learned from the corpus rather than
 * guessed at.
 */
export const seedArtist = {
  /**
   * At least this share of an artist's total output must sit inside the seed.
   *
   * Luciano re-edited Nina Simone's "Sinnerman", a record correctly tagged
   * Minimal on genre Electronic. That made Nina Simone a seed artist off 4
   * releases in 5,087, and vintage reissue labels then read as 74% scene,
   * cleared the label ratio and admitted their whole catalogues, Frank Sinatra
   * included.
   *
   * The distribution has no gap to read a threshold from, so real acts pin it.
   * Massive Attack does 26.92% of its work here and The Clash 8.91%, both of
   * which belong. Spice Girls 0.46%, Lady Gaga 0.10%, The Beatles 0.01% and
   * Mozart 0.00%, none of which do. 10% is ruled out because it cuts The Clash.
   *
   * 2% rather than 5% because they are indistinguishable on every case that
   * matters, including the budget compilation labels carrying Manowar and Iron
   * Maiden, and 5% would remove 16,000 more artists for no visible difference.
   * The aim is that a sceptic typing "Mozart" gets nothing, not a smaller
   * corpus. Everything short of obviously wrong stays and is handled by showing
   * relevance in the interface.
   */
  minSeedRatio: 0.02 as number | null,

  /**
   * Roles that do not make someone part of the scene.
   *
   * A photographer is not a musician. Otto Bettmann of the Bettmann archive is
   * credited on 64 releases, 11 of them in the seed, so his 17.2% clears the
   * bridge ratio honestly and he vouched a Frank Sinatra tribute into the
   * corpus. 23,919 seed artists qualified on packaging credits alone.
   *
   * Deliberately narrow: visual and text work only. Mastering and lacquer
   * cutting are audio work and stay, since the bridge ratio already handles the
   * engineers who work everywhere.
   *
   * This is a membership rule, not the role normalisation v1 rules out. Roles
   * are still stored raw and roles_seen still logs every distinct string.
   */
  packagingRoles: [
    "photograph",
    "artwork",
    "design",
    "illustration",
    "layout",
    "sleeve",
    "liner notes",
  ],
};

export function isPackagingRole(role: string): boolean {
  const lower = role.toLowerCase();
  return seedArtist.packagingRoles.some((marker) => lower.includes(marker));
}

/**
 * Authorship credits, which say who wrote the piece rather than who made the
 * record. They confer no corpus membership.
 *
 * Mozart is credited "Composed By" on 175 corpus releases and Beethoven on 85,
 * because a record sampling or performing a piece credits its author. That is
 * a fact about the composition, not evidence that anyone collaborated: Mozart
 * cannot have worked with a living techno producer.
 *
 * Same shape as the packaging rule, one stage later. Packaging credits are
 * stopped at the seed boundary, authorship credits at the admission boundary,
 * and both leave the role strings untouched in storage.
 *
 * Anyone holding a real credit elsewhere on the same record still joins on that
 * credit. This only removes the ones whose sole involvement is having written
 * something decades earlier.
 */
export const AUTHORSHIP_ROLES = [
  "composed by",
  "written-by",
  "written by",
  "music by",
  "words by",
  "text by",
  "lyrics by",
];

export function isAuthorshipRole(role: string): boolean {
  const lower = role.toLowerCase();
  return AUTHORSHIP_ROLES.some((marker) => lower.includes(marker));
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
   * Measured against the 20260801 dump, the two ends are far apart and this is
   * not a finger in the air. Majors land under 8% (Columbia 0.8%, EMI 1.9%,
   * Sony 2.3%, Universal 2.9%, Virgin 7.4%) while the scene labels land at
   * 58-100%: Chain Reaction, Basic Channel, Rhythm & Sound and Echocord at
   * 100%, then Burial Mix 84%, Ostgut Ton 84%, Kompakt 77%, Hessle Audio 69%,
   * Livity Sound 69%, Tresor 66%, Modern Love 58%.
   *
   * The middle is NOT empty, which this file claimed for a while and the
   * distribution does not support: 5,206 labels sit between 35% and 50% and
   * 5,829 between 50% and 65%. Tectonic at 49% and Hyperdub at 46% are on the
   * wrong side of a cliff by a point or two. That is tolerable for the corpus
   * boundary, which needs one answer and gets pass 2 channel A as a second
   * route in, and it was NOT tolerable for the reader, which is what
   * `labelRelevance` below now fixes.
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

  /**
   * A release crediting more than this many people does not admit NEW artists
   * through channel A. The release itself is still kept, and everyone already
   * in the corpus keeps their credit on it.
   *
   * Two people who made a record together collaborated. Track 7 and track 31 of
   * a forty-artist compilation share nothing but shelf space, and admitting
   * everyone on one is how a gospel record and an Italian punk anthology each
   * put an unrelated act called "Chain Reaction" into a dub techno corpus.
   *
   * Measured on the 20260801 corpus, of the 389,002 artists whose only route in
   * was a single channel A release: 43% arrived on a release crediting 15 or
   * more people, 31% on 8 to 14, and just 7% on an intimate 1 to 3. So the
   * noise is concentrated in crowded records, and a threshold of 8 removes
   * roughly 286,000 coincidences while keeping the 25,584 genuine two and
   * three person one-offs.
   *
   * Same reasoning as derive.maxPeoplePerRelease, applied at the corpus
   * boundary rather than to the collaborator pairs.
   */
  channelAMaxPeopleToAdmit: 8,
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
 * How close to the scene an artist sits, graded rather than binary.
 *
 * Seed membership is a yes or no, and it has to be, because it decides what the
 * corpus contains. But 132,571 artists cleared it, and inside that set the
 * difference between Rhythm & Sound and someone with two records in the seed is
 * the difference between the answer and a footnote. The interface needs to say
 * which, so this grades it.
 *
 * Two signals, and neither works alone. Share alone puts an artist with one
 * record out of one above Moritz von Oswald. Volume alone puts Aphex Twin, who
 * has 114 seed releases in 1,079, above Basic Channel, who has 61 in 77.
 * Requiring both is what sorts them.
 *
 * The share is measured against an artist's WHOLE output as the dump has it,
 * not against their corpus releases. Depeche Mode has 75 seed-style releases
 * among the 204 of theirs the corpus kept, which reads as 37% and would rank
 * them high; against their real catalogue it is a fraction of a percent. The
 * corpus denominator is truncated for exactly the artists this most needs to be
 * honest about.
 */
export const relevance = {
  /**
   * More than half. Added 2026-08-25, and it is a seam rather than a new dial:
   * the old top step ran from Jeff Mills at 15.4% to Fluxion at 97.9% and put
   * one word on 16,985 artists, so Basic Channel at 79% and someone with a
   * fifth of their output in the cluster read the same.
   *
   * 50% is the cut because it says something a reader can check: most of what
   * this artist did is in the cluster. It lands where the canon does. Above it,
   * Fluxion 97.9%, Rhythm & Sound 93.8%, DeepChord 88.5%, Deadbeat 80.1%,
   * Basic Channel 79.2%, Maurizio 76.4%, Monolake 66.7%, Vainqueur 64.1%,
   * Porter Ricks 62.3%, Rod Modell 54.8%. Below it, the people who did this and
   * also did other things: Vladislav Delay 48.5%, Mark Ernestus 46.8%, Moritz
   * von Oswald 38.4%, Pole 37.3%, Wolfgang Voigt 29.2%.
   *
   * It is the same number the label rule already cuts at, which is not a
   * coincidence worth hiding: on both sides of the site the top step means more
   * than half, of an artist's output or of a label's roster.
   *
   * The floor of 5 releases is the old one, unmoved. It is what stops a one-off
   * from reading as devotion, and it matters more here than anywhere: 31,809
   * artists have 2 to 4 seed releases at 15% or better, 6,546 of them at 100%
   * off two records out of two.
   */
  veryHigh: { minSeedReleases: 5, minSeedShare: 0.5 },
  /**
   * The old top step, kept where it was, plus a route in on volume.
   *
   * The share bar does not move: Jeff Mills at 15.4% and 160 seed releases is
   * the boundary case it was set by, and he is central to what this tool is
   * for. What is new is `orSeedReleases`, which is the step reaching down into
   * medium now that there is a step above it holding the top.
   *
   * IT REVERSES A CALL THIS FILE USED TO MAKE. Aphex Twin at 10.6% and The
   * Clash at 8.8% were pinned as medium, on the argument that both belong in
   * the corpus and neither is the scene. That argument was written when high
   * was the top step and therefore meant "this is the scene". It is now second
   * of five with the top step above it, so it means "deep in the cluster, among
   * other things", which is exactly what a 114-record run through these styles
   * is. The 5% share bar is what keeps the route honest: it admits 844 artists,
   * and a mastering engineer with 60,000 credits reaches nothing.
   */
  high: { minSeedReleases: 5, minSeedShare: 0.15, orSeedReleases: 20, orMinSeedShare: 0.05 },
  /**
   * Either a real share of a small output, or enough core work that the share
   * stops mattering. 20 seed releases is a body of work in this scene whatever
   * else the artist did.
   *
   * Untouched by the fifth step, deliberately. Every lineage floor sits on this
   * bar, so moving it would move King Tubby and Fela Kuti under a change that
   * is about the top of the scale.
   */
  medium: { minSeedReleases: 2, minSeedShare: 0.05, orSeedReleases: 20 },
};

/**
 * The same five steps for a label, so one word means one thing site-wide.
 *
 * WHY THIS EXISTS. A label used to be graded yes or no: a seed label read High
 * and everything else read Low. That put Ndagga, Mark Ernestus' own Senegalese
 * imprint at 43%, in the same bucket as Columbia at 0.8%, and Tectonic missed
 * the cliff by a point. The dial is right for the corpus boundary, which needs
 * one answer, and useless as a description.
 *
 * IT IS THE SAME MEASURE, NOT A NEW ONE. Read from `label_artist_pairs`: every
 * act on the artist line of the label's releases across the whole dump, and how
 * many of them are seed artists. `very high` IS the seed-label rule, so what
 * the corpus calls a scene label and what a reader is told stay one decision.
 * That invariant did not move when the fifth step was added on 2026-08-25; the
 * step it names did. `check-corpus` asserts it against the top step by name.
 *
 * WHAT IT IS NOT MEASURED ON. Not the roster the label page lists. That roster
 * is corpus artists only, artist line plus credits, and both differences push
 * the same way: every act on it is already scene-adjacent by construction, and
 * mastering engineers count as roster. Measured that way EMI comes out at 32%
 * and Columbia at 31% against Tresor's 45%, which is the separation destroyed.
 * The page therefore lists one set and grades another, and the wording says so
 * rather than calling the denominator "roster".
 *
 * As built: 18,498 very high, 4,953 high, 5,554 medium, 51,677 low, 33,270
 * none.
 */
export const labelRelevance = {
  /**
   * The step between the seed dial and the middle, added with the artist one so
   * the two scales keep the same shape.
   *
   * 35% is where the labels sit that the seed dial cuts off by a point or two
   * and that nobody would file next to Warp: Tectonic 49%, Hyperdub 46%,
   * Ndagga 43%, Metroplex 40%, Honest Jon's 39%. Warp at 31% stays medium,
   * which is the separation this step is for. Every major is an order of
   * magnitude below, the closest being Virgin at 7.4%.
   *
   * The floor is the seed rule's own, for the reason spelled out under medium:
   * a ratio needs two names behind it.
   */
  high: { minSeedArtists: 2, minSeedArtistRatio: 0.35 },
  /**
   * The middle step, and the whole point of the table when it had three steps.
   * 2 seed artists and 25% catches the labels the cliff cut in half. Most of
   * them have since moved up to `high`, which is what that step is for; what
   * stays here is the band from Warp at 31% down, still clear of every major.
   *
   * The floor is the seed rule's own, and it guards the middle step for the
   * same reason it guards the top one: 26,393 labels are a single seed artist
   * at 50% or more, nearly all of them one act releasing one record on their
   * own name. A ratio needs two names behind it before it describes anything.
   */
  medium: { minSeedArtists: 2, minSeedArtistRatio: 0.25 },
};

/**
 * Lineage: the editorial rules in the corpus.
 *
 * Everything else here is derived. These are judgements, stated openly.
 *
 * WHY THE MEASURE NEEDS HELP. Relevance counts an artist's work inside the dub
 * techno seed. By that count King Tubby scores what the Spice Girls score:
 * `Dub` is only a seed style on genre Electronic, so 206 of his 221 corpus
 * releases are invisible to the seed by construction, and the 15 that are
 * visible are 0.51% of a catalogue inflated by decades of reissues. Defensible
 * as graph output, wrong as an answer a digger would accept.
 *
 * No measure of the scene fixes it, and that was proved before reaching for a
 * rule. Bob Marley has 123 seed releases to King Tubby's 15, Madonna 106,
 * Depeche Mode 75. On connection strength Madonna has 63 ties into the seed and
 * Mozart 75, against Tubby's 57. Every threshold that lifts Tubby lifts Madonna
 * higher. "Ancestor of" is a historical fact and style co-occurrence cannot
 * express it, so it is asserted here instead.
 *
 * HOW IT LANDS. A tradition raises the merged grade to `floor` and no further.
 * The measured grade is kept alongside it in artist_coverage.scene_relevance,
 * so a page can say which of the two it is reading and never implies scene work
 * that is not there. An artist already at high stays high.
 *
 * PRECEDENCE. Styles are tried before labels, in array order, first match wins.
 * Only one tag is stored: a Jamaican player who also cut for Metroplex reads
 * "roots dub", which is the truer of the two.
 *
 * THE BAR FOR ADDING ONE. Higher now than when lineage was a separate row,
 * because a tradition no longer annotates a grade, it sets one, and the search
 * results column shows the word with no room for the reason. A tradition needs
 * a line of descent someone can name, and dials that provably miss the acts it
 * must not catch. A jazz rule was measured and rejected on exactly this: genre
 * Jazz at these dials tags 11,281 artists and lifts 4,360, headed by John Zorn,
 * Peter Brötzmann, Evan Parker and two mastering engineers, none of whom are
 * upstream of anything here. They are in this corpus because Bill Laswell
 * produced half of New York's avant-garde, which is a hub, not a heritage.
 */
export const lineage = {
  /**
   * Which grades a floor may lift, keyed by the floor itself.
   *
   * A tradition raises an artist TO its floor and never past it, so the only
   * grades it may touch are the ones below. Written out rather than computed
   * from an ordering, because there are five steps and two floors, and the two
   * floors are both near the bottom: the fifth step went in above every grade
   * listed here, so adding it needed no edit to this map.
   */
  liftsFrom: {
    medium: ["none", "low"],
    low: ["none"],
  } as Record<string, string[]>,

  /**
   * Traditions read off what an artist records.
   *
   * roots dub: the founding line. Basic Channel and Rhythm & Sound made reggae
   * records with Jamaican vocalists and cut them in their own dubplate room, so
   * this is descent you can point at rather than resemblance. Share of corpus
   * releases tagged Dub on genre Reggae: Jah Shaka 86%, King Tubby 72%, Prince
   * Jammy 67%, Scientist 49%, Augustus Pablo 46%, Errol Thompson 24%, against
   * Madonna 0.2% and a clean zero for Spice Girls, Björk, Depeche Mode, Mozart
   * and The Beatles. 3,896 tagged, 1,109 of them otherwise ungraded: the
   * Jamaican session pantheon, Roots Radics and Chinna Smith and Dean Fraser.
   *
   * afrobeat: Simone's call, made with the counter-argument on the table and
   * recorded that way rather than dressed up as something the data implies.
   * There is no documented line from Fela Kuti to dub techno the way there is
   * from King Tubby; afrobeat acts are in this corpus through a real credit,
   * not through descent. What is true is that this tool is a map of a scene's
   * roots and neighbours, and he wants that map to hold the black traditions
   * the music keeps company with rather than rank them as footnotes. The rule
   * is small and precise enough to be honest about: 471 tagged, 113 lifted.
   * The interface says "a sound this scene often borrows from" for this one and
   * "grew out of" for the dub line, because those are different claims and only
   * one is descent. Borrowing is the honest verb: it is what the map actually
   * asserts, and it is still not a line of descent.
   *
   * dubstep and uk garage: the one tradition here that runs DOWNSTREAM, and the
   * only one whose acts the corpus already holds in quantity. Every other rule
   * names an ancestor or a neighbour; this names the generation after, the scene
   * dub techno's own inheritance fed into. It is here because the measure fails
   * the same way it failed King Tubby, only from the other direction: Burial
   * read low and Kode9 low, Skream, Loefah, Silkie, Commodo and Kromestar read
   * nothing at all, while Pinch, Shackleton, Peverelist and Mala already read
   * high on measured scene work. One scene cannot be both, and the half the seed
   * can see is the half that happened to record in Berlin's styles.
   *
   * Two styles, counted together, because the tradition is one thing and Discogs
   * spells it two ways: Loefah's DMZ sides are Dubstep, El-B's and Wookie's are
   * UK Garage, and the scene runs straight through both. Neither style alone
   * reaches the floor for several of them.
   *
   * The separation is the cleanest of any rule here. Silkie 98.6%, Commodo 100%,
   * Kromestar 95.7%, Mala 92.3%, Kode9 86.7%, Pinch 79.3%, Skream 67.5%, Burial
   * 27.7%, against a flat zero for Madonna, Depeche Mode, Spice Girls, Mozart,
   * The Beatles and Basic Channel, 0.15% for Björk, 0.6% for Bob Marley and 0.9%
   * for Massive Attack. 1,273 tagged, 582 lifted, 348 of them from nothing.
   *
   * No fixture of any other tradition is touched: King Tubby, Scientist, Bob
   * Marley, Toots, Gilles Peterson and Roni Size all sit under the dials on it.
   * It does re-claim 56 artists reading "reggae" and 11 reading "uk jazz", and
   * both are corrections rather than losses: DJ Madd, Von D and Kahn are dubstep
   * producers whose records carry genre Reggae, and Mala read "uk jazz" off Mala
   * In Cuba on Brownswood.
   *
   * The floor is medium, not the low that acid jazz and DNB gets, and the
   * difference is the distance to dub. Acid jazz inherits from Jamaica at one
   * remove; dubstep is named for dub, built on sound-system weight, and Kode9
   * called his label Hyperdub. Same inheritance as this scene, one generation
   * on, which is kinship rather than descent: the interface says "shares" and
   * not "grew out of", because dubstep came after dub techno, not before it.
   *
   * TWO KNOWN COSTS, both accepted. Skrillex is tagged, on 7 of 19 releases that
   * are honestly Dubstep and UK Garage in the dump; the rule catches him because
   * he really did make those records, and the alternative dials that drop him
   * also drop Todd Edwards and MJ Cole. Horsepower Productions is missed, on 4
   * of the 6 releases the corpus holds, one under the floor: the same shape as
   * Shabaka Hutchings, and loosening to 3 releases would take the tag from 1,273
   * artists to 2,420 and start catching Rihanna at 3 of 6.
   */
  byTag: [
    /** Style and genre together. Either alone is a different music. */
    { name: "roots dub", styles: ["Dub"], genre: "Reggae", minReleases: 5, minShare: 0.2, floor: "medium" },
    /** Afrobeat is specific enough as a style that no genre gate is needed. */
    { name: "afrobeat", styles: ["Afrobeat"], genre: null, minReleases: 5, minShare: 0.2, floor: "medium" },
    /**
     * Two styles, one scene, and no genre gate: both names are specific enough
     * that nothing else wears them. After the dub line, so a Jamaican engineer
     * with dubstep remixes still reads as what he mostly is, and before reggae,
     * so a dubstep producer working in reggae does not read as the catch-all.
     */
    {
      name: "dubstep and uk garage",
      styles: ["Dubstep", "UK Garage"],
      genre: null,
      minReleases: 5,
      minShare: 0.2,
      floor: "medium",
    },
    /**
     * Genre alone, and last, so anything more specific claims the artist first.
     *
     * The generation above roots dub. Toots & The Maytals read very low, level
     * with the Spice Girls, and unlike King Tubby no dub rule could reach them:
     * they are ska, rocksteady and roots reggae, with exactly one Dub-tagged
     * record in 45. Reggae is where dub came from and dub is where this scene
     * came from, so it belongs on the map at one step less than the dub line.
     *
     * Genre rather than style because 17 of those 45 releases carry no style at
     * all, just `Reggae`. A style rule cannot see them.
     *
     * The separation is as clean as the dub one: Toots, Burning Spear and
     * Culture at 100%, Desmond Dekker 97%, Bob Marley 90%, Jimmy Cliff 60%,
     * against Massive Attack 5% and a flat zero for Spice Girls, Madonna,
     * Mozart, The Beatles and Iron Maiden. The Clash sits at 19%, just under,
     * and is already medium on scene work anyway.
     */
    { name: "reggae", styles: null, genre: "Reggae", minReleases: 5, minShare: 0.2, floor: "low" },
  ],

  /**
   * Traditions read off where an artist released.
   *
   * detroit techno: the other founding line, and Berlin said so out loud. It
   * cannot be a style rule, because `Detroit Techno` does not exist as a
   * Discogs style (zero rows in this corpus) and `Techno` was kept out of the
   * seed for being too broad. So the imprints stand in for the tradition, by
   * ID rather than by name because "Axis" and "Buzz" are not unique strings.
   *
   * Lower dials than the style rules: a curated list of ten labels is already
   * the precision, so the share only has to rule out a one-off guest. At 3
   * releases and 10% it tags 271 and lifts 171, taking Underground Resistance,
   * Rhythim Is Rhythim, Mike Banks, Kevin Saunderson, Octave One and Theo
   * Parrish off the floor, all of whom read "very low" before it.
   *
   * Tresor is deliberately NOT here. It is the Detroit-Berlin bridge and it
   * would tag several hundred Berlin techno artists as Detroit descent. The
   * cost is Drexciya, whose corpus presence is 45 Tresor releases and nothing
   * else, so they stay ungraded. A wrong tag on hundreds beats a right one on
   * one.
   *
   * uk jazz: the scene around Gilles Peterson and Brownswood. A genre-wide jazz
   * rule was measured and rejected for tagging 11,281 artists off Bill
   * Laswell's address book; naming the rooms instead is what makes it honest.
   * Nine labels, 2 releases and 10%, tagging 343 and lifting 146: Gilles
   * Peterson, Matthew Halsall, Bradley Zero, Nubya Garcia, Moses Boyd, Nat
   * Birchall, Portico Quartet. John Zorn, Peter Brötzmann and Evan Parker have
   * zero releases between them on these labels, which is the whole point.
   *
   * Shabaka Hutchings is missed, on 1 of 13, because the corpus holds his
   * Impulse! and Verve records rather than his Brownswood ones. Loosening the
   * dial to reach him would admit everyone with a single compilation credit.
   *
   * acid jazz and DNB: Talkin' Loud, and the only tradition with a floor of
   * `low`. It is Gilles Peterson's own label, so it looked like part of the
   * rule above until the roster was read: Roni Size, Krust, DJ Die, Suv and
   * Reprazent alongside Galliano and Young Disciples. Calling Bristol drum and
   * bass "uk jazz" would be wrong, and dropping it would lose a real thread,
   * since acid jazz and DNB both carry a Jamaican inheritance of their own.
   * Simone's call: its own tradition, lifted one step rather than two, because
   * the inheritance is at one remove. 145 tagged, 65 lifted.
   */
  byLabel: [
    {
      name: "detroit techno",
      labels: [
        415, // Metroplex
        388, // Transmat
        290, // KMS
        258, // Underground Resistance
        43, //  Axis
        1, //   Planet E
        257, // 430 West
        70, //  7th City
        399, // M-Plant
        374, // Sound Signature
      ],
      minReleases: 3,
      minShare: 0.1,
      floor: "medium",
    },
    {
      // Before acid jazz below, so Gilles Peterson himself reads as the scene
      // he curates now rather than the one he ran in the nineties.
      name: "uk jazz",
      labels: [
        62136, //  Brownswood Recordings
        3244, //   Brownswood Records
        116373, // Gondwana Records
        695882, // Rhythm Section International
        617182, // 22a
        710676, // Jazz Re:freshed
        755637, // Total Refreshment Centre
        143126, // First Word Records
        143129, // Eglo Records
      ],
      minReleases: 2,
      minShare: 0.1,
      floor: "medium",
    },
    {
      name: "acid jazz and DNB",
      labels: [
        118, //    Talkin' Loud
        123224, // Talkin' Loud Classics
      ],
      minReleases: 3,
      minShare: 0.1,
      floor: "low",
    },
  ],
};

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
