-- Raw tables: a thin projection of the Discogs dumps.
-- Only the fields the tool actually needs. Formats, country, notes, matrix,
-- companies and identifiers are all discarded at parse time.

CREATE TABLE IF NOT EXISTS releases (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  year          INTEGER,
  -- The date as the dump writes it: "1994-03-00", "1996", "1997-09-22". year is
  -- derived from it and is what the corpus is graded on; this is what a sleeve
  -- prints. Filled by the enrich step, not by the passes.
  released      TEXT,
  country       TEXT,
  -- How this release entered the corpus. A collaborator is not the same as a
  -- label-mate, and the UI must be able to show that distinction.
  is_seed       INTEGER NOT NULL DEFAULT 0,
  channel_a     INTEGER NOT NULL DEFAULT 0,
  channel_b     INTEGER NOT NULL DEFAULT 0
);

-- Main artist credits (the "by" line), with join phrases preserved verbatim.
-- position is the artist's index in the release's artist list.
CREATE TABLE IF NOT EXISTS release_artists (
  release_id    INTEGER NOT NULL,
  position      INTEGER NOT NULL,
  artist_id     INTEGER NOT NULL,
  name          TEXT NOT NULL,
  join_phrase   TEXT,
  PRIMARY KEY (release_id, position)
) WITHOUT ROWID;

-- <extraartists> — the credits that make this project worth building.
-- Role strings are stored RAW, exactly as Discogs has them. No normalisation
-- in v1: "Engineer", "Engineer [Recording]" and "Recorded By" stay distinct.
CREATE TABLE IF NOT EXISTS release_credits (
  release_id    INTEGER NOT NULL,
  position      INTEGER NOT NULL,
  artist_id     INTEGER NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL,
  PRIMARY KEY (release_id, position)
) WITHOUT ROWID;

-- The tracklist, read for what it prints and nothing more. Tracks are NOT an
-- entity: no ids, no credits, no pages. The track level's own <artists> and
-- <extraartists> are still dropped at parse time, which is the whole reason the
-- subtree was skipped before this table existed.
CREATE TABLE IF NOT EXISTS release_tracks (
  release_id    INTEGER NOT NULL,
  -- Order in the list. position is a printed label ("A1", "B2") and is missing
  -- on heading rows, so it cannot be the key.
  seq           INTEGER NOT NULL,
  position      TEXT,
  title         TEXT NOT NULL,
  duration      TEXT,
  PRIMARY KEY (release_id, seq)
) WITHOUT ROWID;

-- The carrier. Parts, never a sentence: "Vinyl" + qty 2 + ["12\"", "45 RPM"] is
-- assembled at display time, the same rule the raw role strings follow.
CREATE TABLE IF NOT EXISTS release_formats (
  release_id    INTEGER NOT NULL,
  position      INTEGER NOT NULL,
  name          TEXT NOT NULL,
  qty           INTEGER NOT NULL DEFAULT 1,
  text          TEXT,
  -- Newline joined, the way artists.urls is.
  descriptions  TEXT,
  PRIMARY KEY (release_id, position)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS release_labels (
  release_id    INTEGER NOT NULL,
  position      INTEGER NOT NULL,
  label_id      INTEGER NOT NULL,
  name          TEXT NOT NULL,
  catno         TEXT,
  PRIMARY KEY (release_id, position)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS release_styles (
  release_id    INTEGER NOT NULL,
  style         TEXT NOT NULL,
  PRIMARY KEY (release_id, style)
) WITHOUT ROWID;

-- Coarser than styles, and the only thing separating reggae dub from
-- electronic dub. Kept for tuning and debugging the seed rule.
CREATE TABLE IF NOT EXISTS release_genres (
  release_id    INTEGER NOT NULL,
  genre         TEXT NOT NULL,
  PRIMARY KEY (release_id, genre)
) WITHOUT ROWID;

-- profile and urls come straight from the dumps, so they are CC0 like the rest
-- of it. No API call, no live dependency, no attribution requirement. Images
-- are the thing that is NOT in here and NOT CC0.
CREATE TABLE IF NOT EXISTS artists (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  real_name     TEXT,
  -- Raw Discogs markup: [a123], [l=Name], [b]bold[/b], [url=..]..[/url].
  -- Stored verbatim and rendered at display time, since [a] and [l] are typed
  -- references that become links into this tool's own pages.
  profile       TEXT,
  /** The artist's own links, newline separated. */
  urls          TEXT
);

CREATE TABLE IF NOT EXISTS labels (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  profile       TEXT,
  urls          TEXT
);

-- Aliases, members and groups, exactly as Discogs records them.
--
-- Credits alone cannot say that Basic Channel is Moritz von Oswald and Mark
-- Ernestus: their releases credit Moritz twice, as a cutting engineer, and
-- Ernestus not at all. The dump states the relationship outright, so this is
-- using what Discogs gives rather than inferring anything.
--
-- Kept separate from artist_collaborators on purpose. Being the same person is
-- not the same as having worked together, and the interface must not present
-- one as the other.
CREATE TABLE IF NOT EXISTS artist_relations (
  artist_id     INTEGER NOT NULL,
  related_id    INTEGER NOT NULL,
  -- The name as the dump gives it. Most relations point outside the corpus,
  -- and without a name here they were silently dropped by the join, so an
  -- artist's aliases appeared shorter than they are.
  related_name  TEXT NOT NULL DEFAULT '',
  -- 'alias'  : the two names are the same act
  -- 'member' : related_id is a member of artist_id
  -- 'group'  : artist_id is a member of related_id
  kind          TEXT NOT NULL,
  PRIMARY KEY (artist_id, related_id, kind)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_artist_relations_related
  ON artist_relations (related_id);

-- The definitional core of the corpus, persisted so pass 2 can be re-run with
-- different dials without redoing pass 1.

CREATE TABLE IF NOT EXISTS seed_artists (
  artist_id     INTEGER PRIMARY KEY,
  seed_releases INTEGER NOT NULL DEFAULT 0,
  -- Their whole output as this dump has it, not just their corpus releases.
  -- Pass 1 counts this to apply the seed ratio and used to discard it; it is
  -- kept because it is the only honest denominator for grading relevance.
  -- NULL when the ratio rule was switched off and the count never happened.
  total_releases INTEGER
);

-- Whole-dump output per artist, cached by measure-seed so a ratio dial can be
-- tried without re-reading 10.4 GB. Declared here rather than in that CLI
-- because derive reads it too: it is the denominator behind the scene share a
-- page displays, and the only one that covers artists the ratio rejected.
-- Empty is a valid state, and reads as an unmeasured share rather than as zero.
CREATE TABLE IF NOT EXISTS seed_artist_totals (
  artist_id INTEGER PRIMARY KEY,
  total     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS seed_artist_totals_meta (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  built_from TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seed_labels (
  label_id           INTEGER PRIMARY KEY,
  seed_artist_count  INTEGER NOT NULL,
  total_artist_count INTEGER NOT NULL,
  seed_ratio         REAL NOT NULL
);

-- Working table, pass 1 only. Every (label, main artist) pair in the dump,
-- deduped by the primary key.
--
-- The seed-label ratio has to be measured against a label's whole roster as
-- captured in this dump, not just its seed releases, or a label with two seed
-- artists and twenty unrelated acts would look like a pure scene label. That
-- means collecting pairs across every release scanned, including the ones the
-- style filter rejects. Emptied once seed_labels has been computed.
CREATE TABLE IF NOT EXISTS label_artist_pairs (
  label_id      INTEGER NOT NULL,
  artist_id     INTEGER NOT NULL,
  PRIMARY KEY (label_id, artist_id)
) WITHOUT ROWID;

-- Corpus membership per artist, with the provenance the UI needs.
CREATE TABLE IF NOT EXISTS corpus_artists (
  artist_id     INTEGER PRIMARY KEY,
  is_seed       INTEGER NOT NULL DEFAULT 0,
  channel_a     INTEGER NOT NULL DEFAULT 0,
  channel_b     INTEGER NOT NULL DEFAULT 0
);

-- Every distinct role string encountered, with a count. Never silently drop an
-- unmapped role — this table is the input to any future normalisation work.
CREATE TABLE IF NOT EXISTS roles_seen (
  role          TEXT PRIMARY KEY,
  occurrences   INTEGER NOT NULL DEFAULT 0
);

-- A record of how each pass ran, so a database file can explain itself.
CREATE TABLE IF NOT EXISTS ingest_runs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  step          TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  finished_at   TEXT,
  source_file   TEXT,
  config_json   TEXT,
  stats_json    TEXT
);

CREATE INDEX IF NOT EXISTS idx_release_artists_artist ON release_artists (artist_id);
CREATE INDEX IF NOT EXISTS idx_release_credits_artist ON release_credits (artist_id);
CREATE INDEX IF NOT EXISTS idx_release_labels_label   ON release_labels (label_id);
CREATE INDEX IF NOT EXISTS idx_release_styles_style   ON release_styles (style);


-- Derived tables: precomputed answers. These are all the web app ever reads.
-- Everything here is ranked by frequency, never alphabetically.

CREATE TABLE IF NOT EXISTS artist_collaborators (
  artist_id        INTEGER NOT NULL,
  collaborator_id  INTEGER NOT NULL,
  shared_releases  INTEGER NOT NULL,
  -- Raw role strings the collaborator held across those releases, newline
  -- separated. Unnormalised, by design.
  roles            TEXT,
  PRIMARY KEY (artist_id, collaborator_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_artist_collaborators_rank
  ON artist_collaborators (artist_id, shared_releases DESC);

CREATE TABLE IF NOT EXISTS artist_labels (
  artist_id      INTEGER NOT NULL,
  label_id       INTEGER NOT NULL,
  release_count  INTEGER NOT NULL,
  first_year     INTEGER,
  last_year      INTEGER,
  PRIMARY KEY (artist_id, label_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_artist_labels_rank
  ON artist_labels (artist_id, release_count DESC);

CREATE TABLE IF NOT EXISTS label_roster (
  label_id       INTEGER NOT NULL,
  artist_id      INTEGER NOT NULL,
  release_count  INTEGER NOT NULL,
  first_year     INTEGER,
  last_year      INTEGER,
  PRIMARY KEY (label_id, artist_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_label_roster_rank
  ON label_roster (label_id, release_count DESC);

-- Coverage flags. "No credits recorded" must be distinguishable from
-- "worked solo" — an empty result that looks like an answer is worse than
-- an honest "no data here".
CREATE TABLE IF NOT EXISTS artist_coverage (
  artist_id          INTEGER PRIMARY KEY,
  release_count      INTEGER NOT NULL DEFAULT 0,
  -- Releases of theirs carrying ANY <extraartists> at all. Zero means nobody
  -- has entered credits, which is not the same as having worked alone.
  credited_releases  INTEGER NOT NULL DEFAULT 0,
  collaborator_count INTEGER NOT NULL DEFAULT 0,
  label_count        INTEGER NOT NULL DEFAULT 0,
  first_year         INTEGER,
  last_year          INTEGER,
  -- Releases of theirs inside the style seed, and that as a share of everything
  -- they have ever appeared on. Both carried here so the app can show the
  -- working rather than just the verdict.
  --
  -- Counted in DISTINCT releases, and counted for everyone rather than only for
  -- seed artists. See the note in derive.ts: these two columns are what a page
  -- displays, and they are not the tally the grade below was computed from.
  seed_releases      INTEGER NOT NULL DEFAULT 0,
  seed_share         REAL,
  -- 'very high' | 'high' | 'medium' | 'low' | 'none', as the seed measures it.
  -- The dials are
  -- in config.ts. This is the measurement, before any editorial rule runs.
  scene_relevance    TEXT NOT NULL DEFAULT 'none',
  -- What the interface shows: scene_relevance, raised to the lineage floor when
  -- a tradition applies. The two are kept apart so a page can say which it is
  -- reading, and never implies scene work an artist does not have.
  relevance          TEXT NOT NULL DEFAULT 'none',
  -- The tradition that raised it, or NULL: 'roots dub', 'afrobeat',
  -- 'detroit techno'. The editorial rules of the corpus, argued in config.ts.
  lineage            TEXT,
  -- Set only where `overrides.artists` names this artist. Same job as the label
  -- column: the grade above was set by hand and this is the published reason.
  --
  -- It is also read by the SORT, not only by the page, and that is the whole
  -- reason it is a column rather than a lookup in the app. `seed_releases` is
  -- what search ranks on, so promoting the grade of someone the seed scores at
  -- zero moves the word on the page and nothing else — which is the lineage bug
  -- of 2026-09-08 exactly, on names picked by hand. `artistPool` floors an
  -- overridden artist the same way it floors a lineage one.
  override_reason    TEXT
);

-- The label grade, on the same five steps as an artist so one word means one
-- thing site-wide. Dials in config.ts under labelRelevance.
--
-- The counts come from label_artist_pairs: every act on the artist line of this
-- label's releases across the whole dump. That is deliberately NOT the roster
-- the label page lists, which holds corpus artists only and counts credits as
-- well, and would put EMI at 32% against Tresor's 45%. Two questions, two
-- denominators, and the page words them differently so neither claims the
-- other's set.
CREATE TABLE IF NOT EXISTS label_coverage (
  label_id          INTEGER PRIMARY KEY,
  line_artist_count INTEGER NOT NULL DEFAULT 0,
  seed_artist_count INTEGER NOT NULL DEFAULT 0,
  -- NULL only when the dump records no artist line for this label at all, which
  -- is not the same as a roster with nobody from the cluster on it.
  seed_ratio        REAL,
  -- The same five words an artist wears, from a measure of the label's own.
  -- 'very high' IS the seed-label rule, which is what keeps the corpus boundary
  -- and the top step of the display one decision.
  relevance         TEXT NOT NULL DEFAULT 'none',
  -- What search ranks it on: releases of ITS OWN that are in the seed, counted
  -- rather than estimated. The ratio above is a share of PEOPLE, and multiplying
  -- a release count by it answered a question about records with a fact about
  -- the roster: Planet Rhythm came out at 764 where the true figure is 126,
  -- and outranked Rhythm & Sound, whose 160 is measured the strict way because
  -- an artist's always was. The grade still reads the ratio; only the sort
  -- reads this.
  seed_releases     INTEGER NOT NULL DEFAULT 0,
  -- Set only where `overrides.labels` names this label: the grade above was
  -- decided by hand and this says why, in the slot the computed ratio clause
  -- would otherwise fill. A graded label with no stated reason is the one thing
  -- the interface does not ship, and an override has no ratio to fall back on.
  override_reason   TEXT
);

-- What a record is worth to a search, precomputed because the search cannot
-- afford to work it out.
--
-- A release has no grade of its own, so its rank is the lead artist's figure
-- discounted by the lead artist's grade, which the app then halves again: a
-- record ranks where its maker ranks, one step down. Computed here because the
-- query that needs it is the one that cannot pay for it: "re" matches about
-- 200,000 titles, and reaching the artist line and the coverage row for every
-- one of them cost 103 ms of a 196 ms page against 84 ms before records were
-- searchable. Ordering against this table instead costs 31 ms.
--
-- Deliberately three columns and no title. A wider version carrying the title
-- and the artist name saves the app a second query and measured 49 ms against
-- this one's 31, because 60 MB of table touches four times the pages 15 MB
-- does. The app pays one extra lookup for the 200 rows that survive, which is
-- the trade the whole architecture already makes: rank on a narrow key, read
-- the wide row only for what is shown.
CREATE TABLE IF NOT EXISTS release_rank (
  release_id INTEGER PRIMARY KEY,
  -- seed releases of the lead artist, halved once per step down their grade.
  weight     REAL NOT NULL DEFAULT 0,
  -- Carried so the tie-break between two pressings is settled here rather than
  -- by a second read: earliest first, undated last.
  year       INTEGER
) WITHOUT ROWID;

-- Search: the entry point to the whole tool is typing a name.
-- External-content FTS, rebuilt at the end of ingest with:
--   INSERT INTO artist_search(artist_search) VALUES('rebuild');
CREATE VIRTUAL TABLE IF NOT EXISTS artist_search
  USING fts5(name, content='artists', content_rowid='id', tokenize='unicode61');

CREATE VIRTUAL TABLE IF NOT EXISTS label_search
  USING fts5(name, content='labels', content_rowid='id', tokenize='unicode61');

-- Records became searchable when they became pages. Before the release page a
-- title was a row that linked out to Discogs, so there was nothing here to find;
-- now the corpus holds 1,095,302 pages that a search could not reach, and a
-- digger typing "Biokinetics" got the miss page telling them the corpus is a
-- slice centred on dub techno. That answer was false.
--
-- The title alone, matching the two above, which index a name and nothing else.
-- Indexing the artist line with it would make "basic channel phylyps" work and
-- would also make every record by a prolific act match that act's name, which
-- is a different feature wearing this one's clothes.
CREATE VIRTUAL TABLE IF NOT EXISTS release_search
  USING fts5(title, content='releases', content_rowid='id', tokenize='unicode61');
