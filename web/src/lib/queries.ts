import { getDb } from "./db";

/**
 * Every query here reads a precomputed table. Nothing is aggregated at request
 * time: the ranking work happened offline, during ingest.
 */

/**
 * How central an artist is to the scene, graded during ingest.
 *
 * "none" is not a low score. It means they have no work in the seed at all and
 * reached the corpus by one hop, through a real credit or a shared label; the
 * connection is what the page should show, not a grade.
 */
export type Relevance = "high" | "medium" | "low" | "none";

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
  /** What the page shows: the measurement, raised by any tradition. */
  relevance: Relevance;
  /**
   * The measurement on its own, before a tradition lifted it. Where the two
   * differ, the grade is standing on lineage rather than on scene work, and the
   * page has to say so instead of claiming work that is not there.
   */
  sceneRelevance: Relevance;
  /** Releases of theirs inside the style seed. */
  seedReleases: number;
  /** That as a share of their whole output, or null if never measured. */
  seedShare: number | null;
  /** The tradition that lifted them: 'roots dub', 'afrobeat', 'detroit techno'. */
  lineage: string | null;
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
  firstYear: number | null;
  lastYear: number | null;
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
   *
   * Null on labels, which are not graded.
   */
  relevance: Relevance | null;
  /** How a "none" artist reached the corpus. A label mate is not a collaborator. */
  connection: "collaborator" | "label mate" | "collaborator + label mate" | null;
  /**
   * Labels are not on the artist relevance scale, but they have one of their
   * own: a seed label is a scene label by roster concentration. Null on artists.
   */
  coreLabel: boolean | null;
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
  relevance: Relevance;
  scene_relevance: Relevance;
  seed_releases: number;
  seed_share: number | null;
  lineage: string | null;
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
  first_year: number | null;
  last_year: number | null;
}

interface HitRow {
  id: number;
  name: string;
  release_count: number;
  is_seed?: number;
  channel_a?: number;
  channel_b?: number;
  relevance?: Relevance;
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
              coalesce(m.channel_b, 0) AS channel_b,
              coalesce(c.relevance, 'none') AS relevance,
              coalesce(c.scene_relevance, 'none') AS scene_relevance,
              coalesce(c.seed_releases, 0)  AS seed_releases,
              c.seed_share,
              c.lineage
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
    relevance: row.relevance,
    sceneRelevance: row.scene_relevance,
    seedReleases: row.seed_releases,
    seedShare: row.seed_share,
    lineage: row.lineage,
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
                AS top_artist_releases,
              (SELECT min(first_year) FROM label_roster r WHERE r.label_id = l.id) AS first_year,
              (SELECT max(last_year)  FROM label_roster r WHERE r.label_id = l.id) AS last_year
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
    firstYear: row.first_year,
    lastYear: row.last_year,
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

export interface SearchResults {
  hits: SearchHit[];
  /**
   * The limit applies per kind, so a full artist or label list means there are
   * more matches than these. Reported rather than inferred from the total,
   * because "80 found" would be stating the cap as if it were a count.
   */
  truncated: boolean;
}

export function search(query: string, limit = 40): SearchResults {
  const db = getDb();
  if (!db || query.trim().length === 0) return { hits: [], truncated: false };

  // FTS5 reads bare punctuation as syntax, so the term is quoted, and given a
  // trailing wildcard to make the box behave like search rather than exact match.
  const term = `"${query.trim().replace(/"/g, '""')}"*`;

  const artists = db
    .prepare(
      `SELECT a.id, a.name, coalesce(c.release_count, 0) AS release_count,
              coalesce(m.is_seed, 0) AS is_seed,
              coalesce(m.channel_a, 0) AS channel_a,
              coalesce(m.channel_b, 0) AS channel_b,
              coalesce(c.relevance, 'none') AS relevance
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
                AS release_count,
              (sd.label_id IS NOT NULL) AS is_seed
         FROM label_search s
         JOIN labels l ON l.id = s.rowid
         LEFT JOIN seed_labels sd ON sd.label_id = l.id
        WHERE label_search MATCH ?
        ORDER BY release_count DESC
        LIMIT ?`,
    )
    .all(term, limit) as HitRow[];

  const connection = (r: HitRow): SearchHit["connection"] => {
    if (r.channel_a === 1 && r.channel_b === 1) return "collaborator + label mate";
    if (r.channel_a === 1) return "collaborator";
    if (r.channel_b === 1) return "label mate";
    return null;
  };

  /**
   * Graded first, so a sceptic searching "Mozart" sees at a glance that the
   * scene artists are the answer and he is a footnote.
   *
   * Labels are not on the artist scale, so they are ranked by the one they do
   * have: a seed label sorts with the strong artists, anything else with the
   * weak. Ranking every label below every graded artist would bury Chain
   * Reaction under the two unrelated acts that share its name.
   */
  const ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 };

  const hits: (SearchHit & { rank: number })[] = [
    ...artists.map((r) => ({
      id: r.id,
      name: r.name,
      kind: "artist" as const,
      releaseCount: r.release_count,
      relevance: r.relevance ?? "none",
      connection: connection(r),
      coreLabel: null,
      rank: ORDER[r.relevance ?? "none"]!,
    })),
    ...labels.map((r) => ({
      id: r.id,
      name: r.name,
      kind: "label" as const,
      releaseCount: r.release_count,
      relevance: null,
      connection: null,
      coreLabel: r.is_seed === 1,
      rank: r.is_seed === 1 ? ORDER.high! : ORDER.low!,
    })),
  ];

  return {
    hits: hits
      .sort((a, b) => a.rank - b.rank || b.releaseCount - a.releaseCount)
      .map(({ rank: _, ...hit }) => hit),
    truncated: artists.length === limit || labels.length === limit,
  };
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
  /**
   * The label to pivot to, when `label` is a label name. Null on the label
   * page, where the same field carries a catalogue number and has nowhere to
   * go: you are already on that label's page.
   */
  labelId: number | null;
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
              (SELECT l.name FROM release_labels l WHERE l.release_id = r.id LIMIT 1) AS label,
              (SELECT l.label_id FROM release_labels l WHERE l.release_id = r.id LIMIT 1)
                AS label_id
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
    label_id: number | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    year: r.year,
    label: r.label,
    labelId: r.label_id,
    /*
     * group_concat(DISTINCT ...) can only join on a comma, and a role carries
     * commas of its own: "Engineer [Sigma Sound, New York]". Splitting here
     * would cut through that, so the joined string is handed over whole and
     * the credit parser, which knows about the brackets, does the splitting.
     */
    roles: r.roles ? [r.roles] : [],
  }));
}

/** A label's releases, newest first. */
export function getLabelReleases(labelId: number, limit = 300): ArtistRelease[] {
  const db = getDb();
  if (!db) return [];

  const rows = db
    .prepare(
      // Grouped because a release can list the same label several times, once
      // per catalogue number variant: Rhythm & Sound 92 is filed as "R-N 092",
      // "RN92" and "r-n 92" on one record. Ungrouped that repeats the release
      // down the page and spends the limit on duplicates.
      //
      // min(rl.position) picks the first of those entries, and SQLite
      // guarantees the bare rl.catno comes from the row that min() matched.
      `SELECT r.id, r.title, r.year, rl.catno, min(rl.position) AS pos,
              (SELECT group_concat(ra.name, ' ') FROM release_artists ra
                WHERE ra.release_id = r.id) AS by_line
         FROM release_labels rl
         JOIN releases r ON r.id = rl.release_id
        WHERE rl.label_id = ?
        GROUP BY r.id
        ORDER BY r.year IS NULL, r.year DESC, r.title
        LIMIT ?`,
    )
    .all(labelId, limit) as {
    id: number;
    title: string;
    year: number | null;
    catno: string | null;
    pos: number;
    by_line: string | null;
  }[];

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    year: r.year,
    label: r.catno,
    labelId: null,
    roles: r.by_line ? [r.by_line] : [],
  }));
}
