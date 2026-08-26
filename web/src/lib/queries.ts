import { getDb } from "./db";
import { ALIAS_BAND_FLOOR, CORE_ARTISTS, NAMED_ARTISTS, SCENE_LABELS } from "./scene";

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
export type Relevance = "very high" | "high" | "medium" | "low" | "none";

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
  /**
   * The same five steps an artist is graded on, so one word means one thing
   * site-wide. Measured on how much of what the label released is in the
   * cluster; `very high` is the seed-label rule itself.
   */
  relevance: Relevance;
  /**
   * The share behind the grade, or null when the dump records no artist line
   * for the label at all.
   *
   * NOT a share of `artistCount`, and the page must not word it as though it
   * were. That roster is corpus artists including engineers; this is every act
   * the label released, across the whole dump.
   */
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
   * How close to the scene, on one scale for both kinds. Shown in results
   * because breadth is only an asset when a distant act looks distant: Mozart
   * is genuinely in the corpus, on 85 releases that really do credit someone
   * here, and saying so is honest where hiding him would not be.
   *
   * An artist is graded on their own work and a label on how much of what it
   * released is in the cluster. Two measures, five steps, one vocabulary, which
   * is the only way the column can be scanned as a single column.
   */
  relevance: Relevance;
  /** How a "none" artist reached the corpus. A label mate is not a collaborator. */
  connection: "collaborator" | "label mate" | "collaborator + label mate" | null;
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
  relevance: Relevance | null;
  top_artist_releases: number | null;
  first_year: number | null;
  last_year: number | null;
}

interface HitRow {
  id: number;
  name: string;
  release_count: number;
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
              g.seed_ratio,
              g.relevance,
              (SELECT max(release_count) FROM label_roster r WHERE r.label_id = l.id)
                AS top_artist_releases,
              (SELECT min(first_year) FROM label_roster r WHERE r.label_id = l.id) AS first_year,
              (SELECT max(last_year)  FROM label_roster r WHERE r.label_id = l.id) AS last_year
         FROM labels l
         LEFT JOIN label_coverage g ON g.label_id = l.id
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
    relevance: row.relevance ?? "none",
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

/**
 * The two ranked lists, built once.
 *
 * Both rank against the curated scene in `scene.ts` rather than against the
 * style seed, for the reasons set out there. The work is a handful of joins
 * over the ~19,000 releases the scene touches, which is fine once and wrong on
 * every request, so each list is built on first use and kept. The SQLite file
 * is a static artifact the app never refreshes, so there is nothing to
 * invalidate: a re-ingest means a restart either way.
 */
export const TOP_LIST_SIZE = 1000;

/** Where an entry sits: named as canon, named as relevant, or found by the data. */
export type Standing = "core" | "named" | "found";

export interface TopArtist {
  id: number;
  name: string;
  standing: Standing;
  /** Their artist-line releases that belong to the scene. */
  sceneReleases: number;
  /** Their artist-line releases in total. The pair is the honest statement. */
  lineReleases: number;
  /**
   * Every release they appear on, artist line and credits alike, straight off
   * the coverage row.
   *
   * NOT `lineReleases`, and the difference is why this field exists: Rhythm &
   * Sound is on 160 artist lines and 171 releases, the other eleven as a credit.
   * The Core Artists column is headed "Releases", so it has to be the number
   * the artist's own page prints under the same word. `lineReleases` stays as
   * the ranking's denominator, which is a different question.
   */
  releaseCount: number;
  /** Read off their coverage row, the same span the artist's own page reports. */
  firstYear: number | null;
  lastYear: number | null;
}

export interface TopLabel {
  id: number;
  name: string;
  standing: Standing;
  releaseCount: number;
  /** How much of the catalogue belongs to the scene. The pair is the statement. */
  sceneReleases: number;
  /** Core and named artists on the roster: who chose to release here. */
  coreArtists: number;
  namedArtists: number;
  /** Read off the roster, the same span the label's own page reports. */
  firstYear: number | null;
  lastYear: number | null;
}

/**
 * Discogs placeholders. Never a person, and "UNKNOWN ARTIST" ranks first on any
 * count of the artist line, so it is excluded by name and by id.
 */
const NOT_A_PERSON = `a.id <> 355 AND a.name NOT IN ('Various', 'UNKNOWN ARTIST', 'No Artist')`;

let lists: { artists: TopArtist[]; labels: TopLabel[] } | null = null;

/**
 * Standing first, then how much scene work there is, discounted by what share
 * of the artist it is. Count alone puts Aphex Twin's 61 R&S releases above a
 * producer whose whole catalogue is dub techno; the share term is what says
 * 61 of 1,003 is a visit and 65 of 73 is a home.
 */
const BAND: Record<Standing, number> = { core: 0, named: 1, found: 2 };
const weight = (scene: number, line: number) => (scene * scene) / line;

function build(): { artists: TopArtist[]; labels: TopLabel[] } {
  const db = getDb();
  if (!db) return { artists: [], labels: [] };

  // Aliases are the same person under another name, so they carry the standing
  // of the artist they belong to. Read in both directions, since the dump does
  // not always record both sides.
  const alias = db.prepare(
    `SELECT related_id AS id FROM artist_relations WHERE artist_id = ? AND kind = 'alias'
      UNION SELECT artist_id FROM artist_relations WHERE related_id = ? AND kind = 'alias'`,
  );
  const aliasesOf = (ids: number[]) => {
    const found = new Set<number>();
    for (const id of ids) {
      for (const row of alias.all(id, id) as { id: number }[]) {
        if (!ids.includes(row.id)) found.add(row.id);
      }
    }
    return found;
  };
  const coreAliases = aliasesOf(CORE_ARTISTS);
  const namedAliases = aliasesOf(NAMED_ARTISTS);
  const anchors = [
    ...new Set([...CORE_ARTISTS, ...NAMED_ARTISTS, ...coreAliases, ...namedAliases]),
  ];

  /*
   * A scene release, by the two channels the corpus itself was built from: put
   * out by a label the scene records for, or carrying a scene artist on its
   * artist line.
   *
   * Written as a CTE and repeated rather than held in a temp table, because the
   * connection is opened `query_only` and that blocks writes of every kind,
   * temp ones included. Repeating the text costs nothing: this runs twice, once
   * per process.
   */
  const SCENE_RELEASE = `scene_release AS (
      SELECT release_id FROM release_labels WHERE label_id IN (${SCENE_LABELS.join(",")})
      UNION
      SELECT release_id FROM release_artists WHERE artist_id IN (${anchors.join(",")})
    )`;

  /*
   * Driven from the scene rather than from every credit: the join starts at the
   * ~19,000 releases the scene touches instead of walking all 1.18M artist-line
   * rows, and only the artists that survive pay for a total.
   */
  const artistRows = db
    .prepare(
      `WITH ${SCENE_RELEASE},
            scene_count AS (
              SELECT ra.artist_id, count(DISTINCT ra.release_id) AS scene
                FROM scene_release s
                JOIN release_artists ra ON ra.release_id = s.release_id
               GROUP BY ra.artist_id
            )
       SELECT a.id, a.name, c.scene,
              (SELECT count(DISTINCT release_id) FROM release_artists WHERE artist_id = a.id) AS line,
              coalesce(v.release_count, 0) AS releases,
              v.first_year, v.last_year
         FROM scene_count c
         JOIN artists a ON a.id = c.artist_id
         LEFT JOIN artist_coverage v ON v.artist_id = a.id
        WHERE ${NOT_A_PERSON}`,
    )
    .all() as {
    id: number;
    name: string;
    scene: number;
    line: number;
    releases: number;
    first_year: number | null;
    last_year: number | null;
  }[];

  const standingOf = (id: number, scene: number): Standing => {
    if (CORE_ARTISTS.includes(id)) return "core";
    if (NAMED_ARTISTS.includes(id)) return "named";
    if (scene < ALIAS_BAND_FLOOR) return "found";
    if (coreAliases.has(id)) return "core";
    if (namedAliases.has(id)) return "named";
    return "found";
  };

  const artists: TopArtist[] = artistRows
    .map((r) => ({
      id: r.id,
      name: r.name,
      standing: standingOf(r.id, r.scene),
      sceneReleases: r.scene,
      lineReleases: r.line,
      releaseCount: r.releases,
      firstYear: r.first_year,
      lastYear: r.last_year,
      rank: weight(r.scene, r.line),
    }))
    .sort(
      (a, b) =>
        BAND[a.standing] - BAND[b.standing] || b.rank - a.rank || a.name.localeCompare(b.name),
    )
    .slice(0, TOP_LIST_SIZE)
    .map(({ rank: _, ...artist }) => artist);

  /*
   * A label is ranked by who chose to release on it, weighting a core artist at
   * three, and discounted by how much of the catalogue is scene work at all.
   * Without that share term Resident Advisor leads on 18 scene artists across
   * 1,123 releases, which is a podcast, not a label.
   *
   * Only the banded artists are counted, so the roster join is restricted to
   * about a hundred ids rather than walking every roster in the corpus.
   */
  const core = artists.filter((a) => a.standing === "core").map((a) => a.id);
  const named = artists.filter((a) => a.standing === "named").map((a) => a.id);

  const labelRows = db
    .prepare(
      `WITH ${SCENE_RELEASE},
            banded AS (
              SELECT rl.label_id,
                     count(DISTINCT CASE WHEN ra.artist_id IN (${core.join(",")})
                                         THEN ra.artist_id END) AS core_artists,
                     count(DISTINCT CASE WHEN ra.artist_id IN (${named.join(",")})
                                         THEN ra.artist_id END) AS named_artists
                FROM release_labels rl
                JOIN release_artists ra ON ra.release_id = rl.release_id
               WHERE ra.artist_id IN (${[...core, ...named].join(",")})
               GROUP BY rl.label_id
            ),
            totals AS (
              SELECT label_id,
                     count(DISTINCT release_id) AS releases,
                     count(DISTINCT CASE WHEN release_id IN (SELECT release_id FROM scene_release)
                                         THEN release_id END) AS scene
                FROM release_labels GROUP BY label_id
            ),
            active AS (
              SELECT label_id, min(first_year) AS first_year, max(last_year) AS last_year
                FROM label_roster GROUP BY label_id
            )
       SELECT l.id, l.name, t.releases, t.scene,
              coalesce(b.core_artists, 0)  AS core_artists,
              coalesce(b.named_artists, 0) AS named_artists,
              v.first_year, v.last_year
         FROM totals t
         JOIN labels l ON l.id = t.label_id
         LEFT JOIN banded b ON b.label_id = t.label_id
         LEFT JOIN active v ON v.label_id = t.label_id
        WHERE b.label_id IS NOT NULL OR l.id IN (${SCENE_LABELS.join(",")})`,
    )
    .all() as {
    id: number;
    name: string;
    releases: number;
    scene: number;
    core_artists: number;
    named_artists: number;
    first_year: number | null;
    last_year: number | null;
  }[];

  const labels: TopLabel[] = labelRows
    .map((r) => ({
      id: r.id,
      name: r.name,
      standing: (SCENE_LABELS.includes(r.id) ? "core" : "found") as Standing,
      releaseCount: r.releases,
      sceneReleases: r.scene,
      coreArtists: r.core_artists,
      namedArtists: r.named_artists,
      firstYear: r.first_year,
      lastYear: r.last_year,
      rank: (3 * r.core_artists + r.named_artists) * (r.releases ? r.scene / r.releases : 0),
    }))
    .filter((l) => l.rank > 0 || l.standing === "core")
    .sort(
      (a, b) =>
        BAND[a.standing] - BAND[b.standing] || b.rank - a.rank || a.name.localeCompare(b.name),
    )
    .slice(0, TOP_LIST_SIZE)
    .map(({ rank: _, ...label }) => label);

  return { artists, labels };
}

export function getTopArtists(): TopArtist[] {
  lists ??= build();
  return lists.artists;
}

export function getTopLabels(): TopLabel[] {
  lists ??= build();
  return lists.labels;
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

/**
 * What someone typed, as an FTS5 query.
 *
 * FTS5 reads bare punctuation as syntax, so the term is quoted, and given a
 * trailing wildcard to make the box behave like search rather than exact match.
 * Shared with `suggest`, so the dropdown and the page it submits to are
 * matching on the same string: a suggestion that does not survive the Enter
 * key would be worse than no suggestion at all.
 */
export function matchTerm(query: string): string {
  return `"${query.trim().replace(/"/g, '""')}"*`;
}

/**
 * How close to the scene, as a sort key. Graded first, so a sceptic searching
 * "Mozart" sees at a glance that the scene artists are the answer and he is a
 * footnote.
 *
 * Artists and labels sort against each other on the one scale, which they can
 * now that a label is graded in five steps rather than two. It used to be two
 * lists interleaved by a rule of thumb, and the rule of thumb was the reason
 * Ndagga sorted level with a label that has nothing to do with any of this.
 */
const RELEVANCE_ORDER: Record<string, number> = {
  "very high": 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

export function search(query: string, limit = 40): SearchResults {
  const db = getDb();
  if (!db || query.trim().length === 0) return { hits: [], truncated: false };

  const term = matchTerm(query);

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
              coalesce(g.relevance, 'none') AS relevance
         FROM label_search s
         JOIN labels l ON l.id = s.rowid
         LEFT JOIN label_coverage g ON g.label_id = l.id
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

  const hits: (SearchHit & { rank: number })[] = [
    ...artists.map((r) => ({
      id: r.id,
      name: r.name,
      kind: "artist" as const,
      releaseCount: r.release_count,
      relevance: r.relevance ?? "none",
      connection: connection(r),
      rank: RELEVANCE_ORDER[r.relevance ?? "none"]!,
    })),
    ...labels.map((r) => ({
      id: r.id,
      name: r.name,
      kind: "label" as const,
      releaseCount: r.release_count,
      relevance: r.relevance ?? "none",
      connection: null,
      rank: RELEVANCE_ORDER[r.relevance ?? "none"]!,
    })),
  ];

  return {
    hits: hits
      .sort((a, b) => a.rank - b.rank || b.releaseCount - a.releaseCount)
      .map(({ rank: _, ...hit }) => hit),
    truncated: artists.length === limit || labels.length === limit,
  };
}

export interface Suggestion {
  id: number;
  name: string;
  kind: "artist" | "label";
  /**
   * The same five steps as everywhere else. A dropdown that ranked names and
   * said nothing about why would be ordering by a measure it keeps to itself,
   * which is the one thing this interface does not do.
   */
  relevance: Relevance;
}

/**
 * Below this, the dropdown stays shut.
 *
 * A single letter matches 49,018 artists and costs 300 ms to rank, against
 * 65 ms for two. It is a load rule before it is a design one, but it is both:
 * "a" is not yet a question.
 */
export const SUGGEST_MIN_CHARS = 2;

/**
 * The shortlist under the search box: what you are probably typing.
 *
 * A cut-down `search`, and cut down in the two places that cost: it reads
 * fewer columns, and it never counts releases across every label a prefix
 * matches. That count is what orders a label against an artist, so it cannot
 * be dropped, only deferred — the grade picks the shortlist, and only those
 * few rows are costed. On a two-letter prefix that is 8 subqueries instead of
 * 9,438, and 69 ms instead of 88.
 *
 * Ordered exactly as the results page orders the same names, because this list
 * is a shortcut into that page and not a second opinion about it.
 */
export function suggest(query: string, limit = 8): Suggestion[] {
  const db = getDb();
  if (!db || query.trim().length < SUGGEST_MIN_CHARS) return [];

  const term = matchTerm(query);

  const artists = db
    .prepare(
      `SELECT a.id, a.name, coalesce(c.release_count, 0) AS release_count,
              coalesce(c.relevance, 'none') AS relevance
         FROM artist_search s
         JOIN artists a ON a.id = s.rowid
         LEFT JOIN artist_coverage c ON c.artist_id = a.id
         LEFT JOIN corpus_artists  m ON m.artist_id = a.id
        WHERE artist_search MATCH ?
        ORDER BY coalesce(m.is_seed, 0) DESC, release_count DESC
        LIMIT ?`,
    )
    .all(term, limit) as HitRow[];

  const labels = db
    .prepare(
      `SELECT t.id, t.name, t.relevance,
              (SELECT count(DISTINCT rl.release_id)
                 FROM release_labels rl WHERE rl.label_id = t.id) AS release_count
         FROM (SELECT l.id, l.name, coalesce(g.relevance, 'none') AS relevance,
                      coalesce(g.line_artist_count, 0) AS roster
                 FROM label_search s
                 JOIN labels l ON l.id = s.rowid
                 LEFT JOIN label_coverage g ON g.label_id = l.id
                WHERE label_search MATCH ?
                ORDER BY CASE coalesce(g.relevance, 'none')
                           WHEN 'very high' THEN 0 WHEN 'high' THEN 1
                           WHEN 'medium'    THEN 2 WHEN 'low'  THEN 3 ELSE 4 END,
                         roster DESC
                LIMIT ?) t`,
    )
    .all(term, limit) as HitRow[];

  const shortlist = [
    ...artists.map((r) => ({ ...r, kind: "artist" as const })),
    ...labels.map((r) => ({ ...r, kind: "label" as const })),
  ];

  return shortlist
    .sort(
      (a, b) =>
        RELEVANCE_ORDER[a.relevance ?? "none"]! - RELEVANCE_ORDER[b.relevance ?? "none"]! ||
        b.release_count - a.release_count,
    )
    .slice(0, limit)
    .map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind,
      relevance: r.relevance ?? "none",
    }));
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
