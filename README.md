# Dub Digger

**Follow the credits, not the algorithm.**

Every record is made by more people than the cover admits. A producer, a mixing
engineer, a bassist who turns up on four other records you already love. That web
of credits is how crate diggers actually find music, and it all sits in Discogs.
It just isn't shaped for digging.

Dub Digger reshapes it. Type an artist, see who they worked with and what labels
they released on, then click any of those and keep going. A map of scenes, drawn
from credits.

> **Status: in development.** The ingest foundation and the web shell are built.
> The corpus passes and the artist and label pages are not. See
> [Roadmap](#roadmap).

The full design rationale is in
[case-study-credit-graph.md](case-study-credit-graph.md). The working rules for
the codebase are in [CLAUDE.md](CLAUDE.md).

## The bet: ranked lists, not a graph

The obvious version of this product is a force directed graph. Artists as nodes,
collaborations as edges, a cloud you can pan around. It looks great in a
screenshot.

A Discogs powered collaboration graph already exists, so I used it as research
rather than treating it as a dead end. Two things stood out. The graph answered
"is everything connected" (yes, always) but not the question I actually had:
*who matters here?* And its table was a log, one row per credit, unranked.
Complete, but useless for reading the shape of a career at a glance.

So the differentiator is not a prettier graph. It is **aggregation**. A
collaborator list sorted by shared releases puts the person who appears on nine
records at the top, where they belong. Frequency is the signal, and a list
encodes it natively while a graph hides it in edge thickness you have to eyeball.

This is the decision I would defend hardest, because it is counterintuitive: the
product is deliberately less impressive on the surface, because the impressive
version answered the wrong question.

Three rules follow from it, and the interface holds them everywhere:

- **Density is a feature.** Small type, tight rows, a lot on screen. The user
  reads Discogs pages for fun and wants information per scroll, not breathing
  room.
- **One click to pivot.** Every artist, label and release is a link to its own
  page. Digging is a sequence of hops, not a query you compose.
- **Absence shown honestly.** Credit data is contributed by volunteers, so it is
  uneven, and silently so. "No credits recorded" and "worked solo" are different
  answers, and the interface has to say which. An empty result that looks like an
  answer is worse than an honest "no data here".

## How it works

Two workspaces, and the boundary between them is the whole point.

| | |
|---|---|
| [`ingest/`](ingest/) | Offline, run rarely. Streams the Discogs dumps, selects the corpus, precomputes the rankings into SQLite. All the hard work lives here. |
| [`web/`](web/) | Online, trivial. A Next.js app that reads one small read only SQLite file. No database server, no Redis, no search cluster. |

The Discogs releases dump is over 100 GB of XML uncompressed. Instead of standing
up infrastructure to handle that, it gets processed once on a laptop: stream
parsed, cut to the fields the tool needs, filtered to the corpus, and reduced to a
small file of precomputed answers.

The result is that the product is trivial to run and hostable on the cheapest box
there is. The complexity lives in a one off step the user never touches.

**The app never parses a dump and never calls the Discogs API.** If a feature
needs more than a `SELECT` against a precomputed table, it belongs in ingest.

## The corpus

Not all of Discogs. A slice centred on dub techno, wide enough to include the
neighbours of the scene.

The naive approach is a single style filter. It keeps the right records but loses
the neighbours, and the neighbours are the interesting part. So selection runs in
two passes, and the second pass expands through two separate channels.

**Pass 1, style seed.** Keep releases whose styles intersect a tight core set.
The artists on those releases become the seed artist set. A label becomes a seed
label if enough of its roster are seed artists, by both a floor and a ratio.

**Pass 2, one hop out.** Stream the dump again and keep a release if either
channel applies:

- **Channel A, collaboration.** The release credits a seed artist. This catches
  people who enter through real collaboration and bring all their other credits
  with them.
- **Channel B, label membership.** The release is on a seed label. This catches
  pure label mates: artists who share a label with the scene but never personally
  worked with a seed artist.

Both channels are needed. Expanding only through collaboration leaves label
rosters silently incomplete, which breaks the exact query a label page is meant to
answer.

Expansion stops at one hop on both channels. Two hops explodes outward and
eventually drags in most of techno, which defeats the point.

Every artist and release is tagged with how it entered: Channel A, Channel B, or
both. A collaborator is not the same as a label mate, and the interface has to be
able to show that difference rather than presenting a label mate as if they had
worked with someone.

The nice property: the corpus boundary uses the same "related via collaboration or
label" logic the tool itself surfaces. The dataset and the product share one
definition of related.

## Setup

```sh
nvm use          # Node 22+
npm install      # installs both workspaces
npm test         # ingest test suite
npm run typecheck
```

## Running the ingest

### 1. Get the dumps

```sh
npm run fetch-dumps --workspace ingest
```

Downloads the latest monthly `artists`, `labels` and `releases` dumps into
`ingest/data/dumps/`. They stay gzipped. Releases is roughly 11 GB compressed and
**over 100 GB uncompressed**, so it is only ever read as a stream. Never gunzip it
to disk.

Fetch a single one with `-- --only releases`.

### 2. Make a sample first

```sh
npm run make-sample --workspace ingest -- releases
```

Writes a well formed 5,000 record copy into `ingest/data/samples/`. Prove every
pass correct against this before pointing anything at the full file. A full
releases pass is a multi hour commitment. A sample pass takes a second.

### 3. Run the passes

Not built yet. See [Roadmap](#roadmap).

## Configuration

Every dial lives in [`ingest/src/config.ts`](ingest/src/config.ts). Nothing is
tuned by editing a pass script.

| Dial | Default | What it does |
|---|---|---|
| `SEED_STYLES` | Dub Techno, Deep Techno, Dub, Ambient, Minimal | The pass 1 seed set. Techno is deliberately left out: it is broad enough to dilute the core, and pass 2 already reaches into it through real connections. |
| `seedLabel.minSeedArtists` | `2` | Floor. Stops a tiny label qualifying on one coincidence. |
| `seedLabel.minSeedArtistRatio` | `0.05` | Concentration. Stops a 500 artist label qualifying because one seed artist released there once. |
| `expansion.channelAMinSharedReleases` | `1` (off) | Raise to `2` only if the one hop corpus balloons. Filters one off guest spots. |
| `PLACEHOLDER_ARTIST_IDS` / `NAMES` | `194`, "Various" and similar | Keeps Discogs placeholders out of the collaboration logic, where they would otherwise become the most collaborative artist in the database by a mile. Verify the IDs against the artists dump before the first full run. |

Flat counts alone do not work for labels. A 500 artist label clearing "2 or more
seed artists" is noise, not signal, so the bar has to scale with roster size.
That is why there is both a floor and a ratio.

These numbers are starting points, not answers. **Measure between passes.** Pass 1
reports the seed artist and seed label counts, which are the steering signals.
Pass 2 reports release and artist counts per channel. Read them before committing
to a full run. Too big, tighten the dials. Too thin, loosen them.

Both seed sets are persisted to the `seed_artists` and `seed_labels` tables, so
pass 2 can be re-run with different dials without redoing pass 1. They also answer
the debugging question "why is this person or label in the corpus at all?"

## Running the web app

```sh
npm run dev      # http://localhost:3000
```

Point it at a database with the `DUBDIGGER_DB` environment variable, or drop the
file at `web/data/dubdigger.sqlite`. With no database present the home page says
so plainly instead of rendering an empty search that looks like an answer.

## Stack

Next.js and TypeScript with server components for the dense pages, Tailwind with
a tightened spacing scale, and SQLite as a read only file. Ingest is standalone
Node and TypeScript scripts using a streaming XML parser. Deployment is a single
small VPS running the Next.js process next to the SQLite file.

## Roadmap

- [x] Workspaces, SQLite schema, streaming release parser, dump CLIs
- [x] Web shell, density baseline, honest empty state
- [ ] Pass 1, style seed: seed artists, then seed labels via floor and ratio
- [ ] Pass 2, one hop out on both channels, with provenance tagging
- [ ] Artists and labels dumps into the entity tables
- [ ] Derived tables: collaborators, labels, rosters, coverage flags
- [ ] Artist, label and search pages

## Deliberately out of scope for v1

Written down rather than forgotten. Each is a later evolution of a core that has
to work on its own first.

- MusicBrainz as a second source
- Normalising role strings into a controlled vocabulary (v1 stores them raw and
  logs every distinct one it sees)
- Alias resolution beyond what Discogs already gives
- A graph view (a possible v2, for the one job a graph is genuinely good at:
  the connection path between two artists)
- Images of any kind (see below)

## Licensing

Code is MIT, see [LICENSE](LICENSE).

Discogs **dump data is CC0**, free to use with no attribution required, which is
why this ingests dumps rather than calling the API.

**Images are not CC0.** They are Restricted Data, they are not in the dumps, and
they carry caching and commercial limits. That is one reason v1 has no images and
makes no API calls. Images are wanted and deliberately deferred, not dropped: see
the note in [CLAUDE.md](CLAUDE.md) before introducing either.
