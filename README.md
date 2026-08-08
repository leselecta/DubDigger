# Dub Digger

**Dig the extended scene. Dub Techno first. Following the credits, not the algorithm.**

Every record is connected to another, through the people who made it. A
producer, a mixing engineer, a bassist who turns up on four other records you
already like. An iconic, minor label you discover by picking up an obscure
release you love gives you access to a goldmine of new amazing titles. That web
of credits is how crate diggers actually find music, and it all sits in Discogs.
It just isn't optimised for digging this way.

Dub Digger reshapes it. Type an artist, see who they worked with and what labels
they released on, then click any of those and keep going. A map of scenes, drawn
from credits. No unwanted noise.

> **Status: working end to end.** The full pipeline runs against the 20260801
> dump and the app serves real data: **1,025,881 releases**, **420,575
> artists**, **113,952 labels**, in a **0.89 GB** file. See
> [Roadmap](#roadmap) for what is still open.

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
| [`web/`](web/) | Online, trivial. An Astro app that reads one small read only SQLite file. No database server, no Redis, no search cluster. |

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

Against the 20260801 dump that takes 19,341,287 releases down to roughly a
million:

| | |
|---|---|
| Pass 1, style seed | 250,337 releases, 132,571 seed artists, 18,498 seed labels of 105,202 candidates |
| Pass 2, channel A only | 574,048 releases |
| Pass 2, channel B only | 151,481 releases |
| Pass 2, both channels | 270,684 releases |
| Corpus | 1,025,881 releases, 420,575 artists, 113,952 labels |

288,004 of those artists arrived by the one hop and have no seed work of their
own. That is the majority of the corpus, and it is the point: they are the
neighbours a single style filter would have lost.

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

Downloads the monthly dumps into `ingest/data/dumps/` and verifies each one
against the published SHA-256 checksum. As of the August 2026 dump:

| File | Size |
|---|---|
| `discogs_YYYYMMDD_labels.xml.gz` | 86 MB |
| `discogs_YYYYMMDD_artists.xml.gz` | 472 MB |
| `discogs_YYYYMMDD_releases.xml.gz` | **10.4 GB** |

The files stay gzipped. Releases is **over 100 GB uncompressed**, so it is only
ever read as a stream. Nothing in this project ever expands it to disk.

Useful flags:

- `-- --only labels` fetches a single dump. Start here: it is the smallest, and
  it proves the whole path works before committing to the big one.
- `-- --date 20260801` pins a specific monthly dump instead of taking the newest.

**Two things to know about the source.** The S3 bucket that used to serve these
now refuses anonymous access, so downloads go through `data.discogs.com`. That
host sits behind Cloudflare and rate limits hard: trip it and you are locked out
for around 45 minutes, downloads included. The script fails immediately with the
wait time rather than hanging. It also does not honour range requests, so an
interrupted download restarts from zero rather than resuming. Run the releases
download when you can leave it alone.

### 2. Make a sample first

```sh
npm run make-sample --workspace ingest -- releases
```

Writes a well formed 5,000 record copy into `ingest/data/samples/`. Prove every
pass correct against this before pointing anything at the full file. A full
releases pass is a multi hour commitment. A sample pass takes a second.

### 3. Run the passes

```sh
npm run pass1 --workspace ingest            # against the newest sample
npm run pass1 --workspace ingest -- --full  # against the full dump
```

Defaults to the sample deliberately, so a stray command cannot start a multi
hour run. It reports the two steering signals, the seed artist count and the
seed label count, plus the top seed labels by name.

Read those names before going anywhere near `--full`. If they look like the
scene, the dials are right. If a major label is sitting at the top, tighten the
ratio and run it again.

Then the rest of the pipeline, in order:

```sh
npm run pass2 --workspace ingest -- --full   # one hop out, ~27 min
npm run entities --workspace ingest          # names, bios, search index
npm run derive --workspace ingest            # the ranked tables
npm run publish --workspace ingest           # writes web/data/dubdigger.sqlite
npm run check-corpus --workspace ingest      # acceptance test, exits non-zero
```

Pass 1 takes about 28 minutes against the 20260801 dump and pass 2 about 27,
each reading all 19,341,287 releases. `entities` is a minute, `derive` three.
Roughly an hour from dumps to a served file.

`publish` is not a copy. It drops the raw tables the app never reads and goes
through `VACUUM INTO`, which matters: copying a `.sqlite` leaves its
write-ahead log behind, so recent writes go missing without any error. Restart
the web server afterwards, since it holds the old file open until you do.

## Configuration

Every dial lives in [`ingest/src/config.ts`](ingest/src/config.ts). Nothing is
tuned by editing a pass script.

| Dial | Default | What it does |
|---|---|---|
| `seedStyles.core` | Dub Techno, Deep Techno | Admitted whatever the genre. |
| `seedStyles.broad` | Minimal, Dub | Admitted only within genre Electronic. This is what separates electronic dub from reggae dub: the style is identical, only the genre differs. |
| `seedStyles.needsTechno` | Ambient | Needs Electronic *and* a techno style on the same release. Ambient is 98% Electronic already, so a genre gate alone does nothing for it. |
| `seedStyles.disqualifying` | Modern Classical, Soundtrack, Score and similar | Rejects a release however else it is tagged. A film score tagged Ambient is not a dub techno record, and it was the route that brought Mozart in. |
| `seedArtist.minSeedRatio` | `0.02` | A seed artist has to do at least this share of their work inside the seed. Closes the door incidental credits opened. |
| `seedArtist.packagingRoles` | photography, artwork, design, layout, sleeve, liner notes | Roles that do not make someone part of the scene. A photographer is not a musician. |
| `AUTHORSHIP_ROLES` | Composed By, Written-By and similar | Writing a piece is not making a record. Mozart is credited "Composed By" on records that sample him. |
| `seedLabel.minSeedArtists` | `2` | Floor. Stops a tiny label qualifying on one coincidence. |
| `seedLabel.minSeedArtistRatio` | `0.50` | Concentration. Measured on the 20260801 dump there is a clean gap: majors land at 6-19%, scene labels at 67-100%. |
| `expansion.channelAMinSharedReleases` | `1` (off) | Raise to `2` only if the one hop corpus balloons. Filters one off guest spots. |
| `expansion.channelAMinSeedRatio` | `0.10` | A seed artist only vouches others in if this much of their work is in the scene. Moritz von Oswald bridges at 42.8%, a mastering engineer who touches everything does not at 0.2%. |
| `expansion.channelAMaxPeopleToAdmit` | `8` | A release crowded with credits is a compilation, not a session. Kept, but it admits nobody new. |
| `derive.maxPeoplePerRelease` | `20` | Above this a release generates no collaboration pairs. Track 7 and track 31 of a forty artist compilation are not collaborators. |
| `relevance.high` / `.medium` | see below | Grades an artist by seed release count and seed share of their whole output. |
| `PLACEHOLDER_ARTIST_IDS` / `NAMES` | `194`, "Various" and similar | Keeps Discogs placeholders out of the collaboration logic, where they would otherwise become the most collaborative artist in the database by a mile. Verify the IDs against the artists dump before the first full run. |

Flat counts alone do not work for labels. A 500 artist label clearing "2 or more
seed artists" is noise, not signal, so the bar has to scale with roster size.
That is why there is both a floor and a ratio.

Relevance grades on two signals for the same reason, and needs both. Share alone
would put an artist with one record out of one above Moritz von Oswald. Volume
alone would put Aphex Twin, 114 seed releases in 1,079, above Basic Channel, 61
in 77. High is 5 or more seed releases and a 15% share, which sits just below
Jeff Mills at 15.4%. The share is measured against an artist's whole output as
the dump has it, never against their corpus releases: Depeche Mode has 75 seed
style releases among the 204 of theirs the corpus kept, which reads as 37% and
would rank them high, when against their real catalogue it is a fraction of a
percent.

These numbers are starting points, not answers. **Measure between passes.** Pass 1
reports the seed artist and seed label counts, which are the steering signals.
Pass 2 reports release and artist counts per channel. Read them before committing
to a full run. Too big, tighten the dials. Too thin, loosen them.

Both seed sets are persisted to the `seed_artists` and `seed_labels` tables, so
pass 2 can be re-run with different dials without redoing pass 1. They also answer
the debugging question "why is this person or label in the corpus at all?"

None of these numbers were read off a curve. Every one is pinned to acts and
labels whose right answer is known in advance, and
[`check-corpus`](ingest/src/cli/check-corpus.ts) asserts them after every
rebuild, so a dial cannot drift without the build failing:

```sh
npm run check-corpus --workspace ingest
```

Fourteen labels that define the scene must be seed labels, seven budget
compilation outfits must not be, eight acts must grade high, and ten acts a
sceptic would type must not.

## Running the web app

```sh
npm run dev      # http://localhost:4321
```

Point it at a database with the `DUBDIGGER_DB` environment variable, or drop the
file at `web/data/dubdigger.sqlite`. With no database present the home page says
so plainly instead of rendering an empty search that looks like an answer.

## Stack

Astro and TypeScript, server rendered on every request, with SQLite as a read
only file. The pages are `.astro` and ship no JavaScript; three React islands
carry the only things that need it, the About panel, the collapsing bio, and the
counter on the home page. Tailwind v4, configured as tokens in `globals.css`.
Ingest is standalone Node and TypeScript scripts using a streaming XML parser.
Deployment is a single small VPS running the Node server next to the SQLite file.

## Roadmap

- [x] Workspaces, SQLite schema, streaming release parser, dump CLIs
- [x] Web shell, density baseline, honest empty state
- [x] Pass 1, style seed: seed artists, then seed labels via floor and ratio
- [x] Pass 2, one hop out on both channels, with provenance tagging
- [x] Artists and labels dumps, with bios and outbound links
- [x] Aliases, members and groups, read straight from the dump
- [x] Derived tables: collaborators, labels, rosters, coverage and relevance
- [x] Artist, label and search pages

### How the sceptic tests got closed

Frank Sinatra and Elvis Presley were in the corpus. They arrived through two
different doors, and closing either one alone left the other open. Both rules
are now in `ingest/src/config.ts` and both are asserted by `check-corpus`.

**Door one: packaging credits conferred seed membership.** Sinatra was admitted
by "Tribute To Frank Sinatra", vouched for by Otto Bettmann of the Bettmann
photo archive, credited on 64 releases of which 11 sat in the seed. His 17.2%
cleared the bridge ratio honestly. He is simply not a musician. 23,919 seed
artists qualified on packaging credits alone: photography, artwork, design,
layout, sleeve, liner notes. Those roles no longer confer membership.

Roles stay raw and `roles_seen` keeps logging all 281,018 strings. This is a
membership rule, not the role normalisation v1 rules out.

**Door two: incidental seed artists.** Luciano re-edited Nina Simone's
"Sinnerman", correctly tagged Minimal on genre Electronic. That made Nina Simone
a seed artist off 4 releases in 5,087, 0.08% of her work. Vintage reissue labels
then read as 74% scene, cleared the 0.50 label ratio, and admitted their whole
catalogues through channel B. A seed artist now has to do at least 2% of their
work inside the seed.

There was no clean gap in the distribution, so the threshold could not be read
off it the way the label and bridge ratios could. Real acts pinned it instead:

| act | share | should be |
|---|---|---|
| Massive Attack | 26.92% | core, it made dub records |
| The Clash | 8.91% | core, Sandinista! is half dub |
| Spice Girls | 0.46% | out |
| Lady Gaga | 0.10% | out |
| The Beatles | 0.01% | out |

**2%, because it is the cheapest floor that does the whole job.** Two orders of
magnitude separate the acts that belong from the ones that do not, and nothing a
sceptical user would think to type sits in between. Measured against the metal
labels, 2% and 5% produce identical outcomes, so 5% would have removed 16,000
more artists and 4,000 more seed labels for no visible difference. 10% was ruled
out outright: it cuts The Clash.

The aim was never maximum pruning. It is that someone testing the tool with
"Mozart" or "Iron Maiden" is not misled, because that is the search that decides
whether they trust it. Mozart is still present, on 85 releases that really do
credit someone in the scene, and after three rules a fourth would start cutting
real neighbours to chase a shrinking tail. So the interface carries the
distinction instead: relevance grades an artist high, medium or low by how much
of their output sits in the seed, and for the ones with no seed work at all it
says how they got here instead: collaborator, label mate, or both. Being visibly
peripheral is honest. Being absent would be a lie about what the data says.

The same floor closed the metal. Manowar, Iron Maiden and Black Sabbath sat on
budget compilation labels whose entire scene credibility was incidental seed
artists: Sonotec went from 16 seed artists of 29 to zero, E L M from 11 of 19 to
zero, and every such label sampled dropped out.

### Still open

- **Release pages.** A release row links straight to Discogs, which holds the
  fuller picture including images and avoids presenting a mostly empty credits
  list as though it were an answer. A page of our own is a v1.1 question, not a
  gap.
- **Roles are still raw.** 281,018 distinct strings, logged in `roles_seen` as
  the record of what a later pass would face.
- **The UI is a baseline, not a design.** Dense, legible, and deliberately
  unstyled while the layout question is still open.

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
