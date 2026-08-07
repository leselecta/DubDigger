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
- **App** (online, trivial): a Next.js app that reads the derived SQLite file read-only. No database server, no Redis, no search cluster.

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
- relevance per artist — `high` / `medium` / `low` graded on seed release count AND seed share of their whole output (both, since either alone misranks); `none` for one-hop artists with no seed work, where the provenance above is what the UI shows instead. Dials in `ingest/src/config.ts`, pinned to named acts and asserted by `check-corpus`.

Ranking by frequency is central: collaborators and labels are ordered by count, never alphabetically. Frequency is the signal.

## UI principles

These three are load-bearing and hold regardless of how the interface looks:

- **Ranked lists over graphs.** Sorted by strength, lists answer "who matters here" on sight. No graph in v1.
- **One click to pivot.** Every artist, label, and release is a link to its own page. Digging is hopping between pages, not composing a query.
- **Show data absence honestly.** "No credits recorded" must be visibly distinct from "worked solo." Never render an empty result that looks like a positive answer. The same honesty extends to connection strength: relevance grades and the collaborator/label-mate distinction exist so a peripheral artist looks peripheral. Never present a weak tie as a strong one.

### Density: suspended, pending the design pass

This used to read "Density is a feature. Small type, tight rows, lots on screen. Resist framework default whitespace, go tighter than Tailwind wants," and it was enforced as `--spacing: 0.2rem` plus a reduced `--text-*` scale in `web/app/globals.css`.

Simone suspended it on 2026-08-06 to open up the design question: "I want to start thinking of the design without those constraints at first." A design drafted elsewhere is now being implemented here.

**Until that design lands, do not tighten spacing or shrink type unprompted, and do not cite the old rule as a constraint.** Follow what the design specifies. The reasoning behind the original rule still stands and is worth weighing (the user reads Discogs pages for fun and wants information per scroll), but it is an input to the design now, not a veto over it.

**When the design is implemented, replace this section with the spacing and type rules it actually settles on**, so the written rule and the shipped interface stop disagreeing. The baseline it replaces is tagged `ui-baseline-v0`.

## Stack

- Next.js + TypeScript, server components for the dense pages
- SQLite as a read-only file (no DB server)
- Tailwind, spacing and type scale set by the design pass (see UI principles)
- Ingest: standalone Node/TypeScript scripts using a streaming XML parser
- Deploy: a single small VPS running the Next.js process alongside the SQLite file

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
