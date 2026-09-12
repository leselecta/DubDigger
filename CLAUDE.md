# CLAUDE.md

Project brief and working rules for this repository. Read this before generating code.

Every number in this file was measured against the corpus built from the 20260801 dump. When a number here disagrees with the code, the code is the truth and this file is the bug: say so, then fix whichever is actually wrong.

## What this is

A crate-digging tool built on Discogs credit data. The core loop: **type an artist, see who they worked with and what labels they released on, then click any of those to keep digging.** A map of the extended scene, drawn from credits.

The user is a music nerd who reads Discogs pages for fun, not a casual listener. Design for information density and fast pivoting, not for a gentle onboarding.

**For the full design rationale, why ranked lists beat a graph, the competitive research that led there, and the Gall's Law scoping reasoning, see `case-study-credit-graph.md`.** It sits in the working copy but is not committed, so it is on Simone's machine and not in a clone: every later mention of "the case study" means that file. This file states the resulting rules; the case study explains why they're the right rules. When a decision isn't covered by a rule below, reason from the case study's logic rather than defaulting to a generic pattern, and say so if the file is not to hand.

## Where it stands

**This is `main`, and it is the only copy.** The `v2` worktree was merged (`f0af8db`) and torn down on 2026-09-11, so the side-by-side arrangement is gone and with it the second dev port: `npm run dev` serves on 4321 again. A fix and a feature are now made and deployed from the same place.

**The published database is 1.3 GB since `enrich` ran on 2026-09-07**, against the 932 MB the file was before. The extra is 7,975,876 tracks and 1,127,193 formats, 295 MB between the two tables, which is what the release page prints. **It must never be a symlink to the live file**, which is the one arrangement that lets `publish` write through onto production. Rebuilding it is `enrich --full` then `publish`, against the 20260801 dump in `ingest/data/dumps`.

Beta, and the footer says so. The corpus is built, the app is written, and the VPS has served it at dubdigger.com since 2026-08-12. What ships today:

| | |
|---|---|
| Corpus | 1,095,302 releases · 444,723 artists · 114,226 labels · 4,110,875 credits |
| Seed | 132,571 artists · 18,999 labels |
| Pages | home and search, artist, label, release, Core Artists, Core Labels, Info, 404 |
| Ingest database | 5.0 GB, `ingest/data/dubdigger.sqlite` |
| Published database | 1.3 GB, `web/data/dubdigger.sqlite` |

## Scope — hold this line

Deliberately small, per Gall's Law: a working simple system first. The list below was written for v1 and every line of it still holds on this branch, except the entity count, which was raised on purpose and is marked as such.

- **One data source:** Discogs monthly XML dumps (CC0 licensed). No live API, and the release page did not get one either: that argument is recorded where it was made.
- **Three entities:** Artist, Label and Release. It was two until the release page shipped, and that line was edited rather than quietly outgrown: a release is the object a collaboration is actually made of, and it was the one thing in the corpus with nowhere to live. **Tracks are still NOT an entity** and nothing about this changes that; they are not parsed at all.
- **Edges:** collaboration (two artists co-credited on a release) and label (a release's label). Tracks surface *through* collaborations and labels, and now through the record itself.
- **Corpus:** a dub-techno-centred slice, selected by the two-pass, two-channel strategy below, NOT the whole Discogs catalogue.

### Explicitly OUT of scope for v1 — do not add these unprompted
- MusicBrainz integration / dual-source model
- Alias and project resolution beyond what Discogs already provides. What the dump gives directly is in and shipping: `artist_relations` carries aliases, members and groups, and the artist page shows them as "Also known as", "Members" and "Member of". Inferring a link Discogs does not state is the part that stays out.
- Graph / force-directed visualisation in v1 (potential v2, see "Future considerations: Graph view" in the case study)
- Images of any kind in v1 (see licensing note below). **Named as v1.1, not a same-week addition.**
- NTS or any second data source
- `<companies>` as entities: distributors, record shops, pressing plants, studios. Discarded at parse time, so Hard Wax, EFA and every mastering room have no page by construction rather than by a threshold. Parked on 2026-09-01 with the four constraints that any design has to satisfy, in `V3.md` (which was `V2.md` until v2 was re-scoped to the release page alone on 2026-09-09). Read that before re-investigating: the short version is that grading such an entity on the label scale opens channel B on a warehouse.

Each is a later evolution of a working core. If a task seems to need one, stop and flag it rather than building it.

## Architecture — the key boundary

**All heavy work happens offline, on the developer's machine. The server only ever reads a small precomputed SQLite file.**

- **Ingest** (offline, run rarely): stream-parse the Discogs dumps, select the corpus, project to a thin field set, write raw SQLite tables, then precompute aggregations into query-ready derived tables.
- **App** (online, trivial): an Astro app that reads the derived SQLite file read-only. No database server, no Redis, no search cluster.

Keep ingest scripts entirely separate from the web app. The app must never parse a dump or hit the Discogs API.

npm workspaces, `ingest` and `web`. The ingest commands, in the order they run:

```
fetch-dumps  make-sample  pass1  measure-seed  seed-labels
pass2  entities  derive  enrich  check-corpus  publish
```

`enrich` is the odd one and is deliberately outside the selection. It reads the
dump once more to backfill what the release page prints (the date as written,
the country, the carrier, the tracklist) onto releases the corpus already holds.
It inserts no release, touches no style and never writes `year`, so running it
cannot move the corpus boundary under a change that is about what a page shows.

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

**Raw:** `releases`, `release_artists`, `release_credits`, `release_labels`, `release_formats`, `release_tracks`, `release_styles`, `release_genres`, `artists`, `labels`, `artist_relations`.

`releases.released` and `releases.country`, and both of the tables above them, are written by `enrich` rather than by a pass. `released` is the date as the dump wrote it and `year` is still what everything is graded on: on the sample 98.5% of records carry a date and only 31% of those are a full one, so a bare year is the common case and nothing pads it into a day.

**Ingest bookkeeping, not published:** `seed_artists`, `seed_artist_totals`, `label_artist_pairs`, `seed_labels`, `roles_seen`, `ingest_runs`. Measure role coverage against the ingest database, not the web copy. `label_artist_pairs` is the biggest table in there and `derive` needs it, so `seed-labels --drop-pairs` costs a full pass 1 to undo: derive throws rather than grading every label `none` in silence.

**Derived, what the app reads:**

- `artist_collaborators` (5.1M rows) — per artist, co-credited people ranked by shared-release count, with roles held
- `artist_labels` / `label_roster` (1.37M rows each) — the same edge from both ends, with counts and date ranges
- `artist_coverage` (one row per artist) — release and credited-release counts, collaborator and label counts, year span, seed releases and share, and the three grading columns below
- `corpus_artists` — seed membership and channel A/B provenance
- `label_coverage` (one row per label) — the label grade, with the counts behind it
- `release_rank` (one row per release) — what a record is worth to a search: the lead artist's seed releases, halved once per step down that artist's grade, plus the year for the tie-break. Three columns and no title on purpose, so the ranking pass reads 15 MB rather than the 60 MB a title and an artist name would make.
- `artist_search` / `label_search` / `release_search` — FTS5. The third arrived on 2026-09-08, when records became pages: before that a title was a row that linked out to Discogs, so there was nothing here to find.

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

**A record has no grade of its own and inherits one, and the results column says it. Reinstated 2026-09-09.** The column came out on 2026-09-08 when records became searchable and a third of the rows had nothing to show, on the argument that the lead artist's grade would put a word about a person in a row about a record. What put it back is that **the ranking was already doing exactly that**: `rankHits` halves a record's weight by the lead artist's grade and always has, so the order was built on the inherited word and the column was the one part of the page not saying so. Showing it is the page agreeing with its own sort. Measured over 50 queries, 97.1% of release rows have an artist grade to inherit, and the artist's name is already on the line under the title, so the word sits beside the name it describes.

**The other 2.9% are compilations, and they take the label's grade.** Corpus-wide 108,751 releases, 9.9%, have a lead with no coverage row; all 108,751 have no artist page at all and 70,114 are literally named `Various`. That is a record with no single maker rather than a hole in the data, so the room it came out on is the next honest thing to ask, and 96.4% of them have a graded label. **Simone took this on 2026-09-09 with the objection on the table:** one column now answers from two places, in the one place on the site where the word already stands alone. `gradedOn` carries which of the two answered, and nothing reads it yet — the wording is the open half of this. **It cannot move the ranking, and that was checked rather than assumed:** `sceneScore` is `scene_releases / 2 ** step`, and a record with no artist coverage has no `seed_releases` either, so its score is zero whatever the grade divides it by. **And only a missing row falls through**, since `artist_coverage.relevance` is NOT NULL: an artist measured at `none` keeps `none` rather than being regraded on the room they released in.

Never show `relevance` as a bare word where there is room to say what it stands on. Two different things put an artist on a step, and a page that says "medium" without saying which is claiming cluster work that may not exist. The artist page pattern: `Medium, very weak ties with the core dub techno cluster, here because linked to roots dub, the Jamaican sound dub techno grew out of`. There is no longer anywhere it stands alone: the results column that used to show it was removed on 2026-09-08, when records joined the search and a third of the rows had no grade to show.

**Scene and cluster are not synonyms in the interface.** The *scene* is the whole extended map this tool draws, neighbours included: it is what the home page means by "Dig the Extended Scene". The *cluster* is the dub techno core it was drawn from, which is what the seed measures and therefore what every tie is measured against. A grade reads "ties with the core dub techno cluster" and a label reads "% of everyone it released is in the dub techno cluster", while the About panel and the headline keep saying scene. Prose in this file still says "the scene" for the general idea; the rule is about strings a visitor reads.

**Two numbers on an artist are close enough to confuse and are not the same thing.** The grade comes from pass 1's tally, which counts APPEARANCES across the whole dump (someone on the artist line who also engineered the record counts twice) and only exists for artists who cleared the seed ratio. What a page displays is recomputed in `derive` as DISTINCT releases, for everyone. Pass 1 has Jeff Mills at 160 where the corpus holds 116. Do not quietly reconcile them by regrading on the displayed figure: that moves every dial under the acts they were pinned to, and it is a decision to take deliberately.

Ranking by frequency is central: collaborators and labels are ordered by count, never alphabetically. Frequency is the signal.

**Search ranks on scene work, and the grade discounts rather than gates. Fixed 2026-08-30.** Sorting on `relevance` first was a bug for the reason the label floor of 2 already warns about: a grade is a ratio, and a ratio needs work behind it before it describes anything. Label `very high` needs only two seed artists, so a one-record imprint with a perfect ratio beat the name the scene is built on. A Ghostly Ghost Productions (1 release) sat above Ghostly International (508), Simon Shackleton Music (2) above Shackleton (118), basic_sounds above Basic Channel, PAN at position 21, and `moritz` never reached Moritz von Oswald at all because four smaller Moritzes graded a step higher. The failures clustered on exactly the names this tool exists to serve, which is how it stayed invisible: Kompakt, Tresor and Chain Reaction ranked correctly throughout.

What it ranks on now is **releases the cluster explains, halved for each step down the grade**. For an artist that figure is `seed_releases`, unless a tradition applies and the seed therefore cannot see them (next paragraph); for a label it is `label_coverage.seed_releases`, releases of its own that are in the seed. Volume alone overcorrects, which is why the grade stays in: Moritz Illner has 30 seed releases of 184 and must not sit above the Moritz von Oswald Trio's 28 of 33. Halving per step is deliberately one rule rather than five hand-set weights, and it says a step of the scale is worth a doubling of the work.


**A tradition is scored on work the seed cannot see, and on this branch it took three edits rather than one.** Ported from `main` (`1a414be`) on 2026-09-09, where it was app-side and done in a single function. `seed_releases` is the sort key and it is blind to dub, reggae, dubstep, Detroit, afrobeat and jazz by construction: that blindness is the entire reason lineage exists. Lineage fixed the grade and nobody fixed the sort, so the King Tubby problem came back one layer along wearing a number instead of a word. **2,820 lifted artists scored exactly zero**, and on this branch **18,978 of their records scored zero with them**, so `commodo` returned Commodore Dub, `scientist` put Full Moon Scientist above Scientist, and `atkins`, `craig` and `banks` handed Juan Atkins, Carl Craig and Mike Banks to a namesake. The rule that fixes it is **the corpus release count, halved** — one step of the halving already in use, paid because the corpus cannot say which part of that output is the tradition — and **floored at `seed_releases`, so a tradition only ever lifts.** Full release count was measured on `main` and is too strong: it puts Jan Delay above Vladislav Delay.

**Three readers of that measure, and fixing one leaves the other two.** This is the lesson under Working style in its most literal form. `artistPool` ranks the names, `releasePool` ranks the records and sets what `score` actually orders on, and `release_rank.weight` in `derive` is the pool cut that decides which 200 records get ranked at all. `main` has only the first, because records are not an entity there. All three now carry the same `max(seed_releases, lineage ? release_count / 2 : 0)`, spelled identically on purpose: one measure read three ways is what caused this. The derive half also multiplies by `1.0`, because integer division made the pool cut disagree with `sceneScore` about whether a small lineage catalogue was worth ranking at all, and the cut runs first.

**What it fixed and what it did not.** `commodo`, `loefah`, `atkins`, `craig` and `banks` all answer with the artist first. `scientist` moves from outside the top five to second. **`tubby` moves from outside the top five to fifth and no further, and that is two separate things, neither of them this rule.** Jah Tubbys the label scores 74.8 against King Tubby's 28.5, on 87 releases at an 86% roster share against a medium grade discounting a lifted 114 by two steps: the same arithmetic holds on `main`, so it is the ranking rule working as written rather than a regression. Above him also sit records by Scientist (35.6) and Disrupt (32.0), whose catalogues are larger than his, and that is the per-artist collapse parked for v3 becoming visible: those records were weighted zero before and could not crowd anything. **Do not treat either as a reason to re-tune this rule.**
**A label was measured on its roster and ranked as though it were its records, and that was a bug. Fixed 2026-09-09.** The line above used to end "the release count times the roster share, which is the one unit the two can be compared in". It was not one unit. An artist's `seed_releases` counts releases of theirs actually inside the cluster; the label figure multiplied a release count by a share of **people**, which answers a question about records with a fact about the roster. The two come apart because a seed artist needs only 2% of their own output inside the seed, so a label can have half its roster in the cluster and almost none of its own records there. **Planet Rhythm Records read 764 against a true 126 and beat Rhythm & Sound, whose 160 was strict because an artist's always was.** Tresor read 27 against 9, Chain Reaction 105 against 80, and Rhythm & Sound itself 57 against 57: the inflation scales with catalogue size times roster share, so it fell hardest on the large labels the second seed gate was written to admit and not at all on the pure imprints, which is what kept it invisible on `kompakt`, `tresor` and `chain`. The same shape as the two bugs above, and the third time a cheap proxy has stood in for the measure.

**A third candidate was measured and rejected**: releases with a seed artist on the line, which sounds like the roster claim done honestly and comes out at 828 for Planet Rhythm, worse than the estimate it replaces. Same cause, the 2% dial.

**What it costs is `pan`, and the cost is named rather than hidden.** PAN is 363 releases at a 41.9% roster share but only 18 records the seed can see, because it puts out experimental electronic nobody tagged dub techno. It was row 1 on `pan` and is now row 4. That is the honest figure and it is also the case the second seed gate was written to admit, so it is a real loss taken deliberately, not a rounding error. Measured over 59 queries: 31 changed, 9 at row 1, and 14 of the 16 queries named in this file hold their first row. `rhy` and `rhythm` answer with Rhythm & Sound, which is what prompted the whole thing.

**The grade still reads the roster ratio, and must keep doing so.** What a label puts out and who it puts out are different claims, and the grade has always been the second one: `label_coverage.relevance` is untouched, `very high` is still exactly the seed-label rule, and `check-corpus` still asserts the two counts match by name. Only the sort reads the new column. All five grade counts are identical either side of the change.

**Typing a name exactly is worth a doubling, and until 2026-09-09 it was worth nothing at the top step.** Name matching gates exactly as badly as the grade did: ranked first, it hands `basic` to five unrelated acts called "Basic (2)" and `moritz` to "Moritz (15)". Worth a step, it moves almost nothing else across 25 queries. **But it was spelled as a step taken off the grade's discount, `2 ** max(0, step - 1)`, and `very high` is step 0, so there was nothing to subtract**: the one grade where a name is most likely to be typed in full was the one grade the rule never reached. Written as a doubling it is the same arithmetic everywhere else, since dividing by `2 ** (step - 1)` IS doubling and then dividing by `2 ** step`. What it moves on real data: PAN back into the top five at four, `Kompakt (2)` and the label `Delay` and the artist `Mute:` each up a place on their own exact name. Discogs' "(3)" disambiguator is stripped first, since it is how the database tells five labels called Pan apart and not part of the name anyone types.

**A record's rank is precomputed, because the query cannot afford to work it out.** `re` matches about 200,000 titles, and reaching the artist line and the coverage row for each of them to find the lead artist's figure cost 103 ms of a 196 ms answer, against 84 ms before records were searchable. `release_rank` is that figure written once in `derive`, and the pool now ranks against it in 25 ms and reads the wide row only for the 200 that survive, which costs 0.3 ms. A wider table carrying the title and the artist name was measured too and lost at 49 ms against 31: 60 MB touches four times the pages 15 MB does. **What is left is the label pool at 70 ms**, which predates records entirely and is a `count(DISTINCT release_id)` per matching label; the same treatment would fix it.

**A record ranks where its maker ranks, one step down.** Added 2026-09-08 with `release_search`. A release carries no grade and no ratio of its own, because a grade measures a body of work against the cluster and one pressing is not a body of work, so it inherits the lead artist's figure and the lead artist's grade. The halving is the same rule the grade already uses, a step of the scale being worth a doubling of the work: without it a record ties with its own artist and `basic channel` answers with a pressing before it answers with Basic Channel. Between two records the tie-break is the year, earliest first and undated last, which is the only thing that separates an original from a repress and is missing on three of the ten pressings of Phylyps Trak. The lead name only, matching the release page's headline, since 133,205 releases credit more than one act and a row has no space for a sentence.

**One row per record, not one per pressing.** `biokinetics` matched 15 rows and `phylyps` filled all three dropdown rows with the same 1993 record. Ten pressings are ten real rows with ten real pages, each reachable from the artist and the label, but they are not ten answers, and this list has no column for what actually tells them apart: format and country are on the page rather than in the row. Collapsed on title AND lead artist, because two acts really do use one title, and the ranking has already put the earliest first, so keeping the first seen keeps the original. The 64 pressings of No Doubt's "Rock Steady" become one row, which is what lets Dub Pistols at 60 seed releases sit above them at 54 rather than under a page of repressings.

**The pool is wider than the page**, 200 per kind. The SQL used to order by one thing and the page by another, so a row cut in SQL could never be ranked, which is the other half of why PAN came 21st. The width is free; what a query costs is the FTS scan and costing every match for the figure it sorts on.

**The order and the relevance column now visibly disagree, and that is accepted.** Moritz von Oswald reads `high` above a Trio reading `very high`. A grade is a grade, not a rank: it answers how close to the scene, while the order answers how much of the scene this name accounts for. The releases column carries the visible reason, 510 against 33. Simone took this deliberately on 2026-08-30 over showing the sorted figure as its own column, which would have put a fifth column on a list already carrying four. So the caveat on the dropdown below is now literally true of the results page too, and is a known cost rather than a licence: **do not add a second sort key that the page cannot show.**

**Named exceptions to the grade, added 2026-09-10.** `overrides` in `config.ts`, applied in `derive` after everything else. A grade is a ratio, and a ratio is right about a population and wrong about particular members of it; this is where the particular members are written down. Planet Rhythm Records is the first and so far only entry: it clears the broad seed gate honestly at 190 seed artists of 396, which is the gate working, and it is still a straight hard techno label rather than a room the scene treats as a reference the way Ghostly and PAN are. **The alternative was moving `minSeedArtistRatio`, which is fitting the dial to one answer** — the thing this file has refused to do for Metroplex since 2026-08-30. Naming the label leaves the rule measuring what it measures.

**Three things set a grade and they are ordered: the seed measures, a tradition lifts to its floor, a person overrules both.** The override runs last so a tradition cannot undo one, and it writes in either direction, because which direction is right IS the editorial judgement. `scene_relevance` is untouched, so a page still shows what the seed measured beside the grade a person gave it — the same split that lets a lifted grade say it was lifted.

**Every entry carries a reason, and it stays under the hood. Decided 2026-09-10.** An overridden page prints the grade alone: Planet Rhythm reads `Medium` and stops. **This is the second place the grade stands as a bare word**, after the search results column, and the only one where something could have been said — so it is an exception to "never show `relevance` as a bare word where there is room to say what it stands on", taken deliberately and recorded here rather than left to drift. What it buys is a row a reader takes in at a glance; what it costs is that the least self-explanatory grade on the site is now the least explained. **The alternative was never to print the ratio**: `Medium` beside `48% of everyone it released is in the dub techno cluster` is the page contradicting itself in a single row, so the real choice was the editorial clause or silence, and silence won on legibility. The reason still exists in `config.ts` where it is argued, in `override_reason` in the database, and in `check-corpus` output. The `name` field is checked against the database by `check-corpus`, so an id that drifts or a label Discogs merges away is a failure rather than a silent regrade of a stranger, and `derive` throws if an override names something with no coverage row.

**`check-corpus` subtracts the list rather than exempting it**, which turns the invariant the override breaks into one that pins the override too: `very high = seed labels` now reads `18,998 of 18,999, less 1 held down by hand`.

**A promotion has to survive the sort, and that is why the reason is a column.** `relevance` is only a discount on `seed_releases`, so promoting someone the seed scores at zero moves the word on the page and leaves the search order exactly where it was — the 2026-09-08 lineage bug on a name somebody chose deliberately, which is the worst version of it. **All THREE readers floor an overridden artist on half the corpus count, the same expression a tradition gets**, and getting that wrong is not hypothetical: the override shipped on 2026-09-10 with only `artistPool` fixed, so The Dub Sync scored 1 while every record of its own scored 0.25, and a sanity check the same day caught it. `releasePool` and `release_rank.weight` are the two that get forgotten, because the artist looks right on the page while its records do not. **The count is three. Grep for `override_reason` and expect three matches outside the schema.**

**The bar for adding one, and the second half fires first.** Past roughly 100 entries this has become a second grading system nobody can audit. **And if three entries in a row share a reason, that is a rule asking to be written rather than three more rows** — three labels held down for "big catalogue, thin actual output" means the measure is wrong and the fix belongs in the measure.

**An override is a statement about one name, not a repair for a measure, and Planet Rhythm needed both.** It was written on `main` first, where demoting it to `medium` moved the word on the page and left it answering `rhy` first anyway: the label sort figure there is still the release count times the roster share, 764 discounted two steps to 191, against Rhythm & Sound's 160. The arithmetic did not follow the grade because 764 was never how many records that label has in the cluster. Here it is 126, measured, so the two work together rather than one covering for the other: the measure fix alone already put Rhythm & Sound first, and the override is what says why Planet Rhythm reads `medium` when its roster share does not. **Do not reach for an override when the thing that is wrong is a whole class.** That is the test the list has to keep passing, and it is the same test as the three-shared-reasons trigger above, seen from the other end.

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
- **A tradition lifts to its floor and no further.** It cannot promote someone past the floor and cannot demote someone already above it. `scene_relevance` keeps the measurement, so the page never implies cluster work that is not in the data. Which grades a floor may raise is `lineage.liftsFrom`. **The tag also changes what search sorts them on**, since `seed_releases` scores them at nothing by construction: see the search ranking rules above.
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

## The release page

Shipped on the v2 branch. The third entity, and the cheapest one: a route and a
query against tables the published file already carried.

**It needed no ingest change at all.** `releases`, `release_artists` (1,261,347
rows), `release_credits` (4,110,875) and `release_labels` (1,144,364) are all
published, and `creditLine()` already names the role strings. So this is the
first page that reads the raw tables rather than the derived ones, which is
worth knowing before assuming the app only ever touches precomputed output.

**A live API top-up was rejected, and stays rejected.** It is the second path
from the deferred-images section arriving early under another name: a live
external dependency, a rate ceiling, mandatory attribution, and the on-ramp for
"while we are calling anyway". The server reads one static file and nothing
else. Local only, or not at all.

**It carries no grade, and the field says how it got in instead.** The five
steps are a ratio over a body of work, and one record is not one. `is_seed`,
`channel_a` and `channel_b` are facts about the corpus boundary, so the row
reads "here because it credits an artist from the dub techno cluster" and never
a step of the scale. Cluster rather than scene throughout, because those three
flags are exactly what the seed measures.

**Most credited names are not links, and that is the honesty rule in its most
literal form.** 379,447 of the ids in `release_credits` never became corpus
artists, because `channelAMaxPeopleToAdmit` stops a crowded record admitting
anyone new. 800% Ndagga is the case that matters: nineteen people, one page.
`CreditRow` takes an optional `href` and renders plain text without it, the same
treatment `Chip` gives a relation the corpus never admitted. Artist 355,
Discogs' `UNKNOWN ARTIST` placeholder, is excluded by hand: it does have a row,
so the join alone would offer a link to a page about nobody.

**Credits are ranked, not listed in the dump's order.** The dump hands them back
sorted by role string, which put Mark Ernestus, who produced, engineered and
mixed 800% Ndagga, sixth of twenty-one. `rankCredits` orders by how many named
roles a person holds, so the row shows the reason it is where it is. It counts
named roles rather than stored strings, because the collapsing means those are
two different numbers, and that is why the ranking cannot be done in SQL and why
the credits are fetched whole rather than paged.

**Thin pages are accepted, with the numbers behind them.** 443,005 of 1,095,302
releases carry no credits at all, 69,907 have no label and 32,832 have no year.
Every corpus release gets a page anyway: minting them only where there is
something to say would put two different link behaviours on one list. The
absence has to say which absence it is and must not say "worked alone", because
a record with one name on the line and nothing else is either solo work or an
unfinished entry and the dump does not say which.

**The by-line's whitespace is load-bearing.** `compressHTML` is off, so source
indentation survives into the document and a newline between two elements
collapses to a rendered space. 41,335 join phrases are a comma, so a newline
between the name and the phrase prints "Karl O'Connor , Peter Sutton", and a
newline inside the anchor makes `link-rule` underline a trailing space. Both are
closed up on purpose in `release/[id].astro` and in `CreditRow`. Do not let a
formatter open them.

**The page shows what the record printed, and that took a backfill.** Format,
country, the date as written and the tracklist were all discarded at parse time
and came back on 2026-09-07 via `enrich`, which is one more read of the dump and
deliberately not a re-run of pass 2. Notes and matrix are still discarded, styles
and genres are still dropped at publish, and images are Restricted Data and stay
out.

**The layout is Simone's sketch, and three of its decisions are load-bearing:**

- **Two lines in the headline, and only the first name on the top one.** A
  sleeve says who and then what, so the artist reads grey above the title. It is
  the first name only however many the line has, because a headline is a name
  rather than a sentence: 133,205 releases carry more than one, and "Mark
  Ernestus Presents Jeri-Jeri" over a long title is a paragraph in 60px type.
  The whole line, join phrases and links, is the Artist row below. Both sit
  inside the one `<h1>`.
- **The artist line is a third of the title, and grey was not enough on its
  own.** Both were set at `--text-name-label` until 2026-09-08, when testing
  with real readers found they could not say at a glance which of the two
  stacked names was the record: same face, same size, same weight reads as one
  name in two colours. The worst case is a long act over a short title, where
  the grey line is also the longer one and takes the headline by size. A size
  step is what makes them read as different kinds of thing, and it beat the
  alternatives on the table: quotation marks around the title say "track" by
  every music-publishing convention and collide with 2,657 titles that already
  carry quotes, 775 of which open with one; a mono "BY" label marks the
  category correctly but cannot sit inline without pushing the artist off the
  title's left edge, and stacked above it puts two mono labels under each other.
  The size is `--text-byline`.
- **The eyebrow carries a mark on the three entity pages**, and only there: a
  person, a tag, a disc. Same wayfinding problem as the size step above, one
  layer up — a shape is read before a word is, so it is the answer the eyebrow
  already gave arriving sooner. Not a rebus: the word sits right beside it, so
  the mark only has to be told apart from the other two, which is why they are
  drawn for silhouette rather than detail. Drawing the candidates is what chose
  them. A ring, the paper centre a label is named after, is the same mark as the
  release disc at 13px; two overlapping discs collapse into a squiggle; a sleeve
  with the record's edge showing reads as a mug. The tag is the everyday sense
  of the word rather than the music one and wins anyway, because every other
  label candidate was a circle or a box and both were taken. **Non-entity pages
  keep the bare word**: a mark is an identifier and "Info" identifies nothing.
  14px in a 12px box on a 1.35 stroke, against the 1.5 the site's other SVGs
  use, because at 12px they read as dots and at 1.5 the tag's hole and the
  disc's centre close up.
- **Both headline lines are pulled flush by their first letter's side bearing.**
  A glyph does not start where its box does, and the bearing is a fraction of
  the size, so two lines at 38px and 120px start 7px apart on the same left
  edge: the size step made a misalignment that had always been there visible.
  `opticalLeft` in `web/src/lib/optical.ts` holds a bearing per character,
  measured off the served font with `actualBoundingBoxLeft` at weight 700, and
  returns a negative margin in `em` so it scales with the clamp. The spread is
  why one correction cannot serve: `W` sits at 0.013em and `B` at 0.082em. A
  character the table does not hold gets no correction rather than a guessed
  one, which is the honest answer for the accented and non-Latin titles in the
  corpus. **The artist and label headlines take the same correction**, so a name
  starts on the column's edge whichever page it is on. The eyebrow above them is
  deliberately left alone: mono at 13px is out by under a pixel, which is below
  the size at which a correction is worth its own line of code. The home, Core,
  Info and 404 headlines are still uncorrected.
- **Credits are the third tab, and they were a band above the tabs until
  2026-09-08.** The argument for the band was that credits are what the record
  is where the two "more from" lists are only where to go next, and that filing
  the answer with the follow-up questions buries it. The phone settled it the
  other way: on a well-entered record the band pushed the first list two screens
  down, so a reader had to scroll past every credit to learn there was anything
  else on the page. Last of the three rather than first, so the page opens on
  more from the artist: the record itself is already above in the identity
  block, which leaves the tabs to answer where to go next. **No tab at all when
  there are none**, since a tab is a way in and there would be nothing behind
  it; the identity block carries that absence instead, in one line next to the
  other things the corpus does and does not hold.
- **All three tabs page in place, on one `show`.** The "more from" lists used to
  stop at ten rows and hand the rest to the artist page, which is a link out of
  a list rather than more of it. They now lengthen where they stand and hold the
  reader's place, like every other list on the site, which also moves their
  first page from ten rows to `PAGE_SIZE`. One parameter serves whichever tab is
  open, and it can because only one list is ever rendered; switching tab drops
  it, which is right, since that is a different list rather than more of this
  one. Year takes the middle
  column and the label the wide one, which is the artist page's own release list
  to the column: two lists answering "what else did they make" must not disagree
  about what a row says. **This line said `format` until 2026-09-11 and the code
  had said `Cat no.` for days**, so it was doc drift on top of a decision, and
  both of those answers were about the object rather than the record. The format
  is what the 10rem column was originally sized for (`2× Vinyl, 12", 45 RPM`);
  the catalogue number is the label page's column, where it means something
  because the room is fixed and the number is what tells two of its records
  apart. A discography draws its number from a different label on every row,
  with nothing to index it against. The label is the part that varies, and it is
  a second pivot besides: the title opens the record, the label opens the room.

**A missing format is not a missing credit, and the page says so by saying
nothing.** Format and country rows are omitted when the dump has none, rather
than printing a dash. The honesty rule is about absences the corpus has an
opinion on: "no credits recorded" is a fact about the record, where a missing
carrier is a fact about the entry. The tracklist follows the same rule, and when
it is there it has no cap and no links: a track is not an entity, the track
level's own artists are dropped at parse time, so there is nobody to pivot to
and the interface must not imply there is.

**Release titles on the artist and label pages now open the record** rather than
leaving for Discogs, which was 1,095,302 links out of a tool whose whole premise
is that a pivot costs one click. The Discogs link moved onto the release page
itself, and it sits directly under the title rather than under the identity
block: a release lists no sites of its own, so it is a button rather than a
"View on" row, and it is the one thing a digger reaches for when the corpus runs
out. Below the block it had the pressing and a full tracklist in front of it.

**What is deliberately NOT on the page is why the record is in the corpus.** An
"In corpus" row printed the seed and channel flags until 2026-09-08. They answer
a question about the corpus boundary rather than about the record: an artist
carries a grade because a ratio over a body of work says something about them,
and one pressing has no body of work behind it. The flags are still in the data
and still what `check-corpus` reads.

## UI principles

These are load-bearing and hold regardless of how the interface looks:

- **Ranked lists over graphs.** Sorted by strength, lists answer "who matters here" on sight. No graph in v1.
- **A sort reorders the list, it never rebuilds it.** Both Core pages carry a two-cell control since 2026-09-03, ranking and A–Z, and the `SHOW_SORT` flag that used to hide it is gone. The list is still the top `TOP_LIST_SIZE` by scene weight and A–Z reorders that same set, rather than reaching alphabetically into the corpus for a page of names beginning with A, which would be a different page wearing this one's heading. Ranking is a cell in the row rather than an implied state, which is what makes A–Z a toggle: the way back is the cell next to the one you clicked. Server side and in the URL like the tabs, so `?sort=name` is an address and an 808-row list is never handed to the browser to reorder. **It was four cells for a day, and the two that went are the rule stated backwards.** Releases and Active shipped on 2026-09-03 taking the column headings verbatim, worked correctly, and came out the same day: the page's whole claim is that it ranks by scene weight, so sorting Core Labels by raw catalogue size put Virgin, Warp and Mute at the top of it, a true statement about those 808 rows and a misleading one about the page they are on. A–Z survives because it is a way of FINDING a name in a ranked list rather than a second opinion about the ranking. Any third ordering has to clear that bar.
- **One click to pivot.** Every artist and label is a link to its own page. Digging is hopping between pages, not composing a query.
- **The hero belongs to the home page, and a query ends it. Changed 2026-09-09.** One file serves both, and once there is a `?q=` it stops being the home page: the headline was already dropped, and now the hero field goes with it and the header's own field is switched on instead, carrying the query so a reader who wants to change it finds what they typed still in the box. Keeping both would have been the page asking twice for the same thing, which is the rule `search={false}` was written for read the other way round. What is left is the shape every other page has: a column, an eyebrow, a title, the answer under it. **The eyebrow carries the query**, `Search for “rhythm & sound”`, which is the one thing on this page no other page's eyebrow does: everywhere else the eyebrow names a kind and the `<h1>` under it names the thing, where here the title is a fixed phrase and the query is the only part that varies. In the same curly quotes the count line uses, since they are what says where the query stops. **Below `sm` the field comes back, under the title.** The header's own is `hidden sm:block`, because a wordmark and a field do not fit on one line at 390, which left the drawer holding the only copy and search a tap behind three bars: tolerable on a page about one artist, wrong here, where changing the query is the likeliest next thing a reader does. So the results page renders one at `sm:hidden`, on exactly the seam the header field appears on, and the two are never on screen together. The header size rather than the hero's, since the hero is why the home page exists where this is a tool sitting under the answer it belongs to. **Putting it in the phone's nav row instead was built and thrown away**: that row is shared by every page, so filling its empty half would have changed the header everywhere to fix one page.

- **The search box pivots too, and it is one click from any page.** The suggestion dropdown is the shortest version of the same move: type, arrow down, Enter, and you are on the page without the results list in between. What does not fit belongs on the results page, one keystroke away and built for forty, and since 2026-09-03 a row says so: "View all results", pointing at the same query on the results page. It is a real option in the listbox rather than a footer under it, so the arrows reach it, Enter follows it and the script costs nothing new. It carries the tab you are on, and that reverses a note written here on 2026-09-09 when the results page had none. It has the same three since later that day, so a way out that dropped the tab would land a reader somewhere other than where the link was pointing: arrowing into Releases and following the offer under them has to arrive at releases. The server renders the opening tab into the href and the script rewrites it on every switch, since which tab is open is exactly the thing the server cannot know. A miss returns nothing and the dropdown stays shut, the way out included, since "view all" of nothing is the shortlist offering to show its own emptiness at greater length: the honest answer to a miss is the one the results page gives in full, that the corpus is a slice centred on dub techno and a legitimate absence is the boundary working, and Enter still goes there.

- **It asks which question first, in three tabs, and that is what four rows are for. Shipped 2026-09-09.** Artists & Labels, Releases, All, defaulting to the first. Three rows was the rule while every row was a name and the only question was which name; records became searchable on 2026-09-08 and a query started answering two questions in one list, so `basic` spent rows on Raw Basics 2, 3 and 4 and `chain re` put Diana Ross above the label the scene is built on. **Ranking cannot fix that on its own, and a blanket demotion of records would be wrong**, since `rodent` really is best answered by Burial's record. So the list asks which question first and lets the reader say otherwise in one key. The fourth row is what keeps the second question from pushing the first off the bottom; past the fourth the old argument still holds, that the ranking starts putting a name nobody typed under one they did.

  **They are three slices of one ranking, not three rankings.** The order is the results page's order throughout, so this stays a shortcut into that page rather than a second opinion about it: filtering a total order by kind leaves the survivors in the order they were already in. All three come back on one fetch, because the pools have to run anyway to know which tabs have anything behind them, so a tab switch costs no request — the right price for a control read at a glance. **A tab appears only when there is a choice behind it**, which is the release page's rule about a tab being a way in to something, and it needs both kinds to have matched: with names alone, Releases is empty and All is the same four rows under a different word.

  **Left and right change the tab, and only once the arrows are in the list.** Those keys already mean something in a text box, and a search field is one people back into constantly to fix a letter, so the highlight is what separates the two meanings: before the first ArrowDown they are the caret's and after it they are the tab row's. Focus never leaves the input either way, which is what keeps `aria-activedescendant` pointing at a real row, and the tab buttons are `tabindex="-1"` in a `group` rather than a `tablist` for the same reason. The row is a sibling of the listbox, never inside it, because a `listbox` may hold options and nothing else. **It needs no scroll hint, and that is arithmetic rather than luck:** its three labels are fixed strings, not data, so the row is 340px at the 390 viewport and 292px at 342, measured, with `scrollWidth` equal to `clientWidth` at both. Nothing the corpus contains can widen it, which is the one difference between this row and the page tab rows that do carry a hint.

  **The results page has the same three, and that landed the same day.** `?tab=` in the URL like every other tab on the site, drawn with the same `Tabs` component, which now works out its own `?`/`&` because this is the first caller whose `basePath` already carries a query. The two surfaces have to agree or the shortcut lands somewhere other than where it was pointing, and the fallback is written once, inside `search`: `"auto"` resolves to names unless names is empty, so `echocord jubilee` opens on Releases rather than on an empty first tab. It is settled in there rather than by the page because it needs the counts and the counts need the ranking, and asking for them separately would run both pools twice — 84 ms paid again on the worst two-letter prefix for an answer already in hand.

  **The results list pages with `?show=`, the same as every tab list on the site**, `PAGE_SIZE` 40 and the hold script keeping the reader where they were when the longer document swaps in. `show` carries the tab with it, so lengthening a list cannot drop you back onto the one the page would have opened by itself; a tab link carries no `show`, which is the mirror of the same rule and what makes switching question start at forty again.

  **The heading counts the tab, not the page, and it still refuses to state a cap as a count.** "Closest 40" was true of a list that stopped there and is false of one with a button under it, so the number is now the tab's total. But the pools are 200 a kind, so a broad query fills them and the count stops being a total: `capped` says so per kind, read off the pools rather than off the counts, because the pressing-collapse can take a saturated 200 down to 121 and hide that it was ever clipped. `dub` on Releases reads `Closest 121`, `echocord` reads `3 found`.

  **Every tab is drawn on the results page, including one reading 0, which is the opposite of the dropdown's rule and right for the opposite reason.** Four rows read at a glance cannot spend one on a tab that is a way in to nothing; a table has a count beside each word, so an empty tab answers the question rather than raising it. Clicking it is a real address and renders: an asked-for tab is answered even when empty, never quietly swapped for one the reader did not choose. **And an empty tab is not a miss.** The heading reads `No releases for "vainqueur"` without the accent, and the corpus paragraph is withheld, because "legitimately absent from a slice centred on dub techno" would be false about a query the other tab just answered. One line instead, pointing at the tabs.

  **The grade came back on the two kinds that have one, and it is not the removed column returning.** A row says what it is, and then what stands behind it: the grade on a name, the lead artist on a record. What was wrong on 2026-09-08 was a column that could answer for two kinds out of three, and a tab holding no records has no third kind to fail. The kind never folds, since "which of these" is what a shortlist under a half-typed word is asked and Chain Reaction is a label and a record and an act; the grade folds to `sr-only` below `md`, taking its separator with it. The grade is still not what the list sorts on, which is the cost recorded under the search ranking above. **The dropdown and the results page answer differently on a record, deliberately:** the results column inherits a grade and this cell prints the lead artist instead. One is a table with a column per question and room for both; the other is four rows read at a glance, where the name that made it is what tells one record from another and the grade would be the third thing in a cell that already holds two.
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
- **Hairlines, not borders.** `--color-hairline`, `--color-hairline-soft`, `--color-edge`, `--color-edge-strong`: separation without drawing a box. One accent, `#6fcabd`, doing two jobs, counted at ten places on 2026-08-16 and eleven since 2026-09-03. **As type** it marks what a thing is: the eyebrow, the two headline stops, link hover, the top two grades in the results column (very high and high, two of five since 2026-08-25: three would be over half the scale, which is where a mark stops marking, and the three quiet greys take one step each below it), and the "nothing found" heading. That last one had to argue for itself: a search that found nothing is the only heading on the site that has to be read rather than counted past, and a results page has already dropped the headline, so it spends colour that just came free rather than adding a place. **As a ground, a border or a state** it marks what you are on or reaching for: the current nav cell and the skip link (`bg-accent text-bg`, 10.48:1 whichever way round), the hero field's border, the focus ring, chip hover, header field focus, the drawer's current row, `::selection`, and the dropdown's "View all results" row. That last one is the only place the accent rests on something nobody is on or hovering yet, and it earns it by being the offer the three names above it are not: it has to be visible without being read. It also costs the row its highlight, since a row that is already accent cannot say the arrows are on it by turning accent, so that state inverts to the ink ground "Load more" and the nav cells take on hover. **The dropdown's own tab row declined it on 2026-09-09**, and that is the rule working rather than an exception to it: a current tab is exactly the "what you are on" category, but the accent was already resting three rows below in the same 250px panel, and two of them would each have stopped marking. It takes the page tabs' `ink-strong` over a hairline instead, which is what the artist and label pages already say for "you are on this one". The two categories are the test, and spending it outside them is exactly what stops it working: a new use is either a step in the near half of a scale or a thing being reached for, or it is dilution. `edge` is 1.86:1 and is decoration only; anything that is the boundary of a control wears `edge-strong` at 3.08:1.
- **The tab row says when it scrolls, and says it in CSS.** Where the tabs do not fit, a gradient and an arrow sit at the right edge, and `scroll-hint` fades them out over the last 40% of the travel on a scroll-driven timeline. It is the first piece of client behaviour that costs nothing from the script budget, which is the same argument the six scripts make from the other side: reach for a script only when the state is not knowable without one.
- **Which rows get one is arithmetic, not a breakpoint picked by eye.** The row is mono, so its width is exact: 9.62px a character at 13px and 0.14em of tracking, plus a 24px gap and the column's 48px of gutter. The widest artist row in the corpus computes to 481px and renders at 482. A row that fits 390, the narrowest viewport in scope, gets no hint at all, and the rest hide theirs at the first 40px step above their own width. **That is why the label page has none**: two tabs rather than three, 322px at the widest the corpus can produce, so an arrow there was pointing at nothing. The four steps are written out as whole class names because Tailwind reads the source and not the render.
- **`link-rule` marks anything that pivots**, at whatever size the type is. With one accent and no room to spend it, that hairline is how a link is told apart from the text beside it.
- **The content column is the `column` utility**: 1200px, 1.5rem of gutter, 3rem from 768px up. Bands span the full width, their contents stay in the column.
- **The shell is drawn once, in `Base.astro`.** Skip link, header, `<main id="content">`, footer. A page renders its own bands and nothing else. It used to render its own `<SiteHeader />` too, which is how the site ended up with no `<main>` on it anywhere.
- **The phone gets a drawer.** Below `md` the four nav cells stop fitting, so they stack behind three bars in a `<details>`: a sheet that slides over the dimmed page rather than a panel that pushes it down. Native disclosure, so it announces its own state, works with the keyboard, and comes back closed after a router swap without any code.

The reasoning behind the original rule still holds as an input: the user reads Discogs pages for fun and wants information per scroll. The grid and the ink ramp are what serve it now. If a change would genuinely improve information per scroll, argue it against the design, not against the deleted rule.

### Accessibility — WCAG 2.1 AA, and the footer says so

Audited and fixed on 2026-08-11. The footer carries the claim in public, which makes this a promise rather than an aspiration: **if a change would break one of these, it breaks the footer too.**

- **Every page has one `<main id="content">` and exactly one `<h1>`.** Both come from `Base.astro`. On the home page the `<h1>` is the headline. **When a query is present it is `Search results`, and it used to be the result count.** The count was the heading because the page had no other: the headline belonged to the home page and went the moment someone typed, and dropping the count as well left the document with no `<h1>` at all. Since 2026-09-09 the results page has a title of its own, in the same shape every other page uses — a column, an eyebrow, `text-name` — so the count goes back under it as a `mono-label` line. It keeps the accent on a miss; the title takes no accent stop, unlike `/info`'s, because the miss heading is what has to be read on this page and a stop would compete with it in the one case that matters.
- **The skip link is the first thing in `<body>`**, `sr-only` until focused. It is the only way past the wordmark, the search field and the nav.
- **Text clears 4.5:1, control boundaries clear 3:1.** See the ramp above. This is the rule most likely to be broken by accident.
- **A column heading that folds under the name stays in the accessible tree.** `md:sr-only`, never `md:hidden`: `ListHeader` is a sibling element and cannot tell a screen reader which column it names, so a row read aloud at desktop width came out "Basic Channel, 47, high, artist".
- **The drawer wraps focus rather than hiding the page.** No `inert`, no `aria-hidden` on the background. The page showing through the scrim is the point of a sheet over a panel, and marking it inert would hide from a screen reader the thing the design is making a point of keeping in view. Focus cycles inside the `<details>` and returns to the summary on close.
- **The contact dialog does hide the page, and that is not a contradiction.** A sheet is a layer over something you can still see; a modal is the only thing on screen until it is dismissed. It is a native `<dialog>`, so the inertness, the focus trap, the Escape key and the focus return are the browser's rather than ours. Two overlays, two different claims, two different mechanisms.
- **Anything that discloses says so.** `aria-expanded` on the bio toggle, `aria-current` on nav cells, tabs and the sort control, `aria-label` on both `<nav>` elements ("Sections" and "Lists").
- **Every SVG is `aria-hidden`**, and anything that leaves the site says so in its accessible name.
- **Motion is guarded.** All three scripted animations check `prefers-reduced-motion` (drawer, collapsing bio, figures count-up), and so does the drawer's stylesheet.
- **`autofocus` appears twice, and they are different jobs.** On the page it is the hero field's, and only while it is empty. The emptiness test predates the hero going away on a results page and is now belt and braces rather than the whole guard, but it stays: it is what says the field grabs focus because the page is a search box, not because a search box is on screen. Inside the contact `<dialog>` it is on the dialog element itself, which is how a modal chooses where focus starts — it fires on open rather than on load, so it takes nothing from the page. It has to be set, because the default is the first focusable descendant: that put focus on the close button, which a touch browser then rings with the accent as though closing were the offer.

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
| `ClientRouter` | 16,357 | every page |
| drawer | 1,064 | every page |
| contact dialog | 961 | every page |
| scroll hold and active tab | 686 | every page |
| search suggestions | 2,678 | every page |
| collapsing bio | 1,035 | artist and label |
| figures count-up | 644 | home |

Heaviest page is an artist or label at **22,781 bytes**, measured 2026-09-09. The router is 72% of it and is deliberate: the premise is that a pivot costs one click, so the document is swapped rather than reloaded. The six inline scripts are the whole of the rest, and a seventh needs the same argument those six made.

**The suggestion dropdown is the sixth, added 2026-08-26, and it made the argument two ways.** What someone is typing is not knowable on the server, which is the same test the collapsing bio passed. But most of what a dropdown does IS knowable there, so it is done there: `/suggest` is an Astro partial that returns the rows as markup, and the script fetches them, assigns them, and moves a highlight. No JSON, no templates in the browser, no list of hits held in memory. That is why it costs 2,678 bytes and not the several thousand a client-side renderer would, and why a change to how a row looks is an edit to an `.astro` file like every other row on the site. **It grew from 1,641 on 2026-09-09 and the tabs are what it bought**, which is the same trade one layer along: the rows for all three tabs arrive as markup on the one fetch, so what the script gained is toggling `hidden` and moving a highlight between them, and not a renderer. A tab switch costs no request and no template. That is still the sixth script and not a seventh — the argument a seventh has to make is unchanged.

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
- **Canonicals drop the query string, deliberately.** Every list carries its state in the URL (`?tab=`, `?sort=`, `?show=`, `?q=`), which is what makes each view a real address and also what gives one page unbounded addresses. The tabs are the same page answering the same question, so the canonical says so and `robots.txt` disallows `/*?` rather than letting a crawler walk the combinations to find out. **A `noindex` page carries none at all, since 2026-09-09.** The 404 used to nominate the bad address it was handed, which is a made-up URL claiming to be the preferred home of an absence. Two exclusive states: a page that can be indexed nominates itself, a page that answers a bad address nominates nothing. What replaces it in that slot on every other page is `max-image-preview:large`, which is about size and not indexing: Google may shrink a result preview unless told it need not, and the one image this site has is a card drawn so the wordmark survives the 630px square a result thumbnail is cropped to. `og:locale` is `en_GB` against a `lang` of `en`, which is not a disagreement: Open Graph asks for language and territory, and the site already counts in that locale.
- **A description is a request, not an instruction, and the home page had not made one.** Every other page passes its own; the home page fell back to the layout's default, which opened with the headline verbatim. That is the case where Google discards the tag and writes a snippet from the page's prose instead, and there was none to write from: `<main>` holds 25 words and not one full sentence, an eyebrow, a headline, a field and three figures. The footer was the only prose in the document, so Google published the footer as the home page's snippet, wordmark and MMXXVI and handcrafted in London. Fixed three ways on 2026-08-26. The home page states its own description, and since 2026-08-28 it is one clause: `A map of the dub techno scene and its neighbours, built from Discogs credit data.` For two days it opened with the move instead (`Type an artist, see who they worked with...`), which is an instruction aimed at somebody who has not yet decided whether to click. The layout's default no longer repeats the headline. And the footer carries `data-nosnippet`, which is right on every page rather than only that one, since those five sentences are identical across 534,527 of them. It sits on the inner `div` rather than the `<footer>` because Google names `span`, `div` and `section` as the elements it reads the attribute on, and a sectioning element it does not name is not the place to find out. Snippet suppression only: the text is still indexed and the links are still followed.
- **No prose was added to the hero, and that is still the decision.** A paragraph in `<main>` was the durable fix, since it gives an engine something better than the description to fall back on, and it shipped on 2026-08-29 as the band below. What was ruled out is the hero: a visible change to the one page whose spareness is the design. Simone chose the description as the whole of the answer on 2026-08-26 and did not reopen that half when he took the band. Do not quietly add an intro paragraph above the figures for SEO reasons: that argument has been had, and the prose it wanted is already on the page further down.
- **The AI Overview cited `/info` rather than the home page, and it was the same absence one layer up.** Noticed 2026-08-27, fixed 2026-08-29. An Overview grounds its answer in retrieved passages and cites the URL each passage came from, and it quotes rendered body text: a description is a request an engine can honour for a result card and is never a candidate for a passage, and neither is the JSON-LD. So the fix that solved the snippet could not reach this one. `/info` won because it opens `Dub Digger is a tool for digging`, a definition starting with the name, which is the shape retrieved for a branded question. The home page was not losing that comparison, it was never a candidate. **What ships is a `LabelledBand` labelled "What this is" after the figures, hidden when `searching`**, so the first screen is untouched and no `?q=` address carries it. Position on the page is not what makes a passage retrievable; being real body text in `<main>` is. **Its wording is deliberately not `/info`'s lead**, because two URLs offering one identical passage makes them compete and `/info` has four bands of depth behind the same claim. Its top gap matches the one above the figures (`mt-16 md:mt-30`, the hero's `pb-10 md:pb-24` plus `pt-6`), so the two hairlines share a rhythm. It makes `/` eligible, not guaranteed. Weakening `/info` to help `/` win was considered and rejected: that trades a good page for a citation.
- **The sitemap lists the core, not the corpus.** 1,813 URLs: five static pages plus the top 1,000 artists and 808 labels the Core pages already rank, generated per request in `web/src/pages/sitemap.xml.ts` because `/artist/[id]` has no static paths to enumerate. The other 1.6 million pages stay reachable by link. Nothing invites a bot to walk that many SQLite queries on a one-core VPS: this is discovery, not exhaustiveness. **Release pages are the largest part of that number and are deliberately in it**, 1,095,302 URLs against the 534,527 the rule was written for. They are crawlable, since they are real pages and a link reaches every one of them; they are simply not advertised.
- **`lastmod` is the database's mtime, for every URL.** Every page is derived from that one file, so it is the honest answer for all of them. Nothing in the corpus records when a credit was entered, and a date that moves when it should not teaches an engine to distrust the file.
- **The JSON-LD graph credits the tool, never the data.** A `WebSite` node and a per-page node, cross-referenced by `@id`, plus `BreadcrumbList` on inner pages. `creator` is a `Person` on the `WebSite` and appears nowhere else, because the split is the whole claim: the tool is Simone's, the credits are typed in by Discogs contributors. An `author` on a page node would take thousands of people's work and put one name on it, so there is deliberately none. There is no `Organization` and no `publisher` either, since there is no company and inventing one to fill a recommended field would assert something the pages do not. The footer states the same split in words, and the markup is only that sentence again. The one soft claim is `MusicGroup` on artist pages, which is wrong for the engineers and sleeve designers who hold Discogs artist ids, and is still the least wrong type available.
- **IndexNow is a manual step after deploy**, `npm run indexnow --workspace web`. It reads the URL list off the deployed sitemap, so it cannot ping ahead of the upload that proves ownership.

## Working style

- Build one plan-step at a time; commit after each.
- When something looks like it needs an out-of-scope feature, stop and say so rather than pulling it in.
- Prefer boring, legible solutions over clever ones. This is a tool to be maintained by one person.
- Comments in this codebase carry the reasoning, not the mechanics. When you change a decision, change the comment that argued for the old one.
- **A ranking change is argued with a before/after table, never picked from the armchair.** Build a throwaway harness that runs the candidate sorts over the same query list against the real published file, and read the rows. That is what showed, on 2026-08-30, that ranking exact name matches first fixes `pan` and simultaneously hands `basic` to five unrelated acts called "Basic (2)" — the very failure the change was meant to cure, one layer along. **The shape of that bug is the lesson: a hard gate on a cheap signal.** The grade gated first and buried Moritz von Oswald; name matching gated first and buried Basic Channel. Both work as a discount and neither works as a gate. Suspect it whenever a sort key is a ratio, a flag, or a string match, **or a measure with a known blind spot**: on 2026-09-08 the key was `seed_releases`, which lineage exists precisely because it cannot see, and 2,820 lifted artists sorted on a zero. The lesson that generalises past the gate: **a workaround built for one layer does not reach the others the same input feeds.** Lineage fixed the word on the page and left the number the sort reads, so when a measure is patched anywhere, grep for its other readers before calling it fixed.
- **The harness has to live in the repo root, and be deleted after.** `better-sqlite3` is a workspace dependency and will not resolve from the scratchpad or `/tmp`, so a throwaway ranking script written there fails with `ERR_MODULE_NOT_FOUND` before it reads a row. Write it to the root or to the worktree being measured, run it, then `rm` it and check `git status`: the rule above asks for one of these on every ranking change, so they accumulate.
- **Judge a long job by its worker process, not the wrapper.** `npm run x` leaves a shell and an npm process whose CPU sits at 0.0 while the real work happens in a grandchild. Reading the wrapper on 2026-08-30 turned a healthy pass 2 into a false "it is stuck" alarm. Find the child (`ps -eo pid,ppid,%cpu`, or `top`), and confirm progress from the artifact rather than the log: a second read-only SQLite connection can count committed rows while the writer is still going.
- **`astro dev` writes `web/.astro/dev.json`, and two different problems both surface as "Dev server already running".** Read that file and check the PID with `ps -p <pid>` before touching anything, because the two fixes are opposites. **Stale, the OS having recycled the number:** the lockfile outlived a crash or a kill, and the PID belonged to `mlhostd` on 2026-08-30 and to `feedbackd` on 2026-09-06. **Do not run `astro dev stop`**, which would signal whatever now owns the number; delete the lockfile and start again. **Live, and detached:** Astro 7.2 backgrounds itself when it detects an agent environment, `isRunByAgent()` reading `CLAUDECODE` through `am-i-vibing`, so a server Claude starts reparents to PPID 1, outlives the turn and then blocks the next launch from the terminal. That one is genuinely up and serving 200, which is what makes "I updated the OS" the wrong suspicion: nothing is broken, something is already running.
- **Stop one with `kill <pid> && rm -f web/.astro/dev.json`.** SIGTERM leaves the lockfile behind, measured 2026-09-06, so the kill on its own arms the next false "already running". **Claude stops any dev server it starts before the turn ends**, since an agent-started server is invisible to the person whose terminal it blocks. Simone launches his own from his terminal, where there is no agent to detect and Ctrl+C therefore works. `ASTRO_DEV_BACKGROUND=1 npm run dev` forces the foreground path if a script ever needs it, since the variable Astro sets on its own background child is also what stops it forking a second time.
- Run every workspace command from the repo root, since `npm run dev --workspace web` fails from inside `web/`.
- **A phone layout cannot be checked in headless Chrome, and it will not tell you so.** `--window-size=390` renders at 500 and crops the screenshot to 390, because 500 is the viewport floor. Measured 2026-08-28: 320, 390 and 450 all report `innerWidth=500`, and 600 reports 600. Anything laid out toward the right edge is silently cut off, which is how a missing count column on the artist page looked like a bug and was not. The tell is content at the left gutter sitting at the same x in both shots, because it is one render. 500px is the narrowest it can verify; below that, use real device emulation through the DevTools protocol or the actual iPhone, which is 390.
