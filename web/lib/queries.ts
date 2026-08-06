import "server-only";
import { getDb } from "./db";

/**
 * Every query here reads a precomputed table. Nothing is aggregated at request
 * time: the ranking work happened offline, during ingest.
 */

export interface Artist {
  id: number;
  name: string;
  realName: string | null;
  profile: string | null;
  urls: string[];
  releaseCount: number;
  /** Releases of theirs carrying any credits at all. Zero is meaningful. */
  creditedReleases: number;
  collaboratorCount: number;
  labelCount: number;
  firstYear: number | null;
  lastYear: number | null;
  isSeed: boolean;
  channelA: boolean;
  channelB: boolean;
}

export interface Collaborator {
  id: number;
  name: string;
  sharedReleases: number;
  roles: string[];
}

export interface LabelCredit {
  id: number;
  name: string;
  releaseCount: number;
  firstYear: number | null;
  lastYear: number | null;
}

export interface Label {
  id: number;
  name: string;
  /**
   * One artist appears on every release. Not a partial roster but a complete
   * one, which is how an artist-run imprint looks: Purpose Maker is Jeff Mills
   * on all 66 of its records, with six engineers around him.
   */
  isImprint: boolean;
  profile: string | null;
  urls: string[];
  artistCount: number;
  releaseCount: number;
  isSeed: boolean;
  seedRatio: number | null;
}

export interface RosterEntry {
  id: number;
  name: string;
  releaseCount: number;
  firstYear: number | null;
  lastYear: number | null;
}

export interface SearchHit {
  id: number;
  name: string;
  kind: "artist" | "label";
  releaseCount: number;
  /**
   * How close to the scene. Shown in results because breadth is only an asset
   * when a distant act looks distant: Mozart is genuinely in the corpus, on 85
   * releases that really do credit someone here, and saying so is honest where
   * hiding him would not be.
   */
  relevance: "core" | "collaborator" | "label mate" | null;
}

/** Row shapes as SQLite returns them, snake_case and with 0/1 for booleans. */
interface ArtistRow {
  id: number;
  name: string;
  real_name: string | null;
  profile: string | null;
  urls: string | null;
  release_count: number;
  credited_releases: number;
  collaborator_count: number;
  label_count: number;
  first_year: number | null;
  last_year: number | null;
  is_seed: number;
  channel_a: number;
  channel_b: number;
}

interface CollaboratorRow {
  id: number;
  name: string;
  shared_releases: number;
  roles: string | null;
}

interface CreditRow {
  id: number;
  name: string;
  release_count: number;
  first_year: number | null;
  last_year: number | null;
}

interface LabelRow {
  id: number;
  name: string;
  profile: string | null;
  urls: string | null;
  artist_count: number;
  release_count: number;
  seed_ratio: number | null;
  top_artist_releases: number | null;
}

interface HitRow {
  id: number;
  name: string;
  release_count: number;
  is_seed?: number;
  channel_a?: number;
  channel_b?: number;
}

export function getArtist(id: number): Artist | null {
  const db = getDb();
  if (!db) return null;

  const row = db
    .prepare(
      `SELECT a.id, a.name, a.real_name, a.profile, a.urls,
              coalesce(c.release_count, 0)      AS release_count,
              coalesce(c.credited_releases, 0)  AS credited_releases,
              coalesce(c.collaborator_count, 0) AS collaborator_count,
              coalesce(c.label_count, 0)        AS label_count,
              c.first_year, c.last_year,
              coalesce(m.is_seed, 0)   AS is_seed,
              coalesce(m.channel_a, 0) AS channel_a,
              coalesce(m.channel_b, 0) AS channel_b
         FROM artists a
         LEFT JOIN artist_coverage c ON c.artist_id = a.id
         LEFT JOIN corpus_artists  m ON m.artist_id = a.id
        WHERE a.id = ?`,
    )
    .get(id) as ArtistRow | undefined;

  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    realName: row.real_name,
    profile: row.profile,
    urls: row.urls ? row.urls.split("\n").filter(Boolean) : [],
    releaseCount: row.release_count,
    creditedReleases: row.credited_releases,
    collaboratorCount: row.collaborator_count,
    labelCount: row.label_count,
    firstYear: row.first_year,
    lastYear: row.last_year,
    isSeed: row.is_seed === 1,
    channelA: row.channel_a === 1,
    channelB: row.channel_b === 1,
  };
}

export function getCollaborators(artistId: number, limit = 100): Collaborator[] {
  const db = getDb();
  if (!db) return [];

  const rows = db
    .prepare(
      `SELECT ac.collaborator_id AS id, a.name, ac.shared_releases, ac.roles
         FROM artist_collaborators ac
         JOIN artists a ON a.id = ac.collaborator_id
        WHERE ac.artist_id = ?
        ORDER BY ac.shared_releases DESC, a.name
        LIMIT ?`,
    )
    .all(artistId, limit) as CollaboratorRow[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sharedReleases: r.shared_releases,
    roles: r.roles ? r.roles.split("\n").filter(Boolean) : [],
  }));
}

export function getArtistLabels(artistId: number): LabelCredit[] {
  const db = getDb();
  if (!db) return [];

  const rows = db
    .prepare(
      `SELECT al.label_id AS id, l.name, al.release_count, al.first_year, al.last_year
         FROM artist_labels al
         JOIN labels l ON l.id = al.label_id
        WHERE al.artist_id = ?
        ORDER BY al.release_count DESC, l.name`,
    )
    .all(artistId) as CreditRow[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    releaseCount: r.release_count,
    firstYear: r.first_year,
    lastYear: r.last_year,
  }));
}

export function getLabel(id: number): Label | null {
  const db = getDb();
  if (!db) return null;

  const row = db
    .prepare(
      `SELECT l.id, l.name, l.profile, l.urls,
              (SELECT count(*) FROM label_roster r WHERE r.label_id = l.id) AS artist_count,
              (SELECT count(DISTINCT rl.release_id) FROM release_labels rl WHERE rl.label_id = l.id)
                AS release_count,
              s.seed_ratio,
              (SELECT max(release_count) FROM label_roster r WHERE r.label_id = l.id)
                AS top_artist_releases
         FROM labels l
         LEFT JOIN seed_labels s ON s.label_id = l.id
        WHERE l.id = ?`,
    )
    .get(id) as LabelRow | undefined;

  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    profile: row.profile,
    urls: row.urls ? row.urls.split("\n").filter(Boolean) : [],
    artistCount: row.artist_count,
    releaseCount: row.release_count,
    isSeed: row.seed_ratio !== null,
    seedRatio: row.seed_ratio,
    isImprint: row.release_count > 1 && row.top_artist_releases === row.release_count,
  };
}

export function getRoster(labelId: number, limit = 200): RosterEntry[] {
  const db = getDb();
  if (!db) return [];

  const rows = db
    .prepare(
      `SELECT r.artist_id AS id, a.name, r.release_count, r.first_year, r.last_year
         FROM label_roster r
         JOIN artists a ON a.id = r.artist_id
        WHERE r.label_id = ?
        ORDER BY r.release_count DESC, a.name
        LIMIT ?`,
    )
    .all(labelId, limit) as CreditRow[];

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    releaseCount: r.release_count,
    firstYear: r.first_year,
    lastYear: r.last_year,
  }));
}

export function search(query: string, limit = 40): SearchHit[] {
  const db = getDb();
  if (!db || query.trim().length === 0) return [];

  // FTS5 reads bare punctuation as syntax, so the term is quoted, and given a
  // trailing wildcard to make the box behave like search rather than exact match.
  const term = `"${query.trim().replace(/"/g, '""')}"*`;

  const artists = db
    .prepare(
      `SELECT a.id, a.name, coalesce(c.release_count, 0) AS release_count,
              coalesce(m.is_seed, 0) AS is_seed,
              coalesce(m.channel_a, 0) AS channel_a,
              coalesce(m.channel_b, 0) AS channel_b
         FROM artist_search s
         JOIN artists a ON a.id = s.rowid
         LEFT JOIN artist_coverage c ON c.artist_id = a.id
         LEFT JOIN corpus_artists  m ON m.artist_id = a.id
        WHERE artist_search MATCH ?
        ORDER BY is_seed DESC, release_count DESC
        LIMIT ?`,
    )
    .all(term, limit) as HitRow[];

  const labels = db
    .prepare(
      `SELECT l.id, l.name, l.profile, l.urls,
              (SELECT count(DISTINCT rl.release_id) FROM release_labels rl WHERE rl.label_id = l.id)
                AS release_count
         FROM label_search s
         JOIN labels l ON l.id = s.rowid
        WHERE label_search MATCH ?
        ORDER BY release_count DESC
        LIMIT ?`,
    )
    .all(term, limit) as HitRow[];

  const relevance = (r: HitRow): SearchHit["relevance"] => {
    if (r.is_seed === 1) return "core";
    if (r.channel_a === 1) return "collaborator";
    if (r.channel_b === 1) return "label mate";
    return null;
  };

  return [
    ...artists.map((r) => ({
      id: r.id,
      name: r.name,
      kind: "artist" as const,
      releaseCount: r.release_count,
      relevance: relevance(r),
    })),
    ...labels.map((r) => ({
      id: r.id,
      name: r.name,
      kind: "label" as const,
      releaseCount: r.release_count,
      relevance: null,
    })),
  ].sort((a, b) => {
    // Core first, so a sceptic searching "Mozart" sees at a glance that the
    // scene artists are the answer and he is a footnote.
    const rank = (h: SearchHit) => (h.relevance === "core" ? 0 : 1);
    return rank(a) - rank(b) || b.releaseCount - a.releaseCount;
  });
}

/**
 * Resolves the [a123] and [l456] references inside a profile to real names, so
 * a bio reads as prose with links rather than as raw ids.
 */
export function getProfileNames(profile: string | null): Record<string, string> {
  const db = getDb();
  if (!db || !profile) return {};

  const artistIds: number[] = [];
  const labelIds: number[] = [];
  for (const m of profile.matchAll(/\[(a|l)(\d+)\]/gi)) {
    (m[1]!.toLowerCase() === "a" ? artistIds : labelIds).push(Number(m[2]));
  }
  if (artistIds.length === 0 && labelIds.length === 0) return {};

  const names: Record<string, string> = {};
  const lookup = (table: string, ids: number[], prefix: string) => {
    if (ids.length === 0) return;
    const rows = db
      .prepare(`SELECT id, name FROM ${table} WHERE id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids) as { id: number; name: string }[];
    for (const r of rows) names[`${prefix}${r.id}`] = r.name;
  };
  lookup("artists", artistIds, "a");
  lookup("labels", labelIds, "l");
  return names;
}

export interface Relation {
  id: number;
  name: string;
  kind: "alias" | "member" | "group";
  releaseCount: number;
  inCorpus: boolean;
}

/**
 * Aliases, members and groups, as Discogs records them.
 *
 * Deliberately not merged into the collaborator list. Basic Channel IS Moritz
 * von Oswald and Mark Ernestus; that is a different fact from having been
 * co-credited with them, and presenting one as the other would be the same
 * dishonesty as calling a label mate a collaborator.
 *
 * Read in both directions, since the dump does not always record both sides,
 * and "member" seen from the other end means "member of".
 */
export function getRelations(artistId: number): Relation[] {
  const db = getDb();
  if (!db) return [];

  const rows = db
    .prepare(
      `SELECT r.related_id AS id, r.kind, coalesce(a.name, r.related_name) AS name,
              coalesce(c.release_count, 0) AS release_count,
              m.artist_id IS NOT NULL AS in_corpus
         FROM artist_relations r
         LEFT JOIN artists a ON a.id = r.related_id
         LEFT JOIN artist_coverage c ON c.artist_id = r.related_id
         LEFT JOIN corpus_artists  m ON m.artist_id = r.related_id
        WHERE r.artist_id = ?
        UNION
       SELECT r.artist_id, CASE r.kind WHEN 'member' THEN 'group'
                                       WHEN 'group'  THEN 'member'
                                       ELSE 'alias' END,
              coalesce(a.name, ''),
              coalesce(c.release_count, 0),
              m.artist_id IS NOT NULL
         FROM artist_relations r
         JOIN artists a ON a.id = r.artist_id
         LEFT JOIN artist_coverage c ON c.artist_id = r.artist_id
         LEFT JOIN corpus_artists  m ON m.artist_id = r.artist_id
        WHERE r.related_id = ?`,
    )
    .all(artistId, artistId) as {
    id: number;
    kind: "alias" | "member" | "group";
    name: string;
    release_count: number;
    in_corpus: number;
  }[];

  return rows
    .filter((r) => r.name !== "")
    .map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      releaseCount: r.release_count,
      inCorpus: r.in_corpus === 1,
    }))
    .sort((a, b) => b.releaseCount - a.releaseCount);
}

export interface ArtistRelease {
  id: number;
  title: string;
  year: number | null;
  label: string | null;
  /** What this artist did on it. Empty means they were on the artist line. */
  roles: string[];
}

/** An artist's releases, newest first, with what they did on each. */
export function getArtistReleases(artistId: number, limit = 300): ArtistRelease[] {
  const db = getDb();
  if (!db) return [];

  const rows = db
    .prepare(
      `SELECT r.id, r.title, r.year,
              group_concat(DISTINCT c.role) AS roles,
              (SELECT l.name FROM release_labels l WHERE l.release_id = r.id LIMIT 1) AS label
         FROM releases r
         JOIN (SELECT release_id FROM release_artists WHERE artist_id = ?
               UNION SELECT release_id FROM release_credits WHERE artist_id = ?) mine
           ON mine.release_id = r.id
         LEFT JOIN release_credits c ON c.release_id = r.id AND c.artist_id = ?
        GROUP BY r.id
        ORDER BY r.year IS NULL, r.year DESC, r.title
        LIMIT ?`,
    )
    .all(artistId, artistId, artistId, limit) as {
    id: number;
    title: string;
    year: number | null;
    roles: string | null;
    label: string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    year: r.year,
    label: r.label,
    roles: r.roles ? r.roles.split(",").filter(Boolean) : [],
  }));
}

/** A label's releases, newest first. */
export function getLabelReleases(labelId: number, limit = 300): ArtistRelease[] {
  const db = getDb();
  if (!db) return [];

  const rows = db
    .prepare(
      `SELECT r.id, r.title, r.year, rl.catno,
              (SELECT group_concat(ra.name, ' ') FROM release_artists ra
                WHERE ra.release_id = r.id) AS by_line
         FROM release_labels rl
         JOIN releases r ON r.id = rl.release_id
        WHERE rl.label_id = ?
        ORDER BY r.year IS NULL, r.year DESC, r.title
        LIMIT ?`,
    )
    .all(labelId, limit) as {
    id: number;
    title: string;
    year: number | null;
    catno: string | null;
    by_line: string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    year: r.year,
    label: r.catno,
    roles: r.by_line ? [r.by_line] : [],
  }));
}
