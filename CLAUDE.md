# CLAUDE.md

Project brief and working rules for this repository. Read this before generating code.

Every number in this file was measured against the corpus built from the 20260801 dump. When a number here disagrees with the code, the code is the truth and this file is the bug: say so, then fix whichever is actually wrong.

## What this is

A crate-digging tool built on Discogs credit data. The core loop: **type an artist, see who they worked with and what labels they released on, then click any of those to keep digging.** A map of scenes, drawn from credits.

The user is a music nerd who reads Discogs pages for fun, not a casual listener. Design for information density and fast pivoting, not for a gentle onboarding.

**For the full design rationale, why ranked lists beat a graph, the competitive research that led there, and the Gall's Law scoping reasoning, see `case-study-credit-graph.md`.** It sits in the working copy but is not committed, so it is on Simone's machine and not in a clone: every later mention of "the case study" means that file. This file states the resulting rules; the case study explains why they're the right rules. When a decision isn't covered by a rule below, reason from the case study's logic rather than defaulting to a generic pattern, and say so if the file is not to hand.

## Where it stands

Beta, and the footer says so. The corpus is built, the app is written, and the VPS has served it at dubdigger.com since 2026-08-12. What ships today:

| | |
|---|---|
| Corpus | 1,095,302 releases · 444,723 artists · 114,226 labels · 4,110,875 credits |
| Seed | 132,571 artists · 18,999 labels |
| Pages | home and search, artist, label, Core Artists, Core Labels, Info, 404 |
| Ingest database | 5.3 GB, `ingest/data/dubdigger.sqlite` |
| Published database | 931 MB, `web/data/dubdigger.sqlite` |

## Scope (v1) — hold this line

Deliberately small, per Gall's Law: a working simple system first.

- **One data source:** Discogs monthly XML dumps (CC0 licensed). No live API in v1.
- **Two entities:** Artist and Label.
- **Edges:** collaboration (two artists co-credited on a release) and label (a release's label). Tracks are NOT a top-level entity; they surface *through* collaborations and labels.
- **Corpus:** a dub-techno-centred slice, selected by the two-pass, two-channel strategy below, NOT the whole Discogs catalogue.

### Explicitly OUT of scope for v1 — do not add these unprompted
- MusicBrainz integration / dual-source model
- Alias and project resolution beyond what Discogs already provides. What the dump gives directly is in and shipping: `artist_relations` carries aliases, members and groups, and the artist page shows them as "Also known as", "Members" and "Member of". Inferring a link Discogs does not state is the part that stays out.
- Graph / force-directed visualisation in v1 (potential v2, see "Future considerations: Graph view" in the case study)
- Images of any kind in v1 (see licensing note below). **Named as v1.1, not a same-week addition.**
- NTS or any second data source
- `<companies>` as entities: distributors, record shops, pressing plants, studios. Discarded at parse time, so Hard Wax, EFA and every mastering room have no page by construction rather than by a threshold. Parked for v2 on 2026-09-01 with the four constraints that any design has to satisfy, in `V2.md`. Read that before re-investigating: the short version is that grading such an entity on the label scale opens channel B on a warehouse.

Each is a later evolution of a working core. If a task seems to need one, stop and flag it rather than building it.

## Architecture — the key boundary

**All heavy work happens offline, on the developer's machine. The server only ever reads a small precomputed SQLite file.**

- **Ingest** (offline, run rarely): stream-parse the Discogs dumps, select the corpus, project to a thin field set, write raw SQLite tables, then precompute aggregations into query-ready derived tables.
- **App** (online, trivial): an Astro app that reads the derived SQLite file read-only. No database server, no Redis, no search cluster.

Keep ingest scripts entirely separate from the web app. The app must never parse a dump or hit the Discogs API.

npm workspaces, `ingest` and `web`. The ingest commands, in the order they run:

```
fetch-dumps  make-sample  pass1  measure-seed  seed-labels
pass2  entities  derive  check-corpus  publish
```

`publish` is the boundary: it writes a standalone read-only copy into `web/data/`, carrying the derived tables and the FTS indexes and leaving the ingest bookkeeping behind.

## Corpus selection — two passes, two channels

The goal is a corpus centred on dub techno but wide enough to include *neighbours of the scene*: both people who collaborated with a core artist, AND people who share a label with a core artist without ever working with them directly. A naive single-pass style filter keeps the right records but loses both kinds of neighbour. Do NOT implement a single-pass style filter, and do NOT expand via collaboration only, or label rosters will be silently incomplete.

Every dial is in `ingest/src/config.ts`, each with the measurement that set it written above it. Read that file before changing one.

**Understanding the Discogs style data first:**
- A release carries multiple `<styles>` at once. A record can be tagged `Dub Techno, Techno, Minimal` simultaneously.
- Style facet counts on Discogs search are co-occurrence within the current result set, not global totals. Irrelevant to ingest, but don't be misled by them.

### Pass 1 — the seed

**A flat style list does not work, and this is the single most important non-obvious thing in the ingest.** Filtering on `{Dub Techno, Deep Techno, Dub, Ambient, Minimal}` produced 702,038 seed releases and a seed label table topped by EMI, Columbia, Sony and Virgin. "Dub" pulled in the reggae catalogue, "Minimal" minimalist classical, "Ambient" new age and soundtrack work. The core two styles were only 6.7% of the result.

Genre is what separates them, so the rule is tiered (`isSeedRelease`):

| tier | styles | admitted |
|---|---|---|
| core | `Dub Techno`, `Deep Techno` | whatever the genre |
| broad | `Minimal`, `Dub` | only on genre `Electronic` |
| needs techno | `Ambient` | only alongside `Techno`, `Minimal Techno`, `Dub Techno` or `Deep Techno` |
| disqualifying | 11 styles, `Modern Classical` through `Field Recording` | never, however else tagged |

`Techno` is deliberately absent from every tier: too broad, and pass 2 already reaches into it through real connections.

The disqualifying list is a blocklist on top of an allowlist, and it exists because an allowlist alone let a chain run: a film score tagged `Ambient, Minimal, Modern Classical, Soundtrack` on genre Electronic passed the Minimal gate, its sound engineer became a seed artist, he cleared the bridge ratio, the Amadeus soundtrack arrived through channel A, and Mozart walked in on its artist line. Three symptoms were patched before the cause was found. It costs 3.5% of the seed.

Two more rules decide who becomes a **seed artist**:

- **`minSeedRatio` 2%** of their whole output must sit inside the seed. Luciano re-edited Nina Simone's "Sinnerman", correctly tagged Minimal on Electronic, which made Nina Simone a seed artist off 4 releases in 5,087 and admitted whole reissue catalogues behind her, Sinatra included. The distribution has no gap, so real acts pin it: Massive Attack 26.92% and The Clash 8.91% belong; Spice Girls 0.46%, Lady Gaga 0.10%, The Beatles 0.01%, Mozart 0.00% do not. 10% is ruled out because it cuts The Clash.
- **Packaging credits confer nothing.** A photographer is not a musician. 23,919 seed artists had qualified on packaging alone, and Otto Bettmann of the Bettmann archive vouched a Sinatra tribute in at an honest 17.2%. Deliberately narrow, visual and text work only: mastering and lacquer cutting are audio work and stay.

Then the **seed label set**: every label a seed artist released on, qualifying only if BOTH hold.

- **Floor, `minSeedArtists` 2.** Guards against a tiny label qualifying on one coincidence.
- **Ratio, `minSeedArtistRatio` 0.5, OR `broad` at 20 seed artists and 35%.** Either gate admits, and each needs both of its own numbers. The 0.5 guards against a large label qualifying because one seed artist released on it once. The two ends are far apart: majors land under 8% (Columbia 0.8%, EMI 1.9%, Sony 2.3%, Universal 2.9%, Virgin 7.4%) and scene labels at 58–100% (Chain Reaction, Basic Channel, Rhythm & Sound and Echocord all 100%, Burial Mix 84%, Ostgut Ton 84%, Kompakt 77%, Hessle Audio 69%, Livity Sound 69%, Tresor 66%, Modern Love 58%). **The middle is not empty, and this file said it was until 2026-08-14:** 5,206 labels sit between 35% and 50% and 5,829 between 50% and 65%, so Tectonic at 49% and Hyperdub at 46% are on the wrong side by a point or two. Tolerable for the corpus boundary, which needs one answer and has channel A as a second route in. Not tolerable for a reader, which is what the label grade below fixes.

  **And on 2026-08-30 it stopped being tolerable for the boundary either.** Ghostly International sits at 48.7% and PAN at 41.9%, so channel B never opened on either and nothing was kept for being on them. Whatever The Weather has no page as a direct result, and Loraine James cannot bridge from the other side at 1.75%. 50% is the right bar for a four-act imprint and the wrong one for a label with a hundred names on it, where a third of the roster is the stronger claim. Hence the second gate: **20+ seed artists at 35%**, where the floor of 20 is what makes 35% mean anything. It admits 501 labels, 18,498 to 18,999, every one of them moving up from `high`. Separation holds: majors an order of magnitude below with Virgin closest at 7.4%, and Warp the nearest genuine near-miss at 31.1%. What comes in is Beat Records, Planet Rhythm, R & S, Bureau B, Opal Tapes, Tronic and Compost, with Tectonic 49.2% and Hyperdub 45.7% alongside the two that prompted it. **Metroplex still misses at 18 of 45, two short of the floor, and Ndagga at 3 of 7 is beyond any ratio rule** — both accepted, because lowering the floor to catch one named label is fitting the dial to the answer. A flat drop to 0.45 was rejected: 772 labels, a number that measures nothing, and it loses the same sentence anyway.

Both sets are held in memory and persisted as saved artifacts, because they are the definitional core of the corpus: needed for debugging "why is this person in?", for the provenance marker, and for re-running pass 2 without redoing pass 1.

### Pass 2 — one hop out, two channels

Stream the releases dump again. Keep a release if EITHER channel applies:

- **Channel A, collaboration:** the release credits a seed artist. Captures neighbours who enter through a real working relationship, bringing their other credits with them.
- **Channel B, label membership:** the release is on a seed label. Captures pure label-mates, who share a room with the scene but never personally worked with anyone in it. Without this channel, "who else is on this label" is a question the data cannot answer.

Harvest artist IDs from all kept releases. Union of pass 1 and pass 2 releases is the corpus.

**Stop at one hop, on both channels.** Two hops eventually drags in most of Techno, which defeats the point.

Three dials keep channel A from swallowing Discogs, and the first is the one that matters:

- **`channelAMinSeedRatio` 0.1 — the size dial.** The first full pass 2 expanded 179,416 seed artists into 6,563,471 releases, a third of Discogs, 98% of it through channel A. The cause was degree: the seed contains mastering engineers who also worked on tens of thousands of unrelated records, and all 60,386 of Bob Ludwig's releases walked in behind him. A flat credit cap cannot fix it, because Moritz von Oswald has 556 credits and looks the same from outside. Share of work separates them cleanly: von Oswald 42.8% and Mark Ernestus 76.3% against Ludwig 0.2%, Bernie Grundman 0.3%, Beethoven 0.0%. Suppressed artists keep their pages and credits; they just stop being treated as evidence that two unrelated records belong to one scene.
- **`channelAMaxPeopleToAdmit` 8.** A release crediting more than eight people admits no NEW artists, though it is still kept and everyone already in keeps their credit. Track 7 and track 31 of a forty-artist compilation share shelf space, not a collaboration, and that is how a gospel record put an unrelated act called "Chain Reaction" into a dub techno corpus. Of artists whose only route in was one channel A release, 43% arrived on a release crediting 15 or more people and 7% on an intimate one to three. **It is channel A's dial alone**, which the name says and the code confirms: `if (channelA && !crowded)` against a bare `if (channelB)`. A label mate on a seed label is admitted however crowded the record, so before blaming this dial for a missing artist, check which channel could have reached them at all. That asymmetry is why the 2026-08-30 seed-label gate could admit Whatever The Weather off records crediting far more than eight people.
- **`channelAMinSharedReleases` 1.** Off, effectively. Raise it only if the corpus comes out too large.
- **Authorship credits confer no membership.** Mozart is "Composed By" on 175 corpus releases because sampling a piece credits its author. That is a fact about the composition, not evidence anyone collaborated. Same shape as the packaging rule, one stage later: packaging stops at the seed boundary, authorship at the admission boundary, and both leave the stored role strings untouched.

**Placeholders are not people.** `Various`, `Unknown Artist`, `No Artist`, `Traditional` (27,068 written-by credits) and any credit whose id parses as 0 (833,731 of them in the first run, which would have made "artist 0" the best-connected person in the database). Labels the same: `Not On Label` in any casing, across 19,947 distinct ids, whose generic bucket alone gathered a 483,207-artist "roster".

**Tag provenance per artist: channel A, channel B, or both.** A collaborator is not a label-mate and the interface must be able to say which. As built: 188,710 non-seed artists arrived by collaboration only, 48,865 by label only, 50,429 by both.

**Measure between passes.** Corpus size is data-dependent and unpredictable. Report seed artist and seed label counts after pass 1, then the per-channel result of pass 2, before committing. `measure-seed` exists for exactly this.

**And while pass 2 is running, read the MARGINAL keep rate, never the cumulative one.** The dump is ordered by release id, so it opens on old, reissue-heavy records that match far above trend. On 2026-08-30 the cumulative rate read 9.1% at 2.1M scanned against a 4.2% historical average, which looked like a corpus about to double; the marginal rate between successive samples was already falling through 4.9% and settled at 3.4%, and the corpus grew 4.0%. Take two samples and divide the difference, or the steering signal points the wrong way for the first third of the run.

**Pass 2 reads the dump twice, and the first read looks exactly like a hang.** Phase 1 streams all 19.3M releases only to measure each seed artist's degree, which is what `channelAMinSeedRatio` needs and cannot know in one pass. It writes nothing, commits nothing and prints nothing: high CPU, a static WAL and total silence for about 13 minutes of a 27 minute run. Progress lines belong to phase 2 alone. Do not kill it, and do not go looking for a deadlock.

The nice property: the corpus boundary uses the same "related via collaboration or label" logic the tool itself surfaces. Dataset and product share one definition of related.

## The data (Discogs XML dumps)

Four monthly gzipped XML files: `artists`, `labels`, `masters`, `releases`. We use three and skip `masters`. The `releases` file is 100+ GB uncompressed and holds the credits. Everything about performance is about not paying full freight on it.

### XML quirks to handle
- **Credits live in `<extraartists>`**, an artist reference plus a free-text `<role>`. Roles are uncontrolled: `Engineer`, `Engineer [Recording]` and `Recorded By` may all mean the same thing. Ingest stores the raw string and **logs every distinct role in `roles_seen`**. Never silently drop an unmapped role. The naming happens at the other end, in the app.
- **Multi-artist join phrases** ("feat.", "&"). Preserve the artist IDs; don't parse the join phrase semantically in v1.
- **Aliases and name variations** exist in the `artists` dump. Use what Discogs gives directly.
- **Various-artists releases** have a special artist reference. Handle without crashing the collaboration logic.
- **Styles vs. genres.** Both are needed: the seed rule reads styles gated by genre, and `reggae` lineage reads genre alone.

## Ingest rules

- **Always stream** with `iterparse`-style parsing; `clear()` each element after extraction. Never load a dump into memory whole. The seed-artist ID set is the one thing held in memory, and that is fine.
- **Project aggressively.** Keep release ID, artists and roles, `extraartists`, label ref, tracklist, styles, genres. Discard formats, country, notes, matrix, companies, identifiers.
- **Develop against a truncated copy first.** `make-sample` takes 5,000 rows. Prove correctness there before the full run. **The sample is the head of the dump and is therefore biased**: prove passes correct on it, never tune the corpus dials from it.
- **Re-ingest is deliberate, not runtime.** The SQLite file is a static artifact regenerated occasionally, never refreshed by the app. Regenerating means restarting the server, which is what `publish` already tells you.

## Data model

**Raw:** `releases`, `release_artists`, `release_credits`, `release_labels`, `release_styles`, `release_genres`, `artists`, `labels`, `artist_relations`.

**Ingest bookkeeping, not published:** `seed_artists`, `seed_artist_totals`, `label_artist_pairs`, `seed_labels`, `roles_seen`, `ingest_runs`. Measure role coverage against the ingest database, not the web copy. `label_artist_pairs` is the biggest table in there and `derive` needs it, so `seed-labels --drop-pairs` costs a full pass 1 to undo: derive throws rather than grading every label `none` in silence.

**Derived, what the app reads:**

- `artist_collaborators` (5.1M rows) — per artist, co-credited people ranked by shared-release count, with roles held
- `artist_labels` / `label_roster` (1.37M rows each) — the same edge from both ends, with counts and date ranges
- `artist_coverage` (one row per artist) — release and credited-release counts, collaborator and label counts, year span, seed releases and share, and the three grading columns below
- `corpus_artists` — seed membership and channel A/B provenance
- `label_coverage` (one row per label) — the label grade, with the counts behind it
- `artist_search` / `label_search` — FTS5

Coverage flags must distinguish "no credits recorded" from "worked solo". That distinction is load-bearing in the UI.

**Three columns carry the grade, and they are not interchangeable:**

- `scene_relevance` — the measurement. `very high` / `high` / `medium` / `low` graded on seed release count AND seed share of whole output, since either alone misranks; `none` for artists with no seed work.
- `lineage` — a tradition the scene came out of, keeps company with, or handed its inheritance on to, or NULL. Seven of them, below.
- `relevance` — **what the interface shows**: `scene_relevance` raised to the tradition's floor when a lineage applies. One scale, one column, so a result reads the same in search as on its page. As built: 8,398 very high, 9,431 high, 47,886 medium, 70,629 low, 284,231 none.

**The top step is `very high`, and it was added on 2026-08-25.** Before it the scale had four steps and the top one ran from Jeff Mills at 15.4% to Fluxion at 97.9%, putting one word on 16,985 artists: Basic Channel at 79.2% read exactly as an artist with a fifth of their output in the cluster. `very high` is 5+ seed releases at 50%, which says something a reader can check, most of what this artist did is in the cluster, and it lands where the canon does: Fluxion 97.9%, Rhythm & Sound 93.8%, DeepChord 88.5%, Deadbeat 80.1%, Basic Channel 79.2%, Maurizio 76.4%, Monolake 66.7%, Vainqueur 64.1%, Porter Ricks 62.3%, Rod Modell 54.8%. Below it sit the people who did this and also did other things: Vladislav Delay 48.5%, Mark Ernestus 46.8%, Moritz von Oswald 38.4%, Pole 37.3%, Wolfgang Voigt 29.2%. It **was** the same number the label rule cut at, and the two sides of the site read alike because of it. That stopped being true on 2026-08-30, when the label rule gained a second gate at a third of a large roster: an artist still reaches the top step only on more than half their output, a label can now reach it on 35% of a roster of twenty or more. The artist dial did not move and should not. What changed is that the sentence "the top step means more than half" is now true of artists and no longer true of labels, which is the cost recorded under the seed label rule above.

**`high` now reaches down, and that reverses a call this file used to make.** Its share bar did not move, but it gained a volume route, 20+ seed releases at 5%, which promotes 844 artists. This file used to pin Aphex Twin at 10.6% and The Clash at 8.8% as medium, on the argument that both belong in the corpus and neither is the scene. That argument was written when `high` was the top step and therefore meant "this is the scene". It is now second of five, so it means "deep in the cluster, among other things", which is what a 114-record run through these styles is. **The 5-release floor did not move and must not**, because it is what the promotion pressure is really aimed at: 31,809 artists have 2 to 4 seed releases at 15% or better and 6,546 of those are at 100% off two records out of two. They are 69% of medium, and the only way to reach them is to let a one-off read as devotion.

**Medium's bar is untouched, deliberately.** Every lineage floor sits on it, so moving it would move King Tubby and Fela Kuti under a change that is about the top of the scale. `lineage.liftsFrom` needed no edit for the same reason: a floor lists the grades below it, and the fifth step went in above them all.

**A label is graded on the same five steps, and it took until 2026-08-14.** `label_coverage.relevance`, dialled in `labelRelevance`. Before it a label was High or Low and nothing else, which put Ndagga (Mark Ernestus' own Senegalese imprint, 43%) in the same bucket as Columbia (0.8%) and cut Tectonic off at 49% by a point. `very high` IS the seed-label rule, both gates of it, so what the corpus calls a scene label and what a page calls the top step are one decision, and `check-corpus` asserts the two counts match by name. `high` is 2+ seed artists at 35%. It used to be where the labels sat that the seed dial cut off by a point or two, and the second gate has since claimed the larger of them: Tectonic 49% and Hyperdub 46% are now `very high`, and what `high` holds is the same band on a roster too small for that gate, Ndagga 43%, Metroplex 40%, Honest Jon's 39%. `medium` is 2+ at 25%, holding the band from Warp at 31% down, still an order of magnitude clear of every major (Virgin at 7.4% is the closest). As built: 18,999 very high, 4,453 high, 5,560 medium, 51,748 low, 33,466 none.

**And it is NOT measured on the roster the label page lists.** The grade counts every act on the artist line across the whole dump, from `label_artist_pairs`. The roster tab lists corpus artists including engineers, and both differences push one way: measured on it EMI comes out at 32% against Tresor's 45%, which is the separation gone. So the page shows one set and grades another, and the wording has to say so. Ndagga lists nine names and is graded on seven. The reason line reads `43% of everyone it released is in the dub techno cluster`, never "of roster". The floor of 2 applies to `medium` as well as `high`, because 26,393 labels are a single seed artist at 100%, nearly all one act releasing one record: a ratio needs two names behind it. The cost is that a one-artist imprint like Purpose Maker reads low, and the imprint clause alongside it is what explains that.

Never show `relevance` as a bare word where there is room to say what it stands on. Two different things put an artist on a step, and a page that says "medium" without saying which is claiming cluster work that may not exist. The artist page pattern: `Medium, very weak ties with the core dub techno cluster, here because linked to roots dub, the Jamaican sound dub techno grew out of`. The search results column is the one place the word stands alone, and that is a known cost of merging, not a licence to do it elsewhere.

**Scene and cluster are not synonyms in the interface.** The *scene* is the whole extended map this tool draws, neighbours included: it is what the home page means by "Dig the Extended Scene". The *cluster* is the dub techno core it was drawn from, which is what the seed measures and therefore what every tie is measured against. A grade reads "ties with the core dub techno cluster" and a label reads "% of everyone it released is in the dub techno cluster", while the About panel and the headline keep saying scene. Prose in this file still says "the scene" for the general idea; the rule is about strings a visitor reads.

**Two numbers on an artist are close enough to confuse and are not the same thing.** The grade comes from pass 1's tally, which counts APPEARANCES across the whole dump (someone on the artist line who also engineered the record counts twice) and only exists for artists who cleared the seed ratio. What a page displays is recomputed in `derive` as DISTINCT releases, for everyone. Pass 1 has Jeff Mills at 160 where the corpus holds 116. Do not quietly reconcile them by regrading on the displayed figure: that moves every dial under the acts they were pinned to, and it is a decision to take deliberately.

Ranking by frequency is central: collaborators and labels are ordered by count, never alphabetically. Frequency is the signal.

**Search ranks on scene work, and the grade discounts rather than gates. Fixed 2026-08-30.** Sorting on `relevance` first was a bug for the reason the label floor of 2 already warns about: a grade is a ratio, and a ratio needs work behind it before it describes anything. Label `very high` needs only two seed artists, so a one-record imprint with a perfect ratio beat the name the scene is built on. A Ghostly Ghost Productions (1 release) sat above Ghostly International (508), Simon Shackleton Music (2) above Shackleton (118), basic_sounds above Basic Channel, PAN at position 21, and `moritz` never reached Moritz von Oswald at all because four smaller Moritzes graded a step higher. The failures clustered on exactly the names this tool exists to serve, which is how it stayed invisible: Kompakt, Tresor and Chain Reaction ranked correctly throughout.

What it ranks on now is **releases the cluster explains, halved for each step down the grade**. For an artist that figure is `seed_releases`; for a label it is the release count times the roster share, which is the one unit the two can be compared in. Volume alone overcorrects, which is why the grade stays in: Moritz Illner has 30 seed releases of 184 and must not sit above the Moritz von Oswald Trio's 28 of 33. Halving per step is deliberately one rule rather than five hand-set weights, and it says a step of the scale is worth a doubling of the work.

**Typing a name exactly is worth one step, and no more.** Name matching gates exactly as badly as the grade did: ranked first, it hands `basic` to five unrelated acts called "Basic (2)" and `moritz` to "Moritz (15)". Worth a step, it lifts PAN over Pandit G and moves nothing else across 25 queries. Discogs' "(3)" disambiguator is stripped first, since it is how the database tells five labels called Pan apart and not part of the name anyone types.

**The pool is wider than the page**, 200 per kind. The SQL used to order by one thing and the page by another, so a row cut in SQL could never be ranked, which is the other half of why PAN came 21st. The width is free; what a query costs is the FTS scan and costing every match for the figure it sorts on.

**The order and the relevance column now visibly disagree, and that is accepted.** Moritz von Oswald reads `high` above a Trio reading `very high`. A grade is a grade, not a rank: it answers how close to the scene, while the order answers how much of the scene this name accounts for. The releases column carries the visible reason, 510 against 33. Simone took this deliberately on 2026-08-30 over showing the sorted figure as its own column, which would have put a fifth column on a list already carrying four. So the caveat on the dropdown below is now literally true of the results page too, and is a known cost rather than a licence: **do not add a second sort key that the page cannot show.**

## Lineage — the editorial rules

Everything else in this corpus is derived. These are judgements, written down rather than hidden in a dial.

**The problem.** The seed measures work inside dub techno. By that measure King Tubby scores what the Spice Girls score, because `Dub` is only a seed style on genre `Electronic` and his catalogue is Dub on genre `Reggae`: 206 of his 221 corpus releases are invisible to the seed by construction. Underground Resistance scores the same, because `Techno` was kept out of the seed for being too broad. Defensible as graph output, wrong as an answer a digger would accept.

**No measure of the scene fixes it, and that was proved before reaching for a rule.** Bob Marley has 123 seed releases to King Tubby's 15, Madonna 106, Depeche Mode 75. On connection strength Madonna has 63 ties into the seed and Mozart 75, against Tubby's 57. Every threshold that lifts Tubby lifts Madonna higher. "Ancestor of" is a historical fact and style co-occurrence cannot express it, so it is asserted instead.

**The seven traditions**, dialled in `ingest/src/config.ts` and asserted by `check-corpus` in both directions. Two mechanisms: `byTag`, what an artist records (one or more styles, a genre, or styles gated by a genre), and `byLabel`, where they released it (a curated list of label IDs).

| | mechanism | dials | floor | tagged / lifted |
|---|---|---|---|---|
| `roots dub` | style `Dub` on genre `Reggae` | 5+, 20% | medium | 3,896 / 1,560 |
| `reggae` | genre `Reggae`, any style | 5+, 20% | **low** | 3,218 / 1,846 |
| `dubstep and uk garage` | styles `Dubstep`, `UK Garage` | 5+, 20% | medium | 1,190 / 591 |
| `detroit techno` | ten Detroit imprints, by label ID | 3+, 10% | medium | 255 / 192 |
| `afrobeat` | style `Afrobeat` | 5+, 20% | medium | 209 / 132 |
| `uk jazz` | Brownswood and eight neighbouring rooms | 2+, 10% | medium | 182 / 136 |
| `acid jazz and DNB` | Talkin' Loud | 3+, 10% | **low** | 88 / 60 |

**The dub line runs three deep, and the floors say so.** Dub techno came out of dub, dub came out of reggae. So `roots dub` lifts to medium, `reggae` lifts one step to low, and a pop record lifts not at all: King Tubby medium, Toots & The Maytals low, Spice Girls very low. `reggae` runs last in `byTag` so anything more specific claims the artist first, which is why a Jamaican dub engineer reads `roots dub` rather than `reggae`.

**Rules about the rules:**
- **A tradition lifts to its floor and no further.** It cannot promote someone past the floor and cannot demote someone already above it. `scene_relevance` keeps the measurement, so the page never implies cluster work that is not in the data. Which grades a floor may raise is `lineage.liftsFrom`.
- **One tag per artist, tags before labels, then array order, first match wins.** A Jamaican player who also cut for Metroplex reads `roots dub`. Gilles Peterson reads `uk jazz` rather than `acid jazz and DNB`, which is why that pair is ordered the way it is. `dubstep and uk garage` sits after the dub line and before `reggae`, so 83 Jamaican engineers with dubstep remixes keep `roots dub` while DJ Madd, Von D and Kahn stop reading as the catch-all: it re-claimed 56 artists from `reggae` and 11 from `uk jazz`, Mala among them, who had it off Mala In Cuba on Brownswood.
- **They are not the same claim, and the interface must not flatten them.** The dub line is descent, one step each ("the Jamaican sound dub techno grew out of", "the sound dub itself came out of"). Detroit is the ground rather than a parent ("the sound that scaffolds everything"). Afrobeat and uk jazz are kinship ("a sound this scene often borrows from", "the scene around Gilles Peterson and Brownswood"). Acid jazz and DNB is inheritance at one remove, which is why it is the one tradition that lifts a single step. Dubstep and uk garage is the only one pointing forward, so it can say neither "grew out of" nor "came out of": it reads "the UK sound that emanated from dub the generation after". Keep those wordings distinct. The strings say "sound" where the concept is a tradition, which is Simone's wording and deliberate: the row already says lineage, and a digger reads a sound.
- **`dubstep and uk garage` runs downstream, and it is the same failure as King Tubby seen from the other end.** Added 2026-08-14. Pinch, Shackleton, Peverelist and Mala already read high on measured scene work, while Burial and Kode9 read low and Skream, Loefah, Silkie, Commodo and Kromestar read nothing: one scene, and the half the seed can see is only the half that recorded in Berlin's styles. Separation is the cleanest of any rule here, Silkie 98.6% and Commodo 100% and Mala 92.3% and Burial 27.7% against a flat zero for Madonna, Depeche Mode, Spice Girls, Mozart, The Beatles and Basic Channel, 0.15% for Björk and 0.6% for Bob Marley. Two styles counted together because Discogs spells one scene two ways and neither name alone reaches the floor for several of them. It is the first `byTag` rule with more than one style, which is why the field is `styles`.
- **The floor for it is medium, not the low acid jazz gets, and the difference is the distance to dub.** Acid jazz inherits from Jamaica at one remove; dubstep is named for dub, built on sound-system weight, and Hyperdub says so on the sleeve. Kinship rather than descent, since it came after this scene rather than before it.
- **Skrillex is tagged and Horsepower Productions is missed, both accepted.** Skrillex on 7 of 19 releases the dump honestly tags `Dubstep` and `UK Garage`; the dials that drop him also drop Todd Edwards and MJ Cole. Horsepower on 4 of the 6 the corpus holds, one under the floor, the same shape as Shabaka Hutchings, and loosening to 3 releases takes the tag from 1,190 artists to 2,420 and starts catching Rihanna at 3 of 6. Neither is in a `check-corpus` list, so nothing pins the wrong outcome.
- **Afrobeat and uk jazz are Simone's editorial calls, recorded as such.** There is no documented line from Fela Kuti or from Brownswood to dub techno the way there is from King Tubby, and the counter-argument was on the table when he made both. What they express: this tool is a map of a scene's roots and neighbours, and it should hold the traditions the music keeps company with rather than rank them as footnotes. Don't quietly "correct" them, and don't cite them as precedent for a tradition with no argument behind it.
- **Tresor is deliberately not a Detroit label.** It is the Detroit-Berlin bridge and would tag several hundred Berlin artists as Detroit descent. The cost is Drexciya, whose corpus presence is 45 Tresor releases and nothing else, so they stay ungraded. A wrong tag on hundreds beats a right one on one.
- **Talkin' Loud is deliberately not `uk jazz`.** It is Gilles Peterson's own label, so it looked like part of that rule until the roster was read: Roni Size, Krust, DJ Die and Reprazent next to Galliano and Young Disciples. Calling Bristol drum and bass "uk jazz" would be wrong, and dropping it would lose a real thread, since both acid jazz and jungle carry a Jamaican inheritance of their own. Hence its own tag and the lower floor.
- **A genre-wide jazz rule was measured and rejected.** Genre `Jazz` at these dials tags 11,281 artists and lifts 4,360, headed by John Zorn, Peter Brötzmann, Evan Parker and two mastering engineers. They are here because Bill Laswell produced half of New York's avant-garde: a hub, not a heritage. Naming nine rooms instead is what made `uk jazz` honest. Sun Ra, John Zorn, Brötzmann and Parker are in the `check-corpus` must-not list to keep it that way.
- **`reggae` is read off the genre, not a style, and that is load-bearing.** 17 of Toots & The Maytals' 45 releases carry `Reggae` and no style at all, so a style rule cannot see them. It is the only genre-only rule and the reason `byStyle` was renamed `byTag`.
- **Shabaka Hutchings is a miss, not a rejection.** On 1 of 13, because the corpus holds his Impulse! and Verve records rather than his Brownswood ones. Loosening the dial to reach him would admit anyone with a single compilation credit. He is deliberately in neither `check-corpus` list, so nothing pins the wrong outcome.
- **Adding a tradition is an editorial decision, not a config tweak, and the bar rose when the axes merged.** A tradition no longer annotates a grade, it sets one, and the results column shows the word with no room for the reason. Argue it here first, with the numbers that separate it from the acts it must not catch. The full story is in the case study under "When the measure ran out".

## Credit roles — named at display time

In scope since 2026-08-08, and deliberately at one end only. Discogs role strings are uncontrolled, so a row that prints them prints the data entry rather than the work: Rhett Davies engineered for Eno sixteen ways across 335 records, and the row listed all sixteen.

**The split is the point.** Ingest stores the dump's string verbatim and keeps logging every distinct one in `roles_seen`, because that string is the record. The app names it. Nothing about this is baked into the SQLite file, so the vocabulary can change without a re-derive, and a wrong name is a code fix rather than a re-ingest.

**Where:** `web/src/lib/roles.ts`, one table of 61 entries, read by `creditLine()` in the pages. It does three things and they are separate: drops the bracketed qualifier (`Engineer [At Basing Street Studios]` is still engineering), collapses the variants Discogs spells differently, and states each role once.

**Rules:**
- **The table's order is the display order, and it is load-bearing.** What someone made comes before how it was cut, before what they played, before the sleeve and the office. A digger scanning a row reads left to right and should hit the substantive credit first.
- **There is no cap.** The collapsing is what shortens a row: on Eno's page, David Byrne's 101 stored credit strings across 258 shared releases come to 24 roles. Show all 24. A "+N more" was tried and removed, since a row that stops early is answering a question nobody asked.
- **An unrecognised role keeps its raw wording and sorts last.** Never dropped, never guessed at. That keeps a rare credit visible and keeps the gap in the table visible with it, which is the same honesty rule the rest of the interface runs on.
- **A merge is a claim, so only merge what means the same work.** Instruments group up (`Violin`/`Cello`/`Harp` into Strings) because a digger wants the section, not the chair. `Executive Producer` stays out of Production because it is a business credit, not a studio one. `Direct Metal Mastering By` is deliberately unmapped at 1,173 occurrences: it is neither mastering nor a lacquer cut, and a near-enough name would be wrong.
- **Measure after changing the table.** Coverage is **97.4% of 4,429,673 credit occurrences**, across 281,018 distinct role strings, of which 35,180 stay unnamed. Measure against `ingest/data/dubdigger.sqlite`, since `roles_seen` is not published.

## UI principles

These are load-bearing and hold regardless of how the interface looks:

- **Ranked lists over graphs.** Sorted by strength, lists answer "who matters here" on sight. No graph in v1.
- **One click to pivot.** Every artist and label is a link to its own page. Digging is hopping between pages, not composing a query.
- **The search box pivots too, and it is one click from any page.** The suggestion dropdown is the shortest version of the same move: type, arrow down, Enter, and you are on the page without the results list in between. Three rows: a dropdown is read at a glance while the hands are still on the keys, and past the third the ranking starts putting a name nobody typed under one they did. What does not fit belongs on the results page, one keystroke away and built for forty, and since 2026-09-03 a fourth row says so: "View all results", pointing at the same query on the results page. It is a real option in the listbox rather than a footer under it, so the arrows reach it, Enter follows it and the script costs nothing new. Three rows is still the rule, because the fourth is not a name. Its rows carry the grade in the same five words the results column uses, because a shortlist that ranked names and said nothing about them at all would be the ranking talking to itself. The grade is not what it sorts on, which is the cost recorded under the search ranking above. It orders them exactly as the results page orders the same names, since it is a shortcut into that page and not a second opinion about it, and since 2026-08-30 that is one shared pool and one shared ranking rather than two implementations agreeing by hand. A miss returns nothing and the dropdown stays shut, the way out included, since "view all" of nothing is the shortlist offering to show its own emptiness at greater length: the honest answer to a miss is the one the results page gives in full, that the corpus is a slice centred on dub techno and a legitimate absence is the boundary working, and Enter still goes there.
- **Except where there is no page, and then it is not a link.** Aliases, members and groups come from the dump with the related name inline, so the corpus can name someone it never admitted: 43% of member relations, 66% of aliases and 69% of "member of" point at ids with no page. `getRelations` returns `inCorpus` and `Chip` drops the href without it, keeping the chip and losing the hover. A link that pivots into a 404 is the interface claiming something it does not hold, which is the honesty rule in its most literal form. The Ndagga Rhythm Force is the case that found it: eight Senegalese players, all credited on kept releases, none admitted, because every record naming them credits 12 to 34 people and `channelAMaxPeopleToAdmit` is 8. That dial cannot tell a compilation from a large ensemble, and Ndagga missing the seed-label ratio at 43% closed channel B behind it.
- **Show data absence honestly.** "No credits recorded" must be visibly distinct from "worked solo." Never render an empty result that looks like a positive answer. The same honesty extends to connection strength: relevance grades and the collaborator/label-mate distinction exist so a peripheral artist looks peripheral. Never present a weak tie as a strong one. And it runs the other way too: a grade the corpus cannot measure must not be reported as a low score. That is what Lineage is for, and why a lifted grade always says it was lifted.
- **One question, one vocabulary.** Relevance reads in the same five steps wherever it appears, with the reason for the step alongside it in grey. A page that answers "how close to the scene" in words its own search results do not use is two scales sharing a heading.

### Density, and the design that delivers it

The original rule read "Density is a feature. Small type, tight rows, lots on screen," enforced as `--spacing: 0.2rem` and a shrunken text scale. Simone suspended it on 2026-08-06 to open the design question, and the design has since landed. It reaches the same goal by a different route, so the design is now the rule. The baseline it replaced is tagged `ui-baseline-v0`.

Everything below is set in `web/src/styles/globals.css` as tokens and four utilities. Read that file before adding a size, a grey, or a spacing value.

**The whole system is written out in `style-guide/`**, added 2026-08-16. Six HTML pages that open from disk (tokens, typography, colour, all seventeen components, the page patterns, the client behaviour), plus `style-guide/README.md`, which is the same material as flat lookup tables and is the cheaper read before an implementation. It is a mirror, not a source: it cannot run Tailwind, so its values are copied by hand and `globals.css` stays the truth. Nothing checks it, so a change here has to be carried there by hand.

- **Spacing is Tailwind's default scale.** There is no `--spacing` override and there should not be one. The vertical rhythm is deliberately open: page heads at `pt-16 pb-16 md:pt-24`, labelled bands at `py-14`, list rows at `py-[18px]`, identity rows at `py-2`. Do not tighten these to fit more in.
- **Density comes from the ink ramp and the mono, not from crushed spacing.** Four greys below `ink-strong` let one row carry a name, a count, a role string and a year without any of it shouting, and structural text sits at 0.6875–0.8125rem against a 1.25rem name. A page holds a lot because most of it is quiet, not because it is small.
- **The ramp has a floor, and it is a contrast floor.** `ink` `#f2f2f2` 18.10:1 · `ink-muted` `#9a9a9a` 7.20:1 · `ink-dim` `#8a8a8a` 5.87:1 · `ink-faint` `#7a7a7a` 4.72:1, all against `bg` `#060606`. The bottom two were `#787878` and `#6a6a6a`, and the latter came to 3.75:1, under the 4.5:1 that normal text has to clear while carrying every column heading, count, year and the whole footer. The three quiet greys are now 16 apart in hex, which is what makes them read as a ramp rather than as drift. **A new grey has to clear 4.5:1 or it is not a grey, it is a bug.**
- **Two families, split by job.** Helvetica Neue for names and headlines. IBM Plex Mono, uppercase and letterspaced, for everything structural: labels, counts, roles, meta, controls. The `mono-label` utility is that pattern written down, so use it rather than respelling it.

  **Helvetica Neue is only installed on Apple platforms, and until 2026-08-16 the stack just shrugged at that.** Windows fell to Arial and Android to Roboto, measured 6–7% narrower than the design on every string tested, at up to 104px. So `--font-sans` now leads with `DubDigger Sans`: a renamed subset of TeX Gyre Heros, a genuine Helvetica clone within 0.88% of Neue on width. 36.4 KB for two weights. Its one visible tell is that Heros clones Helvetica's bold, which is lighter than Neue's, so headlines sit a touch lighter than they did on a Mac.

  **It is served to everyone, including the Macs that have Helvetica Neue installed, and that is the point.** A `local()`-first face was built and shipped first, so Apple platforms kept Neue and paid nothing. It worked, and it was dropped the same day: it made the typeface a function of the visitor's OS, and the branch that mattered was the one Simone cannot see from his own machine. One typeface and one rendering path beats a stack that changes by OS, and the 36.4 KB now paid on Apple platforms buys the guarantee that what he sees is what everyone sees. **Do not reintroduce a `local()` source without arguing this again.** The trailing system names in the stack are a safety net for a failed download, not a second design.

  **The vertical metrics are overridden, and that is not cosmetic.** Heros ships an ascent of 114.8% against Neue's 95.2%, a line box a fifth too tall. `ascent-override`, `descent-override` and `line-gap-override` pin each weight to Neue's real values, read off the font files rather than off rounded browser metrics, so the layout still matches the design it was drawn against. Rebuild the subset with `web/scripts/subset-heros.py`; the reasoning and the licence are in `web/public/fonts/README.md`.
- **Display type is fluid, reading type is fixed.** `--text-hero`, `--text-name`, `--text-name-label` and `--text-stat` are clamps, because the handoff's pixel sizes are wider than a phone (a 104px "Moritz von Oswald" needs 900px of viewport). `--text-row`, `--text-lead` and `--text-body` are fixed. Add a new size only if the design has one.

  Prose reads at two of those, split by job rather than by page. `--text-lead` (1.1875rem) is the paragraph directly under a headline, a subheading doing a headline's work. `--text-body` (1.0625rem) is prose you settle into: a bio, the bands on the Info page. Both carry their line height on the token itself, so a paragraph asks for a size and gets the leading that belongs to it. Do not respell it with a `leading-*` class.
- **Hairlines, not borders.** `--color-hairline`, `--color-hairline-soft`, `--color-edge`, `--color-edge-strong`: separation without drawing a box. One accent, `#6fcabd`, doing two jobs, counted at ten places on 2026-08-16. **As type** it marks what a thing is: the eyebrow, the two headline stops, link hover, the top two grades in the results column (very high and high, two of five since 2026-08-25: three would be over half the scale, which is where a mark stops marking, and the three quiet greys take one step each below it), and the "nothing found" heading. That last one had to argue for itself: a search that found nothing is the only heading on the site that has to be read rather than counted past, and a results page has already dropped the headline, so it spends colour that just came free rather than adding a place. **As a ground, a border or a state** it marks what you are on or reaching for: the current nav cell and the skip link (`bg-accent text-bg`, 10.48:1 whichever way round), the hero field's border, the focus ring, chip hover, header field focus, the drawer's current row, `::selection`. The two categories are the test, and spending it outside them is exactly what stops it working: a new use is either a step in the near half of a scale or a thing being reached for, or it is dilution. `edge` is 1.86:1 and is decoration only; anything that is the boundary of a control wears `edge-strong` at 3.08:1.
- **The tab row says when it scrolls, and says it in CSS.** Where the tabs do not fit, a gradient and an arrow sit at the right edge, and `scroll-hint` fades them out over the last 40% of the travel on a scroll-driven timeline. It is the first piece of client behaviour that costs nothing from the script budget, which is the same argument the six scripts make from the other side: reach for a script only when the state is not knowable without one.
- **Which rows get one is arithmetic, not a breakpoint picked by eye.** The row is mono, so its width is exact: 9.62px a character at 13px and 0.14em of tracking, plus a 24px gap and the column's 48px of gutter. The widest artist row in the corpus computes to 481px and renders at 482. A row that fits 390, the narrowest viewport in scope, gets no hint at all, and the rest hide theirs at the first 40px step above their own width. **That is why the label page has none**: two tabs rather than three, 322px at the widest the corpus can produce, so an arrow there was pointing at nothing. The four steps are written out as whole class names because Tailwind reads the source and not the render.
- **`link-rule` marks anything that pivots**, at whatever size the type is. With one accent and no room to spend it, that hairline is how a link is told apart from the text beside it.
- **The content column is the `column` utility**: 1200px, 1.5rem of gutter, 3rem from 768px up. Bands span the full width, their contents stay in the column.
- **The shell is drawn once, in `Base.astro`.** Skip link, header, `<main id="content">`, footer. A page renders its own bands and nothing else. It used to render its own `<SiteHeader />` too, which is how the site ended up with no `<main>` on it anywhere.
- **The phone gets a drawer.** Below `md` the four nav cells stop fitting, so they stack behind three bars in a `<details>`: a sheet that slides over the dimmed page rather than a panel that pushes it down. Native disclosure, so it announces its own state, works with the keyboard, and comes back closed after a router swap without any code.

The reasoning behind the original rule still holds as an input: the user reads Discogs pages for fun and wants information per scroll. The grid and the ink ramp are what serve it now. If a change would genuinely improve information per scroll, argue it against the design, not against the deleted rule.

### Accessibility — WCAG 2.1 AA, and the footer says so

Audited and fixed on 2026-08-11. The footer carries the claim in public, which makes this a promise rather than an aspiration: **if a change would break one of these, it breaks the footer too.**

- **Every page has one `<main id="content">` and exactly one `<h1>`.** Both come from `Base.astro`. On the home page the `<h1>` is the headline, and when a query is present it is the result count instead, because that is what the page is then.
- **The skip link is the first thing in `<body>`**, `sr-only` until focused. It is the only way past the wordmark, the search field and the nav.
- **Text clears 4.5:1, control boundaries clear 3:1.** See the ramp above. This is the rule most likely to be broken by accident.
- **A column heading that folds under the name stays in the accessible tree.** `md:sr-only`, never `md:hidden`: `ListHeader` is a sibling element and cannot tell a screen reader which column it names, so a row read aloud at desktop width came out "Basic Channel, 47, high, artist".
- **The drawer wraps focus rather than hiding the page.** No `inert`, no `aria-hidden` on the background. The page showing through the scrim is the point of a sheet over a panel, and marking it inert would hide from a screen reader the thing the design is making a point of keeping in view. Focus cycles inside the `<details>` and returns to the summary on close.
- **The contact dialog does hide the page, and that is not a contradiction.** A sheet is a layer over something you can still see; a modal is the only thing on screen until it is dismissed. It is a native `<dialog>`, so the inertness, the focus trap, the Escape key and the focus return are the browser's rather than ours. Two overlays, two different claims, two different mechanisms.
- **Anything that discloses says so.** `aria-expanded` on the bio toggle, `aria-current` on nav cells, tabs and the sort control, `aria-label` on both `<nav>` elements ("Sections" and "Lists").
- **Every SVG is `aria-hidden`**, and anything that leaves the site says so in its accessible name.
- **Motion is guarded.** All three scripted animations check `prefers-reduced-motion` (drawer, collapsing bio, figures count-up), and so does the drawer's stylesheet.
- **`autofocus` appears twice, and they are different jobs.** On the page it is the hero field's, and only while it is empty: on a results page it jumped a reader past the answer. Inside the contact `<dialog>` it is on the dialog element itself, which is how a modal chooses where focus starts — it fires on open rather than on load, so it takes nothing from the page. It has to be set, because the default is the first focusable descendant: that put focus on the close button, which a touch browser then rings with the accent as though closing were the offer.

## Stack

- Astro + TypeScript, `output: "server"` so every request reads the file on disk
- SQLite as a read-only file (no DB server), via better-sqlite3, kept external to the bundle as a native module
- Tailwind v4, configured as tokens in `globals.css`
- Ingest: standalone Node/TypeScript scripts using a streaming XML parser
- `compressHTML: false`, deliberately: indented HTML costs under 250 bytes over the wire once gzipped, and this is a tool whose audience reads pages for fun
- Deploy: a single small VPS running the Node server alongside the SQLite file

**There is no UI framework, and adding one needs an argument.** Every page is `.astro`. React was here for a week and bought a hamburger menu and a counter for 184 KB, which is the whole case against it. Client behaviour is a `<script>` tag in the component that needs it, driving the DOM through `data-` attributes.

**The client JavaScript budget, measured:**

| | bytes | where |
|---|---|---|
| `ClientRouter` | 16,075 | every page |
| drawer | 1,064 | every page |
| contact dialog | 961 | every page |
| scroll hold and active tab | 662 | every page |
| search suggestions | 1,641 | every page |
| collapsing bio | 1,035 | artist and label |
| figures count-up | 644 | home |

Heaviest page is an artist or label at **21,438 bytes**, measured 2026-08-31. The router is 76% of it and is deliberate: the premise is that a pivot costs one click, so the document is swapped rather than reloaded. The six inline scripts are the whole of the rest, and a seventh needs the same argument those six made.

**The suggestion dropdown is the sixth, added 2026-08-26, and it made the argument two ways.** What someone is typing is not knowable on the server, which is the same test the collapsing bio passed. But most of what a dropdown does IS knowable there, so it is done there: `/suggest` is an Astro partial that returns the rows as markup, and the script fetches them, assigns them, and moves a highlight. No JSON, no templates in the browser, no list of hits held in memory. That is why it costs 1,641 bytes and not the several thousand a client-side renderer would, and why a change to how a row looks is an edit to an `.astro` file like every other row on the site.

The field stays a plain GET form underneath, so with no JavaScript nothing about it changes. `SUGGEST_MIN_CHARS` is 2, set on the form as a `data-` attribute so the guard in the browser and the guard in the query are one constant: a single letter matches 49,018 artists and costs 300 ms to rank against 65 ms for two. The answers are cached for five minutes and per keystroke in the page, which they can be because the database is a static file.

**It is a combobox, and that is the whole of the accessibility work.** ARIA 1.2: focus never leaves the input, `aria-expanded` says whether the list is open, `aria-activedescendant` names the row the arrows are on, and only that row carries an id — given on highlight and taken back on leaving, because the header and the drawer both render the field and an id has to be unique in a document. The first Escape closes the list and keeps the query; the second lets the browser empty the field, which is what the pattern asks for and what a `type="search"` input does on its own. Without the `preventDefault` on the first, Chrome does both at once and throws the query away on the way to the full results.

**The contact dialog is what that argument looks like.** A dialog cannot come from the server, so the only question was how much code it costs, and the answer was to let the browser do it: a native `<dialog>` opened with `showModal()` already traps focus, closes on Escape, makes the rest of the document inert, returns focus to whatever opened it, and paints a `::backdrop`. What is left to write is opening it, closing on a backdrop click, and the clipboard, which is why it is smaller than the drawer despite doing more. Every opener is a real `mailto:` link that the script intercepts, so with no JavaScript a click still reaches the address.

**Prefer the server, then a link, then a script.** Tabs, pagination and search are links and a plain GET form carrying state in the URL. That is what keeps a 556-row roster from being serialised into the page as JSON, and what makes every view a real address. Only reach for a script when the answer genuinely is not knowable on the server: the collapsing bio qualifies, because whether the text overflows depends on the rendered line count at this viewport; the scroll hold qualifies, because where the reader was is not something a server response can carry; the count-up qualifies, because whether the band has been scrolled to is not either; the suggestion dropdown qualifies, because a keystroke has not been submitted yet. A fragment was tried for the scroll hold first and could only say "put the tab bar at the top", which still moves the page. It is one script in the layout, keyed on `data-hold-scroll`, serving the tab bar, the sort control and "Load more": the same script three times would cost the budget three times.

**That script holds both axes, and the second one was missed until 2026-08-31.** A swapped document arrives with its tab row scrolled to the start, so on a phone, where the three tabs do not fit, tapping Releases answered the question and hid the answer: the row snapped back to Labels with the active tab off the right edge and nothing marked in the viewport. A scroll offset is the one piece of state markup cannot express, which is what keeps this in a script; it is bytes on the hold script rather than a seventh one because it is the same promise, that a swap leaves the reader looking at what they asked for. It runs at parse time as well as on `astro:after-swap`, so a tab opened cold from a shared URL is placed too, and it nudges the scroll hint's own width past what it strictly needs, read off the hint rather than written down a second time, so an active tab landing at the right edge is not left under the gradient.

**Scripts must survive a `ClientRouter` navigation.** A module `<script>` executes once, so bind work to `astro:page-load`, which fires on the first load and again after every swap. A script that only runs at parse time will silently stop working on the second page a visitor opens. The exception is a listener bound to `document` itself, which the swap does not replace: that is why the scroll hold needs no rebinding.

## Licensing note

Discogs **dump data is CC0**: free to use, including commercially, no attribution required. This is why we ingest dumps, not the API. **Images are NOT CC0** (they're "Restricted Data", not in the dumps, and carry caching and commercial limits), which is one reason v1 has no images. Do not introduce Discogs API calls or images without revisiting licensing.

The repo itself is source-available, not open source: PolyForm Noncommercial 1.0.0 for the code (`LICENSE`), CC BY-NC-ND 4.0 for the docs and the case study (`LICENSE-DOCS`).

## Deferred: images (v1.1)

Genuinely wanted for the product: visual reference matters for digging, and record covers are how diggers recognise things. Deliberately deferred rather than dropped, because it breaks the core v1 architectural property, that the server reads one precomputed static file and nothing else. Adding images means choosing one of two paths, neither free:

- **Cache at ingest time** violates Discogs' terms directly (no storing Restricted Data beyond serving-time need, max 6 hours stale). Would need real re-architecture of the serving layer, not just a new column.
- **Fetch live from the API at display time** is legally cleaner, but introduces a live external dependency, new failure modes, mandatory attribution notices, and is the natural entry point for scope creep ("while we're calling the API for images, let's also pull fresh bios...").

**The cheap middle ground is already shipped:** `OutboundLinks` puts a "View on Discogs" row on every artist and label page, plus whatever sites the entity itself lists. Zero licensing exposure, zero architecture change. It is NOT the same as inline images, so don't treat it as "images are done."

When v1.1 is actually undertaken, decide consciously between the two paths above and update this section with the choice and its reasoning.

**The rule is about Discogs imagery, and one image is not.** `public/og.jpg` is the card a shared link renders: 1200×630 of the site's own design, drawn from the tokens, holding no Discogs data and no photograph of anything. Its source is `web/scripts/og.html`, rendered by headless Chrome and converted with ImageMagick, with the commands in a comment at the top of that file, so the card is edited as markup rather than redrawn by hand. Simone admitted it on 2026-08-11 with the conflict on the table. It changes nothing architecturally, since it is a static file served like the stylesheet, and it is not a precedent for inline images: the thing "no images in v1" protects is the licence and the one-file server, and neither is touched here.

## Discoverability

Set up on 2026-08-11. The metadata itself is ordinary; several decisions in it are not, and each is a load decision before it is an indexing one.

- **The origin is asserted once**, as `site` in `astro.config.mjs`, and read as `Astro.site` everywhere. A request cannot work it out: a proxy rewrites the host, and http/https is invisible from inside the process.
- **Canonicals drop the query string, deliberately.** Every list carries its state in the URL (`?tab=`, `?sort=`, `?show=`, `?q=`), which is what makes each view a real address and also what gives one page unbounded addresses. The tabs are the same page answering the same question, so the canonical says so and `robots.txt` disallows `/*?` rather than letting a crawler walk the combinations to find out.
- **A description is a request, not an instruction, and the home page had not made one.** Every other page passes its own; the home page fell back to the layout's default, which opened with the headline verbatim. That is the case where Google discards the tag and writes a snippet from the page's prose instead, and there was none to write from: `<main>` holds 25 words and not one full sentence, an eyebrow, a headline, a field and three figures. The footer was the only prose in the document, so Google published the footer as the home page's snippet, wordmark and MMXXVI and handcrafted in London. Fixed three ways on 2026-08-26. The home page states its own description, and since 2026-08-28 it is one clause: `A map of the dub techno scene and its neighbours, built from Discogs credit data.` For two days it opened with the move instead (`Type an artist, see who they worked with...`), which is an instruction aimed at somebody who has not yet decided whether to click. The layout's default no longer repeats the headline. And the footer carries `data-nosnippet`, which is right on every page rather than only that one, since those five sentences are identical across 534,527 of them. It sits on the inner `div` rather than the `<footer>` because Google names `span`, `div` and `section` as the elements it reads the attribute on, and a sectioning element it does not name is not the place to find out. Snippet suppression only: the text is still indexed and the links are still followed.
- **No prose was added to the hero, and that is still the decision.** A paragraph in `<main>` was the durable fix, since it gives an engine something better than the description to fall back on, and it shipped on 2026-08-29 as the band below. What was ruled out is the hero: a visible change to the one page whose spareness is the design. Simone chose the description as the whole of the answer on 2026-08-26 and did not reopen that half when he took the band. Do not quietly add an intro paragraph above the figures for SEO reasons: that argument has been had, and the prose it wanted is already on the page further down.
- **The AI Overview cited `/info` rather than the home page, and it was the same absence one layer up.** Noticed 2026-08-27, fixed 2026-08-29. An Overview grounds its answer in retrieved passages and cites the URL each passage came from, and it quotes rendered body text: a description is a request an engine can honour for a result card and is never a candidate for a passage, and neither is the JSON-LD. So the fix that solved the snippet could not reach this one. `/info` won because it opens `Dub Digger is a tool for digging`, a definition starting with the name, which is the shape retrieved for a branded question. The home page was not losing that comparison, it was never a candidate. **What ships is a `LabelledBand` labelled "What this is" after the figures, hidden when `searching`**, so the first screen is untouched and no `?q=` address carries it. Position on the page is not what makes a passage retrievable; being real body text in `<main>` is. **Its wording is deliberately not `/info`'s lead**, because two URLs offering one identical passage makes them compete and `/info` has four bands of depth behind the same claim. Its top gap matches the one above the figures (`mt-16 md:mt-30`, the hero's `pb-10 md:pb-24` plus `pt-6`), so the two hairlines share a rhythm. It makes `/` eligible, not guaranteed. Weakening `/info` to help `/` win was considered and rejected: that trades a good page for a citation.
- **The sitemap lists the core, not the corpus.** 1,808 URLs: five static pages plus the top 1,000 artists and 803 labels the Core pages already rank, generated per request in `web/src/pages/sitemap.xml.ts` because `/artist/[id]` has no static paths to enumerate. The other half million pages stay reachable by link. Nothing invites a bot to walk 534,527 SQLite queries on a one-core VPS: this is discovery, not exhaustiveness.
- **`lastmod` is the database's mtime, for every URL.** Every page is derived from that one file, so it is the honest answer for all of them. Nothing in the corpus records when a credit was entered, and a date that moves when it should not teaches an engine to distrust the file.
- **The JSON-LD graph credits the tool, never the data.** A `WebSite` node and a per-page node, cross-referenced by `@id`, plus `BreadcrumbList` on inner pages. `creator` is a `Person` on the `WebSite` and appears nowhere else, because the split is the whole claim: the tool is Simone's, the credits are typed in by Discogs contributors. An `author` on a page node would take thousands of people's work and put one name on it, so there is deliberately none. There is no `Organization` and no `publisher` either, since there is no company and inventing one to fill a recommended field would assert something the pages do not. The footer states the same split in words, and the markup is only that sentence again. The one soft claim is `MusicGroup` on artist pages, which is wrong for the engineers and sleeve designers who hold Discogs artist ids, and is still the least wrong type available.
- **IndexNow is a manual step after deploy**, `npm run indexnow --workspace web`. It reads the URL list off the deployed sitemap, so it cannot ping ahead of the upload that proves ownership.

## Working style

- Build one plan-step at a time; commit after each.
- When something looks like it needs an out-of-scope feature, stop and say so rather than pulling it in.
- Prefer boring, legible solutions over clever ones. This is a tool to be maintained by one person.
- Comments in this codebase carry the reasoning, not the mechanics. When you change a decision, change the comment that argued for the old one.
- **A ranking change is argued with a before/after table, never picked from the armchair.** Build a throwaway harness that runs the candidate sorts over the same query list against the real published file, and read the rows. That is what showed, on 2026-08-30, that ranking exact name matches first fixes `pan` and simultaneously hands `basic` to five unrelated acts called "Basic (2)" — the very failure the change was meant to cure, one layer along. **The shape of that bug is the lesson: a hard gate on a cheap signal.** The grade gated first and buried Moritz von Oswald; name matching gated first and buried Basic Channel. Both work as a discount and neither works as a gate. Suspect it whenever a sort key is a ratio, a flag, or a string match.
- **Judge a long job by its worker process, not the wrapper.** `npm run x` leaves a shell and an npm process whose CPU sits at 0.0 while the real work happens in a grandchild. Reading the wrapper on 2026-08-30 turned a healthy pass 2 into a false "it is stuck" alarm. Find the child (`ps -eo pid,ppid,%cpu`, or `top`), and confirm progress from the artifact rather than the log: a second read-only SQLite connection can count committed rows while the writer is still going.
- **`astro dev` can leave a pidfile pointing at a PID the OS has since recycled**, and `web/.astro/dev.json` then blocks a new server while `astro dev status` reports one running. On 2026-08-30 that stale PID belonged to `mlhostd`. **Do not run `astro dev stop`**, which would signal whatever now owns the number; delete `web/.astro/dev.json` and start again. And run every workspace command from the repo root, since `npm run dev --workspace web` fails from inside `web/`.
- **A phone layout cannot be checked in headless Chrome, and it will not tell you so.** `--window-size=390` renders at 500 and crops the screenshot to 390, because 500 is the viewport floor. Measured 2026-08-28: 320, 390 and 450 all report `innerWidth=500`, and 600 reports 600. Anything laid out toward the right edge is silently cut off, which is how a missing count column on the artist page looked like a bug and was not. The tell is content at the left gutter sitting at the same x in both shots, because it is one render. 500px is the narrowest it can verify; below that, use real device emulation through the DevTools protocol or the actual iPhone, which is 390.
