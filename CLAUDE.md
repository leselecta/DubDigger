# CLAUDE.md

Project brief and working rules for this repository. Read this before generating code.

Every number in this file was measured against the corpus built from the 20260801 dump. When a number here disagrees with the code, the code is the truth and this file is the bug: say so, then fix whichever is actually wrong.

## What this is

A crate-digging tool built on Discogs credit data. The core loop: **type an artist, see who they worked with and what labels they released on, then click any of those to keep digging.** A map of scenes, drawn from credits.

The user is a music nerd who reads Discogs pages for fun, not a casual listener. Design for information density and fast pivoting, not for a gentle onboarding.

**For the full design rationale, why ranked lists beat a graph, the competitive research that led there, and the Gall's Law scoping reasoning, see `case-study-credit-graph.md`.** It sits in the working copy but is not committed, so it is on Simone's machine and not in a clone: every later mention of "the case study" means that file. This file states the resulting rules; the case study explains why they're the right rules. When a decision isn't covered by a rule below, reason from the case study's logic rather than defaulting to a generic pattern, and say so if the file is not to hand.

## Where it stands

Beta, and the footer says so. The corpus is built, the app is written, the VPS is ordered and unconfigured. What ships today:

| | |
|---|---|
| Corpus | 1,025,881 releases · 420,575 artists · 113,952 labels · 4,006,557 credits |
| Seed | 132,571 artists · 18,498 labels |
| Pages | home and search, artist, label, Core Artists, Core Labels, Info, 404 |
| Ingest database | 5.3 GB, `ingest/data/dubdigger.sqlite` |
| Published database | 928 MB, `web/data/dubdigger.sqlite` |

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
- **Ratio, `minSeedArtistRatio` 0.5.** Guards against a large label qualifying because one seed artist released on it once. There is a clean gap to sit in: majors land at 6–19% (EMI 6%, Sony 8%, Universal 10%, Virgin 19%) and scene labels at 67–100% (Chain Reaction, Basic Channel, Burial Mix, Rhythm & Sound, Echocord, Main Street all 100%, Ostgut Ton 84%, Kompakt 81%, Tresor 69%, Modern Love 67%). 0.5 is the empty middle.

Both sets are held in memory and persisted as saved artifacts, because they are the definitional core of the corpus: needed for debugging "why is this person in?", for the provenance marker, and for re-running pass 2 without redoing pass 1.

### Pass 2 — one hop out, two channels

Stream the releases dump again. Keep a release if EITHER channel applies:

- **Channel A, collaboration:** the release credits a seed artist. Captures neighbours who enter through a real working relationship, bringing their other credits with them.
- **Channel B, label membership:** the release is on a seed label. Captures pure label-mates, who share a room with the scene but never personally worked with anyone in it. Without this channel, "who else is on this label" is a question the data cannot answer.

Harvest artist IDs from all kept releases. Union of pass 1 and pass 2 releases is the corpus.

**Stop at one hop, on both channels.** Two hops eventually drags in most of Techno, which defeats the point.

Three dials keep channel A from swallowing Discogs, and the first is the one that matters:

- **`channelAMinSeedRatio` 0.1 — the size dial.** The first full pass 2 expanded 179,416 seed artists into 6,563,471 releases, a third of Discogs, 98% of it through channel A. The cause was degree: the seed contains mastering engineers who also worked on tens of thousands of unrelated records, and all 60,386 of Bob Ludwig's releases walked in behind him. A flat credit cap cannot fix it, because Moritz von Oswald has 556 credits and looks the same from outside. Share of work separates them cleanly: von Oswald 42.8% and Mark Ernestus 76.3% against Ludwig 0.2%, Bernie Grundman 0.3%, Beethoven 0.0%. Suppressed artists keep their pages and credits; they just stop being treated as evidence that two unrelated records belong to one scene.
- **`channelAMaxPeopleToAdmit` 8.** A release crediting more than eight people admits no NEW artists, though it is still kept and everyone already in keeps their credit. Track 7 and track 31 of a forty-artist compilation share shelf space, not a collaboration, and that is how a gospel record put an unrelated act called "Chain Reaction" into a dub techno corpus. Of artists whose only route in was one channel A release, 43% arrived on a release crediting 15 or more people and 7% on an intimate one to three.
- **`channelAMinSharedReleases` 1.** Off, effectively. Raise it only if the corpus comes out too large.
- **Authorship credits confer no membership.** Mozart is "Composed By" on 175 corpus releases because sampling a piece credits its author. That is a fact about the composition, not evidence anyone collaborated. Same shape as the packaging rule, one stage later: packaging stops at the seed boundary, authorship at the admission boundary, and both leave the stored role strings untouched.

**Placeholders are not people.** `Various`, `Unknown Artist`, `No Artist`, `Traditional` (27,068 written-by credits) and any credit whose id parses as 0 (833,731 of them in the first run, which would have made "artist 0" the best-connected person in the database). Labels the same: `Not On Label` in any casing, across 19,947 distinct ids, whose generic bucket alone gathered a 483,207-artist "roster".

**Tag provenance per artist: channel A, channel B, or both.** A collaborator is not a label-mate and the interface must be able to say which. As built: 188,710 non-seed artists arrived by collaboration only, 48,865 by label only, 50,429 by both.

**Measure between passes.** Corpus size is data-dependent and unpredictable. Report seed artist and seed label counts after pass 1, then the per-channel result of pass 2, before committing. `measure-seed` exists for exactly this.

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

**Ingest bookkeeping, not published:** `seed_artists`, `seed_artist_totals`, `label_artist_pairs`, `roles_seen`, `ingest_runs`. Measure role coverage against the ingest database, not the web copy.

**Derived, what the app reads:**

- `artist_collaborators` (5.1M rows) — per artist, co-credited people ranked by shared-release count, with roles held
- `artist_labels` / `label_roster` (1.37M rows each) — the same edge from both ends, with counts and date ranges
- `artist_coverage` (one row per artist) — release and credited-release counts, collaborator and label counts, year span, seed releases and share, and the three grading columns below
- `corpus_artists` — seed membership and channel A/B provenance
- `seed_labels` — kept, since a label's grade rests on it
- `artist_search` / `label_search` — FTS5

Coverage flags must distinguish "no credits recorded" from "worked solo". That distinction is load-bearing in the UI.

**Three columns carry the grade, and they are not interchangeable:**

- `scene_relevance` — the measurement. `high` / `medium` / `low` graded on seed release count AND seed share of whole output, since either alone misranks; `none` for artists with no seed work.
- `lineage` — a tradition the scene came out of or keeps company with, or NULL. Six of them, below.
- `relevance` — **what the interface shows**: `scene_relevance` raised to the tradition's floor when a lineage applies. One scale, one column, so a result reads the same in search as on its page. As built: 16,985 high, 48,148 medium, 70,863 low, 284,579 none.

Never show `relevance` as a bare word where there is room to say what it stands on. Two different things put an artist on a step, and a page that says "medium" without saying which is claiming cluster work that may not exist. The artist page pattern: `Medium, very weak ties with the core dub techno cluster, here for lineage: roots dub, the Jamaican tradition dub techno grew out of`. The search results column is the one place the word stands alone, and that is a known cost of merging, not a licence to do it elsewhere.

**Scene and cluster are not synonyms in the interface.** The *scene* is the whole extended map this tool draws, neighbours included: it is what the home page means by "Dig the Extended Scene". The *cluster* is the dub techno core it was drawn from, which is what the seed measures and therefore what every tie is measured against. A grade reads "ties with the core dub techno cluster" and a label reads "% of roster in the dub techno cluster", while the About panel and the headline keep saying scene. Prose in this file still says "the scene" for the general idea; the rule is about strings a visitor reads.

**Two numbers on an artist are close enough to confuse and are not the same thing.** The grade comes from pass 1's tally, which counts APPEARANCES across the whole dump (someone on the artist line who also engineered the record counts twice) and only exists for artists who cleared the seed ratio. What a page displays is recomputed in `derive` as DISTINCT releases, for everyone. Pass 1 has Jeff Mills at 160 where the corpus holds 116. Do not quietly reconcile them by regrading on the displayed figure: that moves every dial under the acts they were pinned to, and it is a decision to take deliberately.

Ranking by frequency is central: collaborators and labels are ordered by count, never alphabetically. Frequency is the signal.

## Lineage — the editorial rules

Everything else in this corpus is derived. These are judgements, written down rather than hidden in a dial.

**The problem.** The seed measures work inside dub techno. By that measure King Tubby scores what the Spice Girls score, because `Dub` is only a seed style on genre `Electronic` and his catalogue is Dub on genre `Reggae`: 206 of his 221 corpus releases are invisible to the seed by construction. Underground Resistance scores the same, because `Techno` was kept out of the seed for being too broad. Defensible as graph output, wrong as an answer a digger would accept.

**No measure of the scene fixes it, and that was proved before reaching for a rule.** Bob Marley has 123 seed releases to King Tubby's 15, Madonna 106, Depeche Mode 75. On connection strength Madonna has 63 ties into the seed and Mozart 75, against Tubby's 57. Every threshold that lifts Tubby lifts Madonna higher. "Ancestor of" is a historical fact and style co-occurrence cannot express it, so it is asserted instead.

**The six traditions**, dialled in `ingest/src/config.ts` and asserted by `check-corpus` in both directions. Two mechanisms: `byTag`, what an artist records (a style, a genre, or a style gated by a genre), and `byLabel`, where they released it (a curated list of label IDs).

| | mechanism | dials | floor | tagged / lifted |
|---|---|---|---|---|
| `roots dub` | style `Dub` on genre `Reggae` | 5+, 20% | medium | 3,896 / 1,560 |
| `reggae` | genre `Reggae`, any style | 5+, 20% | **low** | 3,274 / 1,866 |
| `detroit techno` | ten Detroit imprints, by label ID | 3+, 10% | medium | 255 / 192 |
| `afrobeat` | style `Afrobeat` | 5+, 20% | medium | 209 / 132 |
| `uk jazz` | Brownswood and eight neighbouring rooms | 2+, 10% | medium | 193 / 145 |
| `acid jazz and DNB` | Talkin' Loud | 3+, 10% | **low** | 88 / 60 |

**The dub line runs three deep, and the floors say so.** Dub techno came out of dub, dub came out of reggae. So `roots dub` lifts to medium, `reggae` lifts one step to low, and a pop record lifts not at all: King Tubby medium, Toots & The Maytals low, Spice Girls very low. `reggae` runs last in `byTag` so anything more specific claims the artist first, which is why a Jamaican dub engineer reads `roots dub` rather than `reggae`.

**Rules about the rules:**
- **A tradition lifts to its floor and no further.** It cannot promote someone past the floor and cannot demote someone already above it. `scene_relevance` keeps the measurement, so the page never implies cluster work that is not in the data. Which grades a floor may raise is `lineage.liftsFrom`.
- **One tag per artist, tags before labels, then array order, first match wins.** A Jamaican player who also cut for Metroplex reads `roots dub`. Gilles Peterson reads `uk jazz` rather than `acid jazz and DNB`, which is why that pair is ordered the way it is.
- **They are not the same claim, and the interface must not flatten them.** Roots dub and Detroit are descent ("grew out of", "the tradition Berlin was answering"). Afrobeat and uk jazz are kinship ("keeps company with", "the scene around Gilles Peterson and Brownswood"). Acid jazz and DNB is inheritance at one remove, which is why it is the one tradition that lifts a single step. Keep those wordings distinct.
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
- **Show data absence honestly.** "No credits recorded" must be visibly distinct from "worked solo." Never render an empty result that looks like a positive answer. The same honesty extends to connection strength: relevance grades and the collaborator/label-mate distinction exist so a peripheral artist looks peripheral. Never present a weak tie as a strong one. And it runs the other way too: a grade the corpus cannot measure must not be reported as a low score. That is what Lineage is for, and why a lifted grade always says it was lifted.
- **One question, one vocabulary.** Relevance reads in the same four steps wherever it appears, with the reason for the step alongside it in grey. A page that answers "how close to the scene" in words its own search results do not use is two scales sharing a heading.

### Density, and the design that delivers it

The original rule read "Density is a feature. Small type, tight rows, lots on screen," enforced as `--spacing: 0.2rem` and a shrunken text scale. Simone suspended it on 2026-08-06 to open the design question, and the design has since landed. It reaches the same goal by a different route, so the design is now the rule. The baseline it replaced is tagged `ui-baseline-v0`.

Everything below is set in `web/src/styles/globals.css` as tokens and three utilities. Read that file before adding a size, a grey, or a spacing value.

- **Spacing is Tailwind's default scale.** There is no `--spacing` override and there should not be one. The vertical rhythm is deliberately open: page heads at `pt-16 pb-16 md:pt-24`, labelled bands at `py-14`, list rows at `py-[18px]`, identity rows at `py-2`. Do not tighten these to fit more in.
- **Density comes from the ink ramp and the mono, not from crushed spacing.** Four greys below `ink-strong` let one row carry a name, a count, a role string and a year without any of it shouting, and structural text sits at 0.6875–0.8125rem against a 1.25rem name. A page holds a lot because most of it is quiet, not because it is small.
- **The ramp has a floor, and it is a contrast floor.** `ink` `#f2f2f2` 18.10:1 · `ink-muted` `#9a9a9a` 7.20:1 · `ink-dim` `#8a8a8a` 5.87:1 · `ink-faint` `#7a7a7a` 4.72:1, all against `bg` `#060606`. The bottom two were `#787878` and `#6a6a6a`, and the latter came to 3.75:1, under the 4.5:1 that normal text has to clear while carrying every column heading, count, year and the whole footer. The three quiet greys are now 16 apart in hex, which is what makes them read as a ramp rather than as drift. **A new grey has to clear 4.5:1 or it is not a grey, it is a bug.**
- **Two families, split by job.** Helvetica Neue for names and headlines. IBM Plex Mono, uppercase and letterspaced, for everything structural: labels, counts, roles, meta, controls. The `mono-label` utility is that pattern written down, so use it rather than respelling it.
- **Display type is fluid, reading type is fixed.** `--text-hero`, `--text-name`, `--text-name-label` and `--text-stat` are clamps, because the handoff's pixel sizes are wider than a phone (a 104px "Moritz von Oswald" needs 900px of viewport). `--text-row`, `--text-lead` and `--text-body` are fixed. Add a new size only if the design has one.

  Prose reads at two of those, split by job rather than by page. `--text-lead` (1.1875rem) is the paragraph directly under a headline, a subheading doing a headline's work. `--text-body` (1.0625rem) is prose you settle into: a bio, the bands on the Info page. Both carry their line height on the token itself, so a paragraph asks for a size and gets the leading that belongs to it. Do not respell it with a `leading-*` class.
- **Hairlines, not borders.** `--color-hairline`, `--color-hairline-soft`, `--color-edge`, `--color-edge-strong`: separation without drawing a box. One accent, `#6fcabd`, spent on the eyebrow, the two headline stops, link hover, and a high grade. Spending it more widely is exactly what stops it working. `edge` is 1.86:1 and is decoration only; anything that is the boundary of a control wears `edge-strong` at 3.08:1.
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
- **Anything that discloses says so.** `aria-expanded` on the bio toggle, `aria-current` on nav cells, tabs and the sort control, `aria-label` on both `<nav>` elements ("Sections" and "Lists").
- **Every SVG is `aria-hidden`**, and anything that leaves the site says so in its accessible name.
- **Motion is guarded.** All three scripted animations check `prefers-reduced-motion` (drawer, collapsing bio, figures count-up), and so does the drawer's stylesheet.
- **`autofocus` is the hero field's, and only while it is empty.** On a results page it jumped a reader past the answer.

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
| scroll hold | 300 | every page |
| collapsing bio | 1,279 | artist and label |
| figures count-up | 644 | home |

Heaviest page is an artist or label at **18,718 bytes**. The router is 86% of it and is deliberate: the premise is that a pivot costs one click, so the document is swapped rather than reloaded. The four inline scripts are the whole of the rest, and a fifth needs the same argument those four made.

**Prefer the server, then a link, then a script.** Tabs, pagination and search are links and a plain GET form carrying state in the URL. That is what keeps a 556-row roster from being serialised into the page as JSON, and what makes every view a real address. Only reach for a script when the answer genuinely is not knowable on the server: the collapsing bio qualifies, because whether the text overflows depends on the rendered line count at this viewport; the scroll hold qualifies, because where the reader was is not something a server response can carry; the count-up qualifies, because whether the band has been scrolled to is not either. A fragment was tried for the scroll hold first and could only say "put the tab bar at the top", which still moves the page. It is one script in the layout, keyed on `data-hold-scroll`, serving the tab bar, the sort control and "Load more": the same script three times would cost the budget three times.

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
- **The sitemap lists the core, not the corpus.** 1,807 URLs: four static pages plus the top 1,000 artists and 803 labels the Core pages already rank, generated per request in `web/src/pages/sitemap.xml.ts` because `/artist/[id]` has no static paths to enumerate. The other half million pages stay reachable by link. Nothing invites a bot to walk 534,527 SQLite queries on a one-core VPS: this is discovery, not exhaustiveness.
- **`lastmod` is the database's mtime, for every URL.** Every page is derived from that one file, so it is the honest answer for all of them. Nothing in the corpus records when a credit was entered, and a date that moves when it should not teaches an engine to distrust the file.
- **The JSON-LD graph credits the tool, never the data.** A `WebSite` node and a per-page node, cross-referenced by `@id`, plus `BreadcrumbList` on inner pages. `creator` is a `Person` on the `WebSite` and appears nowhere else, because the split is the whole claim: the tool is Simone's, the credits are typed in by Discogs contributors. An `author` on a page node would take thousands of people's work and put one name on it, so there is deliberately none. There is no `Organization` and no `publisher` either, since there is no company and inventing one to fill a recommended field would assert something the pages do not. The footer states the same split in words, and the markup is only that sentence again. The one soft claim is `MusicGroup` on artist pages, which is wrong for the engineers and sleeve designers who hold Discogs artist ids, and is still the least wrong type available.
- **IndexNow is a manual step after deploy**, `npm run indexnow --workspace web`. It reads the URL list off the deployed sitemap, so it cannot ping ahead of the upload that proves ownership.

## Working style

- Build one plan-step at a time; commit after each.
- When something looks like it needs an out-of-scope feature, stop and say so rather than pulling it in.
- Prefer boring, legible solutions over clever ones. This is a tool to be maintained by one person.
- Comments in this codebase carry the reasoning, not the mechanics. When you change a decision, change the comment that argued for the old one.
