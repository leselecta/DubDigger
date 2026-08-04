# Dub Digger

A crate-digging tool built on Discogs credit data. Type an artist, see who they
worked with and what labels they released on, then click any of those and keep
digging.

Design rationale lives in [case-study-credit-graph.md](case-study-credit-graph.md).
Working rules live in [CLAUDE.md](CLAUDE.md).

## The shape of it

Two workspaces, and the boundary between them is the point:

| | |
|---|---|
| [`ingest/`](ingest/) | Offline, run rarely. Streams the Discogs dumps, selects the corpus, precomputes rankings into SQLite. All the hard work is here. |
| [`web/`](web/) | Online, trivial. A Next.js app that reads one small read-only SQLite file. No DB server, no API calls, no dump parsing. |

The app never parses a dump and never hits the Discogs API. If a feature needs
more than a `SELECT` against a precomputed table, it belongs in ingest.

## Setup

```sh
nvm use          # Node 22+
npm install      # installs both workspaces
npm test         # ingest test suite
```

## Ingest

### 1. Get the dumps

```sh
npm run fetch-dumps --workspace ingest
```

Downloads the latest monthly `artists`, `labels` and `releases` dumps into
`ingest/data/dumps/`. They stay gzipped: releases is ~11 GB compressed and
**100+ GB uncompressed**, so it is only ever read as a stream. Never gunzip it
to disk.

Fetch just one with `-- --only releases`.

### 2. Make a sample first

```sh
npm run make-sample --workspace ingest -- releases
```

Writes a well-formed 5,000-record copy to `ingest/data/samples/`. Prove every
pass correct against this before pointing anything at the full file. A full
releases pass is a multi-hour commitment; a sample pass takes a second.

### 3. Run the passes

Not built yet. See "Where this is up to" below.

## Configuration

Every dial lives in [`ingest/src/config.ts`](ingest/src/config.ts). Nothing is
tuned by editing a pass script.

| Dial | Default | What it does |
|---|---|---|
| `SEED_STYLES` | Dub Techno, Deep Techno, Dub, Ambient, Minimal | Pass 1 seed set. Techno is deliberately excluded: too broad, it would dilute the core. |
| `seedLabel.minSeedArtists` | `2` | Floor. Stops a tiny label qualifying on one coincidence. |
| `seedLabel.minSeedArtistRatio` | `0.05` | Concentration. Stops a 500-artist label qualifying because one seed artist released there once. |
| `expansion.channelAMinSharedReleases` | `1` (off) | Raise to `2` only if the one-hop corpus balloons. Filters one-off guest spots. |
| `PLACEHOLDER_ARTIST_IDS` / `NAMES` | `194`, "Various" et al. | Keeps Discogs placeholders out of the collaboration logic. Verify the IDs against the artists dump before the first full run. |

These numbers are starting points, not answers. **Measure between passes.** Pass 1
reports the seed artist and seed label counts; those are the steering signals.
Pass 2 reports release and artist counts per channel. Read them before committing
to a full run: too big, tighten the dials; too thin, loosen them.

Both seed sets persist to `seed_artists` and `seed_labels`, so pass 2 can be
re-run with different dials without redoing pass 1.

## Web app

```sh
npm run dev      # http://localhost:3000
```

Point it at a database with `DUBDIGGER_DB`, or drop the file at
`web/data/dubdigger.sqlite`. With no database present the home page says so
plainly rather than rendering an empty search that looks like an answer.

## Where this is up to

- [x] Workspaces, schema, streaming release parser, dump CLIs
- [x] Web shell with the density baseline and honest empty state
- [ ] Pass 1 — style seed: seed artists, then seed labels via floor + ratio
- [ ] Pass 2 — one hop out on both channels, with provenance tagging
- [ ] Artists and labels dumps into the entity tables
- [ ] Derived tables: collaborators, labels, rosters, coverage flags
- [ ] Artist, label and search pages

## Licensing

Discogs **dump data is CC0**. Images are not, and are not in the dumps: v1 has
no images and makes no API calls. Do not introduce either without re-reading the
licensing note in [CLAUDE.md](CLAUDE.md).
