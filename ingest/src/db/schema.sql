-- Raw tables: a thin projection of the Discogs dumps.
-- Only the fields the tool actually needs. Formats, country, notes, matrix,
-- companies and identifiers are all discarded at parse time.

CREATE TABLE IF NOT EXISTS releases (
  id            INTEGER PRIMARY KEY,
  title         TEXT NOT NULL,
  year          INTEGER,
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
  -- 'high' | 'medium' | 'low' | 'none'. See the relevance dials in config.ts.
  relevance          TEXT NOT NULL DEFAULT 'none'
);

-- Search: the entry point to the whole tool is typing a name.
-- External-content FTS, rebuilt at the end of ingest with:
--   INSERT INTO artist_search(artist_search) VALUES('rebuild');
CREATE VIRTUAL TABLE IF NOT EXISTS artist_search
  USING fts5(name, content='artists', content_rowid='id', tokenize='unicode61');

CREATE VIRTUAL TABLE IF NOT EXISTS label_search
  USING fts5(name, content='labels', content_rowid='id', tokenize='unicode61');
