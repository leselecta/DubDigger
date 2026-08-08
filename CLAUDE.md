# CLAUDE.md

Project brief and working rules for this repository. Read this before generating code.

## What this is

A crate-digging tool built on Discogs credit data. The core loop: **type an artist, see who they worked with and what labels they released on, then click any of those to keep digging.** A map of scenes, drawn from credits.

The user is a music nerd who reads Discogs pages for fun — not a casual listener. Design for information density and fast pivoting, not for a gentle onboarding.

**For the full design rationale — why ranked lists beat a graph, the competitive research that led there, and the Gall's Law scoping reasoning — see `case-study-credit-graph.md` in this repo.** This file (CLAUDE.md) states the resulting rules; the case study explains why they're the right rules. When a decision isn't covered by a rule below, reason from the case study's logic rather than defaulting to a generic pattern.

## Scope (v1) — hold this line

Deliberately small, per Gall's Law: a working simple system first.

- **One data source:** Discogs monthly XML dumps (CC0 licensed). No live API in v1.
- **Two entities:** Artist and Label.
- **Edges:** collaboration (two artists co-credited on a release) and label (a release's label). Tracks are NOT a top-level entity — they surface *through* collaborations and labels.
- **Corpus:** a dub-techno-centred slice, selected by the two-pass, two-channel strategy below — NOT the whole Discogs catalogue.

### Explicitly OUT of scope for v1 — do not add these unprompted
- MusicBrainz integration / dual-source model
- Role-string normalisation into a controlled vocabulary
- Alias/project resolution beyond what Discogs already provides
- Provenance markers
- Graph / force-directed visualisation in v1 (potential v2 feature, see "Future considerations: Graph view" in `case-study-credit-graph.md`)
- Images of any kind in v1 (see licensing note below). **Named as v1.1, not a same-week addition — see "Deferred: images (v1.1)" below.**
- NTS or any second data source

Each is a later evolution of a working core. If a task seems to need one of these, stop and flag it rather than building it.

## Architecture — the key boundary

**All heavy work happens offline, on the developer's machine. The server only ever reads a small precomputed SQLite file.**

- **Ingest** (offline, run rarely): stream-parse the ~100+ GB Discogs releases dump, select the corpus, project to a thin field set, write raw SQLite tables, then precompute aggregations into query-ready derived tables.
- **App** (online, trivial): an Astro app that reads the derived SQLite file read-only. No database server, no Redis, no search cluster.

Keep ingest scripts entirely separate from the web app. The app must never parse a dump or hit the Discogs API.

## Corpus selection — the two-pass, two-channel strategy (important, non-obvious)

The goal is a corpus centred on dub techno but wide enough to include *neighbours of the scene* — both people who collaborated with a core artist, AND people who share a label with a core artist without ever working with them directly (label-mates). A naive single-pass style filter keeps the right records but LOSES both kinds of neighbour. Do NOT implement a single-pass style filter, and do NOT expand via collaboration only — the label view needs label-mate expansion too, or label rosters will be silently incomplete. Use two passes, with two expansion channels in the second:

**Understanding the Discogs style data first:**
- A release carries multiple `<styles>` at once (many-to-many). A record can be tagged `Dub Techno, Techno, Minimal` simultaneously.
- The style facet counts on Discogs search are co-occurrence within the current result set, not global totals — irrelevant to ingest, but don't be misled by them.

**Pass 1 — style seed (selects records → seed artists → seed labels):**
- Stream the releases dump. Keep releases whose `<styles>` intersect the tight core set: `{Dub Techno, Deep Techno, Dub, Ambient, Minimal}`. Deliberately NOT Techno (too broad — it would dilute the core).
- Collect the set of all artist IDs credited on these releases → the **seed artist set**.
- Derive the **seed label set**: every label a seed artist released on. A label qualifies as seed only if BOTH hold: (a) it has at least 2 seed artists in its roster (a floor, guarding against a tiny label qualifying on one coincidence), AND (b) seed artists are at least ~5% of its total artist roster (a ratio, guarding against a large label qualifying because one seed artist released on it once). Flat counts alone don't work — a 500-artist label clearing "2+ seed artists" is noise, not signal; the threshold must scale with label size. Both numbers are tunable dials, set initial values and adjust after measuring real output. "Total artist roster" = whole catalogue on that label as captured in this dump, not a time-windowed subset, for v1 simplicity — accept some dilution on long-running labels as the trade-off.
- Hold both sets in memory (tens of thousands of IDs is fine) AND persist both as saved artifacts (see below).

**Pass 2 — one hop out, two channels (selects people → their releases):**
- Stream the releases dump AGAIN. Keep a release if EITHER channel applies:
  - **Channel A — collaboration:** the release credits an artist in the seed artist set. Captures neighbours like Blawan: they enter via a real collaboration with a seed artist, bringing all their other credits with them.
  - **Channel B — label membership:** the release is on a label in the seed label set. Captures pure label-mates: artists who share a label with the scene but never personally collaborated with a seed artist. Without this channel, label roster pages will be missing exactly the artists a "who else is on this label" query is meant to surface.
- Harvest artist IDs from ALL kept releases (both channels) → the expanded one-hop artist set.
- Union pass-1 and pass-2 releases = the corpus.

**Rules and dials:**
- **Stop at one hop, on both channels.** Two hops (neighbours of neighbours, or labels of label-mates' other labels) explodes outward and eventually drags in most of Techno — defeating the point.
- **Tag provenance per artist/release: Channel A, Channel B, or both.** These are different strengths of connection — a collaborator is not the same as a label-mate — and the UI must be able to show that distinction (see "Show data absence honestly" — the same honesty principle extends to connection strength; never present a label-mate as if they "collaborated").
- **Optional minimum-tie-strength dial (Channel A):** only admit a non-seed artist if they appear on 2+ seed-artist releases (filters one-off guest spots). Start WITHOUT this; add only if the one-hop corpus comes out too large.
- **Minimum-tie-strength dial (Channel B, not optional):** the floor-plus-ratio rule specified above — a label only becomes "seed" via both a minimum seed-artist count and a minimum concentration ratio. Watch this closely: a single prolific label with thousands of releases could dominate the corpus if admitted on a thin tie, which is a bigger risk than the collaboration hop.
- **Measure between passes.** The corpus size is data-dependent and unpredictable. After pass 1, report the seed artist count AND the seed label count — these are the steering signals. Then run pass 2 and report the resulting release/artist counts per channel BEFORE committing. If it balloons, tighten the tie-strength dials or seed styles; if thin, loosen them.
- **Persist the seed artist set and seed label set as saved files**, not just in-memory intermediates. They're the definitional core of the corpus — needed for debugging ("why is this person/label in?"), for the Channel A/B/both provenance marker in the UI, and for re-running pass 2 with different parameters without redoing pass 1.

The nice property: the corpus boundary uses the same "related via collaboration or label" logic the tool itself surfaces. Dataset and product share one definition of related.

## The data (Discogs XML dumps)

Four monthly gzipped XML files: `artists`, `labels`, `masters`, `releases`. We use `artists`, `labels`, and `releases` (skip `masters` in v1).

The `releases` file is enormous (100+ GB uncompressed) and holds the credits. Everything about performance is about not paying full freight on it.

### XML quirks to handle
- **Credits live in `<extraartists>`** — an artist reference plus a free-text `<role>` string. Roles are uncontrolled: `Engineer`, `Engineer [Recording]`, `Recorded By` may all mean the same thing. In v1 we do NOT normalise these — store the raw string and **log every distinct role encountered** for later. Never silently drop an unmapped or unexpected role.
- **Multi-artist join phrases** — releases and credits can list multiple artists with join text ("feat.", "&"). Preserve the artist IDs; don't parse the join phrase semantically in v1.
- **Aliases and name variations** exist in the `artists` dump. Use what Discogs gives directly; do not attempt cross-entity alias resolution in v1.
- **Various-artists releases** have a special artist reference — handle without crashing the collaboration logic.
- **Styles vs. genres** — filter the corpus on `<styles>` (finer-grained), not `<genres>`.

## Ingest rules

- **Always stream** with `iterparse`-style parsing; `clear()` each element after extraction. Never load a dump into memory whole. (The seed-artist ID set is the one thing held in memory — that's fine.)
- **Project aggressively** — keep only: release ID, artists + roles, `extraartists`, label ref, tracklist. Discard everything else (formats, country, notes, matrix, companies, identifiers).
- **Develop against a truncated copy first** (first few thousand releases). Prove correctness on the small file before running the full ingest.
- **Re-ingest is deliberate, not runtime** — the SQLite file is a static artifact regenerated occasionally, never refreshed by the app.

## Data model

Raw tables (from ingest): `releases`, `release_artists`, `release_credits`, `release_labels`, `artists`, `labels`. Plus the persisted `seed_artists` and `seed_labels` sets.

Derived tables (precomputed, what the app reads):
- `artist_collaborators` — per artist, co-credited people ranked by shared-release count, with roles held
- `artist_labels` — per artist, labels with release counts and date ranges
- `label_roster` — per label, artists ranked by release count
- coverage flags per artist — distinguish "no credits recorded" from "worked solo"; seed vs. one-hop membership, tagged with provenance (Channel A collaboration / Channel B label-membership / both)
- `scene_relevance` per artist — the measurement: `high` / `medium` / `low` graded on seed release count AND seed share of their whole output (both, since either alone misranks); `none` for one-hop artists with no seed work, where the provenance above is what the UI shows instead. Dials in `ingest/src/config.ts`, pinned to named acts and asserted by `check-corpus`.
- lineage per artist — a tradition the scene came out of or keeps company with: `roots dub`, `reggae`, `detroit techno`, `afrobeat`, `uk jazz`, `acid jazz and DNB`, or NULL. See "Lineage" below.
- `relevance` per artist — **what the interface shows**: `scene_relevance`, raised to the tradition's floor when a lineage applies. One scale, one column, so a result reads the same in search as on its page.

Never show `relevance` as a bare word where there is room to say what it stands on. Two different things put an artist on a step, and a page that says "medium" without saying which is claiming cluster work that may not exist. The artist page pattern: `Medium, very weak ties with the core dub techno cluster, here for lineage: roots dub, the Jamaican tradition dub techno grew out of`. The search results column is the one place the word stands alone, and that is a known cost of merging, not a licence to do it elsewhere.

**Scene and cluster are not synonyms in the interface.** The *scene* is the whole extended map this tool draws, neighbours included: it is what the home page means by "Dig the Extended Scene". The *cluster* is the dub techno core it was drawn from, which is what the seed measures and therefore what every tie is measured against. So a grade reads "ties with the core dub techno cluster" and a label reads "% of roster in the dub techno cluster", while the About panel and the headline keep saying scene. Prose in this file still says "the scene" for the general idea; the rule is about strings a visitor reads.

Two numbers on an artist are close enough to confuse and are not the same thing. The grade comes from pass 1's tally, which counts APPEARANCES across the whole dump (someone on the artist line who also engineered the record counts twice) and only exists for artists who cleared the seed ratio. What a page displays is recomputed in `derive` as DISTINCT releases, for everyone. Pass 1 has Jeff Mills at 160 where the corpus holds 116. Do not quietly reconcile them by regrading on the displayed figure: that moves every dial under the acts they were pinned to, and it is a decision to take deliberately.

Ranking by frequency is central: collaborators and labels are ordered by count, never alphabetically. Frequency is the signal.

## Lineage — the editorial rules

Everything else in this corpus is derived. These are judgements, written down rather than hidden in a dial.

**The problem.** The seed measures work inside dub techno. By that measure King Tubby scores what the Spice Girls score, because `Dub` is only a seed style on genre `Electronic` and his catalogue is Dub on genre `Reggae`. Underground Resistance scores the same, because `Techno` was kept out of the seed for being too broad. Defensible as graph output, wrong as an answer a digger would accept: those two traditions are where this music comes from.

**No measure of the scene fixes it, and that was proved before reaching for a rule.** Bob Marley has 123 seed releases to King Tubby's 15, Madonna 106, Depeche Mode 75. On connection strength Madonna has 63 ties into the seed and Mozart 75, against Tubby's 57. Every threshold that lifts Tubby lifts Madonna higher. "Ancestor of" is a historical fact and style co-occurrence cannot express it, so it is asserted instead.

**The six traditions**, all dialled in `ingest/src/config.ts` and asserted by `check-corpus` in both directions. Two mechanisms: `byTag`, what an artist records (a style, a genre, or a style gated by a genre), and `byLabel`, where they released it (a curated list of label IDs).

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
- **Adding a tradition is an editorial decision, not a config tweak, and the bar rose when the axes merged.** A tradition no longer annotates a grade, it sets one, and the results column shows the word with no room for the reason. Argue it here first, with the numbers that separate it from the acts it must not catch. The full story, and why this project stopped being purely derived, is in `case-study-credit-graph.md` under "When the measure ran out".

## UI principles

These three are load-bearing and hold regardless of how the interface looks:

- **Ranked lists over graphs.** Sorted by strength, lists answer "who matters here" on sight. No graph in v1.
- **One click to pivot.** Every artist, label, and release is a link to its own page. Digging is hopping between pages, not composing a query.
- **Show data absence honestly.** "No credits recorded" must be visibly distinct from "worked solo." Never render an empty result that looks like a positive answer. The same honesty extends to connection strength: relevance grades and the collaborator/label-mate distinction exist so a peripheral artist looks peripheral. Never present a weak tie as a strong one. And it runs the other way too: a grade the corpus cannot measure must not be reported as a low score. That is what Lineage is for, and why a lifted grade always says it was lifted.
- **One question, one vocabulary.** Relevance reads in the same four steps wherever it appears — the results column, the artist page, the label page — with the reason for the step alongside it in grey. A page that answers "how close to the scene" in words its own search results do not use is two scales sharing a heading.

### Density, and the design that delivers it

The rule used to read "Density is a feature. Small type, tight rows, lots on screen. Resist framework default whitespace, go tighter than Tailwind wants," enforced as `--spacing: 0.2rem` and a shrunken `--text-*` scale. Simone suspended it on 2026-08-06 to open the design question, and the design has since landed. It reaches the same goal by a different route, so the design is now the rule. The baseline it replaced is tagged `ui-baseline-v0`.

Everything below is set in `web/app/globals.css` as tokens and three utilities. Read that file before adding a size, a grey, or a spacing value.

- **Spacing is Tailwind's default scale.** There is no `--spacing` override and there should not be one. The vertical rhythm is deliberately open: page heads at `pt-16 pb-16 md:pt-24`, labelled bands at `py-14`, list rows at `py-[18px]`, identity rows at `py-2`. Do not tighten these to fit more in.
- **Density comes from the ink ramp and the mono, not from crushed spacing.** Four greys below `ink-strong` (`ink`, `ink-muted`, `ink-dim`, `ink-faint`) let one row carry a name, a count, a role string and a year without any of it shouting, and structural text sits at 0.6875–0.8125rem against a 1.25rem name. A page holds a lot because most of it is quiet, not because it is small.
- **Two families, split by job.** Helvetica Neue for names and headlines. IBM Plex Mono, uppercase and letterspaced, for everything structural: labels, counts, roles, meta, controls. The `mono-label` utility is that pattern written down, so use it rather than respelling it.
- **Display type is fluid, reading type is fixed.** `--text-hero`, `--text-name`, `--text-name-label` and `--text-stat` are clamps, because the handoff's pixel sizes are wider than a phone (a 104px "Moritz von Oswald" needs 900px of viewport). `--text-row` and `--text-body` are fixed. Add a new size only if the design has one.
- **Hairlines, not borders.** `--color-hairline`, `--color-hairline-soft`, `--color-edge`: separation without drawing a box. One accent, `#6fcabd`, spent on the eyebrow, the two headline stops, link hover, and a high grade. Spending it more widely is exactly what stops it working.
- **`link-rule` marks anything that pivots**, at whatever size the type is. With one accent and no room to spend it, that hairline is how a link is told apart from the text beside it.
- **The content column is the `column` utility**: 1200px, 1.5rem of gutter, 3rem from 768px up. Bands span the full width, their contents stay in the column.

The reasoning behind the original rule still holds as an input: the user reads Discogs pages for fun and wants information per scroll. The grid and the ink ramp are what serve it now. If a change would genuinely improve information per scroll, argue it against the design, not against the deleted rule.

## Stack

- Astro + TypeScript, `output: "server"` so every request reads the file on disk
- SQLite as a read-only file (no DB server)
- Tailwind v4, configured as tokens in `globals.css` (see Density above)
- Ingest: standalone Node/TypeScript scripts using a streaming XML parser
- Deploy: a single small VPS running the Node server alongside the SQLite file

**There is no UI framework, and adding one needs an argument.** Every page is `.astro`. React was here for a week and bought a hamburger menu and a counter for 184 KB, which is the whole case against it. Client behaviour is a `<script>` tag in the component that needs it, driving the DOM through `data-` attributes.

**Client JavaScript is 16 KB on every page, and that is the budget.** All of it is `ClientRouter`, which is deliberate: the premise is that a pivot costs one click, so the document is swapped rather than reloaded. Anything you add comes out of a budget that currently has one line item.

**Prefer the server, then a link, then a script.** Tabs, pagination and search are links and a plain GET form carrying state in the URL. That is what keeps a 556 row roster from being serialised into the page as JSON, and what makes every view a real address. Only reach for a script when the answer genuinely is not knowable on the server: the collapsing bio is the one that qualifies, because whether the text overflows depends on the rendered line count at this viewport.

**Scripts must survive a `ClientRouter` navigation.** A module `<script>` executes once, so bind work to `astro:page-load`, which fires on the first load and again after every swap. A script that only runs at parse time will silently stop working on the second page a visitor opens.

## Licensing note

Discogs **dump data is CC0** — free to use, including commercially, no attribution required. This is why we ingest dumps, not the API. **Images are NOT CC0** (they're "Restricted Data", not in the dumps, and carry caching/commercial limits) — one reason v1 has no images. Do not introduce Discogs API calls or images without revisiting licensing.

## Deferred: images (v1.1)

Genuinely wanted for the product — visual reference matters for digging, and record covers are how diggers recognise things. Deliberately deferred rather than dropped, because it breaks the core v1 architectural property: the server reads one precomputed static file, nothing else. Adding images means choosing one of two paths, neither free:

- **Cache at ingest time** — violates Discogs' terms directly (no storing Restricted Data beyond serving-time need, max 6 hours stale). Would need real re-architecture of the serving layer, not just a new column.
- **Fetch live from the API at display time** — legally cleaner, but introduces a live external dependency, new failure modes, mandatory attribution notices, and is the natural entry point for scope creep ("while we're calling the API for images, let's also pull fresh bios...").

**Cheap middle ground, available any time without touching architecture:** link out to the artist's Discogs page (`view on Discogs`) instead of fetching images inline. Zero licensing exposure, zero architecture change. Worth doing in v1 if it's low effort — it is NOT the same as inline images, so don't treat adding this link as "images are done."

When v1.1 is actually undertaken, decide consciously between the two paths above and update this section with the choice and its reasoning.

## Working style

- Build one plan-step at a time; commit after each.
- When something looks like it needs an out-of-scope feature, stop and say so rather than pulling it in.
- Prefer boring, legible solutions over clever ones — this is a tool to be maintained by one person.
