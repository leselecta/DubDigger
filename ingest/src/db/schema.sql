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

CREATE TABLE IF NOT EXISTS artists (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL,
  real_name     TEXT
);

CREATE TABLE IF NOT EXISTS labels (
  id            INTEGER PRIMARY KEY,
  name          TEXT NOT NULL
);

-- The definitional core of the corpus, persisted so pass 2 can be re-run with
-- different dials without redoing pass 1.

CREATE TABLE IF NOT EXISTS seed_artists (
  artist_id     INTEGER PRIMARY KEY,
  seed_releases INTEGER NOT NULL DEFAULT 0
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
  last_year          INTEGER
);

-- Search: the entry point to the whole tool is typing a name.
-- External-content FTS, rebuilt at the end of ingest with:
--   INSERT INTO artist_search(artist_search) VALUES('rebuild');
CREATE VIRTUAL TABLE IF NOT EXISTS artist_search
  USING fts5(name, content='artists', content_rowid='id', tokenize='unicode61');

CREATE VIRTUAL TABLE IF NOT EXISTS label_search
  USING fts5(name, content='labels', content_rowid='id', tokenize='unicode61');
