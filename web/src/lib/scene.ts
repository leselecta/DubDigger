/**
 * The scene, named rather than measured.
 *
 * Everything else in this app is derived. This is a judgement, written down.
 *
 * **Why it exists.** The seed grades how much of an artist's work sits inside
 * the style set `{Dub Techno, Deep Techno, Dub, Ambient, Minimal}`. That is the
 * right instrument for drawing a corpus boundary and the wrong one for ranking
 * centrality, because Dub means reggae, and Ambient and Minimal are each far
 * larger bodies of work than dub techno. 250,337 releases carry the seed flag.
 * Rank on it and the answer is The Orb, Grace Jones, Muslimgauze, Moby, UB40:
 * every one of them legitimately in the seed, none of them the answer to "who
 * matters in dub techno".
 *
 * Two fixes were measured and rejected before reaching for a list. Dropping
 * every credit but the artist line removes the mastering engineers and leaves
 * the ambient acts. Weighting credits by role made it worse, surfacing Adrian
 * Sherwood, Bill Laswell and Sly Dunbar: correct output, wrong question, and
 * the same hub-not-heritage failure the jazz rule hit in `ingest/src/config.ts`.
 * The measure ran out, so the scene is asserted.
 *
 * **Why it lives here and not in ingest.** Same argument as `roles.ts`. This is
 * editorial and it will be revised, so it is a code change rather than a
 * re-derive, and nothing about it is baked into the SQLite file. If it ever
 * grows past what can be computed on first use, it moves to `derive`.
 *
 * **What it drives.** Two channels, the same pair the corpus itself was built
 * from: a release belongs to the scene if it is on a scene label, or if its
 * artist line carries a scene artist. An artist's standing is how much of their
 * own artist-line work sits inside that, weighted by what share of them it is.
 * Dataset, product and ranking end up sharing one definition of related.
 *
 * Studio credits are deliberately not counted. Engineers are in the corpus and
 * on every page that shows credits; they are not what a "top artists" list is
 * asking about. That is Simone's call, and reversing it means counting
 * `release_credits` alongside `release_artists` below.
 */

/**
 * The canon. Sixteen acts nobody digging this music would argue about, from
 * Simone's list, plus three that the list names in its own rows but Discogs
 * files as group members rather than aliases, so alias expansion cannot reach
 * them: Rod Modell ("DeepChord (Rod Modell)"), and Moritz von Oswald and Mark
 * Ernestus ("Basic Channel / Maurizio / Rhythm & Sound").
 */
export const CORE_ARTISTS = [
  13117, // Basic Channel
  975, // Porter Ricks
  534, // Monolake
  406, // Vladislav Delay
  311802, // Stefan Betke, who records as Pole
  16162, // Wolfgang Voigt, who records as Gas
  973, // Vainqueur
  12858, // DJ Pete, who records as Substance
  969, // Scion
  1092, // Hallucinator
  18185, // DeepChord
  25125, // Yagya
  978, // Fluxion
  761268, // Quantec
  15056, // Deadbeat
  46691, // Echospace
  104937, // Rod Modell
  17111, // Moritz von Oswald
  456229, // Mark Ernestus
];

/** The wider list: relevant, not canonical. Ranked below the core, above the rest. */
export const NAMED_ARTISTS = [
  504831, 97364, 410991, 91, 2718, 156523, 420953, 101867, 40917, 317019, 956978, 1085091, 4340333,
  621780, 6514571, 518103, 967452, 1462833, 1730784, 1342748, 881554, 493156, 214016, 1993158,
  2981236, 933250, 1285, 1189777, 1638817, 891346, 179076, 663311, 4787225, 462786, 1063359, 5892,
  4520172, 530005, 953335, 5104054, 633,
];

/**
 * The labels the scene records for.
 *
 * Two from Simone's list are absent from this corpus and are left out rather
 * than carried as dead ids: nCompass (181470) and Know Thyself (370582).
 * Basic Channel, Chain Reaction and Rhythm & Sound arrive as one row on that
 * list and are three labels here.
 */
export const SCENE_LABELS = [
  255, 234, 768, 79724, 89598, 715, 144751, 31, 10999, 46981, 207711, 5306, 1465, 393581, 457, 1851,
  132653, 78265, 694039, 980123, 188482, 439777, 478570, 635170, 1707457, 97088, 588461, 95752,
  416176, 669382, 862058, 969622, 246087, 269, 640495, 260, 81833, 178535, 256140, 179045, 17087,
  245, 212599, 985, 59, 594019, 1626, 7647, 9520, 387813, 8367, 120499, 2525,
];

/**
 * Aliases inherit their artist's standing, but only above this much scene work.
 *
 * Expansion is on `alias` alone, never on group or member. An alias is the same
 * person under another name, which is identity; a band is not its members,
 * which is association, and CLAUDE.md already keeps those apart. It also
 * matters practically: expanding members reaches The Orb through Thomas
 * Fehlmann, and The Orb's 1,053 releases would sit on top of the list.
 *
 * The floor exists because Wolfgang Voigt alone carries dozens of aliases, and
 * without it a one-release side project outranks Heavenchord's 382. A named
 * artist is never subject to it: they were chosen by name and stay.
 */
export const ALIAS_BAND_FLOOR = 10;
