import type { Database } from "better-sqlite3";

import { getDb } from "./db";
import { rankCredits } from "./roles";
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
  /**
   * Why this grade, when a person set it rather than the measure or a tradition.
   *
   * NULL for all but a handful. When set, `overrides.artists` named them and
   * this is the clause the page prints in place of the measured one.
   */
  overrideReason: string | null;
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
  /**
   * Why this grade, when a person set it rather than the ratio.
   *
   * NULL for almost every label. When it is set, the grade above came from
   * `overrides.labels` in the ingest config, and this replaces the ratio clause
   * the page would otherwise print — which would then be describing a
   * measurement the grade no longer follows.
   */
  overrideReason: string | null;
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
  kind: "artist" | "label" | "release";
  /**
   * Releases behind the name, and null for a record, which the page prints as
   * "N/A": a pressing is one thing rather than a body of work, and a count of 1
   * in that column would be a figure invented to fill it.
   */
  releaseCount: number | null;
  /**
   * The line under the name, on records only: who made it and when.
   *
   * Not decoration. "Biokinetics" matches 15 rows and "Phylyps Trak" ten, all
   * of them the same record pressed again, so a list of bare titles would be
   * the search offering fifteen identical answers.
   */
  detail: string | null;
  /**
   * How close to the cluster, on the five steps the whole site reads.
   *
   * A name answers for itself. A record inherits, because it has no body of
   * work of its own to measure and because the ranking already halves it by
   * exactly this figure: the column was the one part of the page not saying
   * what the order was built on. `gradedOn` says which of the two answered.
   */
  relevance: Relevance;
  /** Records only: whether the grade above is the artist's or the label's. */
  gradedOn: GradedOn | null;
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
  override_reason: string | null;
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
  override_reason: string | null;
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
              c.override_reason,
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
    overrideReason: row.override_reason,
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
              g.override_reason,
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
    overrideReason: row.override_reason,
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
   * Whether the ranking had more to show than the page asked for. Reported
   * rather than inferred from the total, because "40 found" would be stating
   * the cap as if it were a count. Of the open tab, not of the ranking: the
   * heading counts what is on the page.
   */
  truncated: boolean;
  /**
   * How many are behind each tab, counted before the slice.
   *
   * The tab row shows all three whichever one is open, which is what makes the
   * split legible: a query answering nothing under Artists & Labels says so
   * with a 0 beside the word rather than by looking broken.
   */
  counts: Record<SearchKind, number>;
  /**
   * Whether a tab's count is really the cap it was measured under.
   *
   * The pools are 200 a kind, so a broad query fills them and `counts` stops
   * being a total: it becomes RANK_POOL wearing a total's clothes. The heading
   * says "Closest 200" there and "57 found" where the number is real, which is
   * the same rule `truncated` was written for — never state the cap as if it
   * were a count. Per kind, because a query can saturate the names pool and
   * still have four records behind the other tab.
   */
  capped: Record<SearchKind, boolean>;
  /** The tab actually answered, which is what `"auto"` resolved to. */
  kind: SearchKind;
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
 * The five steps as a number, so a grade can be arithmetic rather than a gate.
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

/**
 * How much of this scene a name actually accounts for, as one number for both
 * kinds: releases the cluster explains, halved for each step down the grade.
 *
 * Sorting on the grade alone was a bug, and a bad one, because the grade is a
 * ratio and a ratio needs work behind it before it describes anything. Label
 * `very high` has a floor of two seed artists, so a one-record imprint with a
 * perfect ratio outranked the canonical name: A Ghostly Ghost Productions (1
 * release) above Ghostly International (508), Simon Shackleton Music (2) above
 * Shackleton (118), and `moritz` never reaching Moritz von Oswald at all
 * because four smaller Moritzes graded a step higher. The failures clustered
 * on exactly the names this tool exists to serve.
 *
 * Volume alone overcorrects the other way, so the grade stays in as a discount
 * rather than a gate: Moritz Illner has 30 seed releases of 184 and should not
 * sit above the Moritz von Oswald Trio's 28 of 33. Halving per step is the
 * whole rule, and it is deliberately one rule rather than five hand-set
 * weights: a step of the scale is worth a doubling of the work.
 *
 * Typing a name exactly is worth one step of it. Bounded on purpose, because
 * name matching is the same trap as the grade when it gates: ranking exact
 * matches first hands `basic` to five unrelated acts called "Basic (2)". Worth
 * a step, it moves almost nothing else.
 */
function sceneScore(sceneReleases: number, relevance: Relevance, exactName: boolean): number {
  const step = RELEVANCE_ORDER[relevance] ?? RELEVANCE_ORDER.none!;
  /*
   * A doubling, not a step taken off the discount, and the difference only
   * shows at the top of the scale. `step - 1` has nothing to subtract when the
   * step is already 0, so `very high` was the one grade where typing a name
   * exactly bought nothing at all — the rule read as one sentence and behaved
   * as another on every top-step name on the site. At every other grade the two
   * spellings are the same arithmetic, which is why this changes nothing else:
   * dividing by 2^(step-1) IS doubling and then dividing by 2^step.
   */
  return (sceneReleases / 2 ** step) * (exactName ? 2 : 1);
}

/**
 * A name as someone would type it: Discogs' "(3)" disambiguator is how the
 * database tells five labels called Pan apart, not part of the name anyone
 * has in mind.
 */
function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** 0 exact, 1 starts with what was typed, 2 matched somewhere later. */
function nameRank(query: string, name: string): number {
  const typed = normaliseName(query);
  const actual = normaliseName(name);
  if (actual === typed) return 0;
  return actual.startsWith(typed) ? 1 : 2;
}

/**
 * The pool each query is ranked from, per kind.
 *
 * Wider than the number of rows anyone sees, because the SQL used to order by
 * one thing and the page by another: a row cut here can never be ranked, which
 * is how Pan (3) came 21st for `pan` and was still the best answer on the
 * page. The width itself is free, measured at 200 against 40: what a query
 * costs is settled by the FTS scan and by ordering on a figure every match has
 * to be costed for, neither of which cares how many rows come back.
 */
const RANK_POOL = 200;

/**
 * Which of the two answered for a record's grade.
 *
 * `artist` on 97.1% of release rows, `label` on the compilations behind the
 * rest, and `none` where neither has one. A name always answers for itself, so
 * this is a record's field and nothing else's.
 */
export type GradedOn = "artist" | "label" | "none";

interface ScoredRow extends HitRow {
  kind: "artist" | "label" | "release";
  scene_releases: number;
  /** Records only: see `GradedOn`. */
  graded_on?: GradedOn;
  /** Records only, and only for the tie-break below. */
  year?: number | null;
  /** Records only: the line the page prints under the title. */
  detail?: string | null;
  /** Records only: the lead name, which is what makes two rows the same record. */
  artist?: string | null;
}

/** One order for the results page and the dropdown, so one is a shortcut into the other. */
function rankHits(query: string, rows: ScoredRow[]): ScoredRow[] {
  const score = (r: ScoredRow) => {
    const own = sceneScore(r.scene_releases, r.relevance ?? "none", nameRank(query, r.name) === 0);
    /*
     * A record sits one step below the name that made it, which is the same
     * halving the grade already uses: a step of the scale is worth a doubling
     * of the work. Without it a record ties with its own artist, and "basic
     * channel" answers with a pressing before it answers with Basic Channel.
     */
    return r.kind === "release" ? own / 2 : own;
  };

  /*
   * Undated last, earliest first, and only between two records.
   *
   * Ten pressings of Phylyps Trak carry one artist, one label and one title,
   * so nothing above this line separates them: the artist figure is identical
   * by construction. The year is the only thing that distinguishes an original
   * from a repress, and three of those ten have no year at all, which is the
   * honest reason they sort last rather than first.
   */
  const dated = (r: ScoredRow) => r.year ?? Number.POSITIVE_INFINITY;

  return rows.sort(
    (a, b) =>
      score(b) - score(a) ||
      nameRank(query, a.name) - nameRank(query, b.name) ||
      (a.kind === "release" && b.kind === "release" ? dated(a) - dated(b) : 0) ||
      b.release_count - a.release_count,
  );
}

/**
 * Every artist matching the term, ranked-pool sized, with the scene work each
 * one accounts for. `seed_releases` is that figure for most people: releases of
 * theirs inside the cluster the seed measured.
 *
 * It is not that figure for anyone the seed cannot see, which is the King Tubby
 * problem arriving one layer along. Lineage exists because the seed measures
 * dub techno and therefore scores a Jamaican dub engineer, a Detroit originator
 * or a dubstep producer at nothing. That fixed the grade and left the sort key
 * reading the same blind measure: 2,820 lineage artists had a score of exactly
 * zero, Loefah, Silkie and Commodo among them, surviving only on tiebreakers.
 * `commodo` returned Commodore C 64 first, `scientist` put Scientist third
 * behind Full Moon Scientist, `atkins` put Martin Atkins above Juan Atkins.
 *
 * So a tradition scores on the artist's corpus output instead, halved: one step
 * of the same rule the grade uses, paid because the corpus cannot tell which
 * part of that output is the tradition. Floored at `seed_releases`, so it only
 * ever lifts.
 *
 * **A hand-written override is floored the same way, and for the same reason.**
 * Naming someone in `overrides.artists` sets the grade, and the grade is only a
 * discount on this figure: promote an artist the seed scores at zero and zero
 * is what stays, so the word on the page moves and the search order does not.
 * That is this exact bug a third time, on names picked deliberately — which
 * would be the worst version of it, since the whole point of naming someone is
 * that you want them found. Full release count was measured and is too strong: it puts Jan
 * Delay above Vladislav Delay. Half moves 20 of 105 queries and none the wrong
 * way: Juan Atkins, Carl Craig, Mike Banks, King Tubby, Scientist and Commodo
 * all come first, and `delay` and `prince` are untouched.
 *
 * Ported from `main` (`1a414be`), where releases were not yet an entity. The
 * same blindness reaches `release_rank.weight` in `derive`, which inherits this
 * figure, and fixing only this half would leave the records of every lifted
 * artist weighted at nothing. Both are done.
 */
function artistPool(db: Database, term: string): ScoredRow[] {
  return db
    .prepare(
      `SELECT a.id, a.name, coalesce(c.release_count, 0) AS release_count,
              max(coalesce(c.seed_releases, 0),
                  CASE WHEN c.lineage IS NOT NULL OR c.override_reason IS NOT NULL
                       THEN coalesce(c.release_count, 0) / 2 ELSE 0 END) AS scene_releases,
              coalesce(m.channel_a, 0) AS channel_a,
              coalesce(m.channel_b, 0) AS channel_b,
              coalesce(c.relevance, 'none') AS relevance
         FROM artist_search s
         JOIN artists a ON a.id = s.rowid
         LEFT JOIN artist_coverage c ON c.artist_id = a.id
         LEFT JOIN corpus_artists  m ON m.artist_id = a.id
        WHERE artist_search MATCH ?
        ORDER BY scene_releases DESC, release_count DESC
        LIMIT ?`,
    )
    .all(term, RANK_POOL)
    .map((r) => ({ ...(r as HitRow & { scene_releases: number }), kind: "artist" as const }));
}

/**
 * The same for labels, and the figure is measured rather than estimated.
 *
 * It used to be the release count times the roster share, described here as the
 * one unit an artist and a label could be compared in. It was not one unit. An
 * artist's `seed_releases` counts releases of theirs actually inside the
 * cluster; the label figure multiplied a release count by a share of PEOPLE,
 * which answers a question about records with a fact about the roster. The two
 * come apart because a seed artist needs only 2% of their own output inside the
 * seed, so a label can have half its roster in the cluster and almost none of
 * its own records there.
 *
 * Measured: Planet Rhythm Records read 764 against a true 126 and beat Rhythm &
 * Sound, whose 160 was strict because an artist's always was. Tresor read 27
 * against 9, Chain Reaction 105 against 80, and a label wholly in the scene
 * like Rhythm & Sound read 57 against 57 — the inflation scales with catalogue
 * size and roster share, so it fell hardest on the large labels the second seed
 * gate was written to admit, and not at all on the pure imprints.
 *
 * `label_coverage.seed_releases` is that count, written once in `derive`. The
 * grade still reads the roster ratio, deliberately: what a label puts out and
 * who it puts out are different claims, and the grade has always been the
 * second one.
 */
function labelPool(db: Database, term: string): ScoredRow[] {
  return db
    .prepare(
      // Wrapped, because the scene figure is built from the release count and
      // SQLite cannot read one select-list alias from another.
      `SELECT t.id, t.name, t.release_count, t.relevance, t.scene_releases
         FROM (SELECT l.id, l.name,
                      (SELECT count(DISTINCT rl.release_id)
                         FROM release_labels rl WHERE rl.label_id = l.id) AS release_count,
                      coalesce(g.relevance, 'none') AS relevance,
                      coalesce(g.seed_releases, 0) AS scene_releases
                 FROM label_search s
                 JOIN labels l ON l.id = s.rowid
                 LEFT JOIN label_coverage g ON g.label_id = l.id
                WHERE label_search MATCH ?) t
        ORDER BY scene_releases DESC, t.release_count DESC
        LIMIT ?`,
    )
    .all(term, RANK_POOL)
    .map((r) => ({ ...(r as HitRow & { scene_releases: number }), kind: "label" as const }));
}

/**
 * Records matching the term, ranked by the name that made them.
 *
 * A release carries no grade and no ratio of its own: a grade measures a body
 * of work against the cluster, and one pressing is not a body of work. So it
 * inherits the lead artist's figure and the lead artist's grade, which is also
 * what makes the order defensible: a record ranks where its maker ranks, one
 * step down.
 *
 * Two queries, and the split is the whole performance story. "re" matches about
 * 200,000 titles, and reaching the artist line and the coverage row for each of
 * them to find that figure cost 103 ms — a 196 ms page against the 84 ms that
 * was the worst case before records were searchable. `release_rank` is that
 * figure precomputed in `derive`, three columns wide so the ranking pass reads
 * a 15 MB table instead of the 60 MB one a title and an artist name would make.
 * The wide row is then read for the 200 that survive, which is the trade the
 * rest of the architecture already makes.
 *
 * The lead name rather than the whole line, matching the release page's own
 * headline: 133,205 releases credit more than one act, and a search row has no
 * room for a sentence. `left join`, because a record credited to someone the
 * corpus never admitted as an artist should still be findable by title.
 */
function releasePool(db: Database, term: string): ScoredRow[] {
  const ids = db
    .prepare(
      `SELECT s.rowid AS id
         FROM release_search s
         JOIN release_rank k ON k.release_id = s.rowid
        WHERE release_search MATCH ?
        ORDER BY k.weight DESC, k.year IS NULL, k.year
        LIMIT ?`,
    )
    .pluck()
    .all(term, RANK_POOL) as number[];

  if (ids.length === 0) return [];

  /*
   * The grade a record shows is the lead artist's, and the label's when there
   * is no artist to ask.
   *
   * Inheriting is not a new claim: `rankHits` has always halved a record's
   * weight by exactly this figure, so the order was already built on it and the
   * column was the one thing not saying so. Measured over 50 queries, 97.1% of
   * release rows have an artist grade to inherit.
   *
   * The other 2.9% are compilations, every one of them, and the fallback is the
   * label's own grade on the same five steps. Corpus-wide 108,751 releases,
   * 9.9%, have a lead with no coverage row; all 108,751 have no artist page at
   * all and 70,114 are literally named `Various`, which is a record with no
   * single maker rather than a gap in the data. 96.4% of them do have a graded
   * label. `graded_on` says which of the two answered, because the column reads
   * one scale and the reason behind a step is not the same reason twice.
   *
   * **It cannot move the ranking, and that was checked rather than assumed.**
   * `sceneScore` is `scene_releases / 2 ** step`, and a record with no artist
   * coverage has no `seed_releases` either, so its score is zero whatever the
   * grade divides it by. The fallback fills a column and touches no order.
   *
   * `c.relevance` is NOT NULL in its table, so only a missing row falls through
   * to the label: an artist genuinely graded `none` keeps `none` and is not
   * quietly regraded on the room they released in.
   *
   * **The scene figure inherits the lead artist's LIFTED figure, not the bare
   * measure, and this is the third reader of that measure rather than the
   * first.** `artistPool` above and `release_rank.weight` in `derive` are the
   * other two. The seed cannot see dub, reggae, dubstep, Detroit, afrobeat or
   * jazz, so reading `seed_releases` here scored every record by a lineage
   * artist at nothing: `commodo` answered with Commodore Dub and `scientist`
   * with Full Moon Scientist, while the artists themselves were already fixed
   * one function up. Same expression in all three, deliberately, because one
   * measure read three ways is exactly what caused this.
   *
   * The paragraph above still holds: a record with no coverage row has no
   * lineage to lift it either, so the max() is still zero and the label
   * fallback still moves no order.
   *
   * A hand-written override floors it the same way a tradition does, and that
   * clause was missing here for a day: `artistPool` got it and these two did
   * not, so The Dub Sync scored 1 while every record of its own scored 0.25.
   * Third time this measure has been patched in one reader and left in the
   * others. All three now spell it identically, which is the only defence.
   */
  const rows = db
    .prepare(
      `SELECT r.id, r.title AS name, 0 AS release_count, r.year,
              lead_artist.name AS artist,
              max(coalesce(c.seed_releases, 0),
                  CASE WHEN c.lineage IS NOT NULL OR c.override_reason IS NOT NULL
                       THEN coalesce(c.release_count, 0) / 2 ELSE 0 END) AS scene_releases,
              coalesce(c.relevance, g.relevance, 'none') AS relevance,
              CASE WHEN c.relevance IS NOT NULL THEN 'artist'
                   WHEN g.relevance IS NOT NULL THEN 'label'
                   ELSE 'none' END AS graded_on
         FROM releases r
         LEFT JOIN release_artists lead_artist
                ON lead_artist.release_id = r.id AND lead_artist.position = 0
         LEFT JOIN artist_coverage c ON c.artist_id = lead_artist.artist_id
         LEFT JOIN release_labels rl ON rl.release_id = r.id AND rl.position = 0
         LEFT JOIN label_coverage g ON g.label_id = rl.label_id
        WHERE r.id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids) as (HitRow & {
    scene_releases: number;
    year: number | null;
    artist: string | null;
    graded_on: GradedOn;
  })[];

  /*
   * Back into the order the first query settled. `IN` returns rows in whatever
   * order the index hands them over, and the ranking below is stable, so
   * skipping this would quietly re-sort every tie by release id.
   */
  const byId = new Map(rows.map((r) => [r.id, r]));

  return ids
    .map((id) => byId.get(id))
    .filter((r): r is (typeof rows)[number] => Boolean(r))
    .map((r) => ({
      ...r,
      kind: "release" as const,
      artist: r.artist,
      graded_on: r.graded_on,
      detail: [r.artist, r.year].filter(Boolean).join(" · ") || null,
    }));
}

/**
 * One row per record, not one per pressing.
 *
 * `phylyps` answered with three rows reading "Phylyps Trak · Basic Channel ·
 * 1993" and `biokinetics` with fifteen, which is one record pressed again and
 * a list spending every row it has saying so. Ten pressings are ten real rows
 * in the corpus and each still has its own page, reachable from the artist and
 * the label; what they are not is ten answers to a question, and this list has
 * no column for the things that actually tell them apart, since format and
 * country are on the page rather than in the row.
 *
 * Title and artist rather than title alone, because two acts really do use one
 * title and collapsing those would hide an answer rather than a duplicate. The
 * ranking has already put the earliest pressing first, so keeping the first one
 * seen is keeping the original rather than a repress.
 */
function oneRowPerRecord(rows: ScoredRow[]): ScoredRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (r.kind !== "release") return true;
    const key = `${r.name}\u0000${r.artist ?? ""}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Which question the results page is answering, same three as the dropdown.
 *
 * The page splits rather than filters: these are slices of one ranking, so a
 * row keeps the position it already had and the tabs cannot disagree with the
 * order. `names` is the default because it is the question this tool exists to
 * answer, and because it is the dropdown's default, and a shortcut that lands
 * you somewhere other than where it was pointing is not a shortcut.
 */
export type SearchKind = "names" | "releases" | "all";

/**
 * Ranks once and answers one tab.
 *
 * `"auto"` is the page arriving without a `?tab=`, and it resolves to the
 * preferred tab unless that one is empty. It has to be settled in here rather
 * than by the caller, because the fallback needs the counts and the counts need
 * the ranking: asking for them first would run both pools twice, which on the
 * worst two-letter prefix in the corpus is 84 ms paid again for an answer
 * already in hand. The resolved tab comes back on `kind`.
 */
export function search(
  query: string,
  limit = 40,
  want: SearchKind | "auto" = "auto",
): SearchResults {
  const db = getDb();
  const empty = {
    hits: [],
    truncated: false,
    counts: { names: 0, releases: 0, all: 0 },
    capped: { names: false, releases: false, all: false },
    kind: "names" as SearchKind,
  };
  if (!db || query.trim().length === 0) return empty;

  const term = matchTerm(query);
  const artists = artistPool(db, term);
  const labels = labelPool(db, term);
  const releases = releasePool(db, term);

  const connection = (r: ScoredRow): SearchHit["connection"] => {
    if (r.kind !== "artist") return null;
    if (r.channel_a === 1 && r.channel_b === 1) return "collaborator + label mate";
    if (r.channel_a === 1) return "collaborator";
    if (r.channel_b === 1) return "label mate";
    return null;
  };

  const ranked = oneRowPerRecord(rankHits(query, [...artists, ...labels, ...releases]));

  /*
   * Counted before the slice, because the tab row has to say how many are
   * behind each tab and not how many fit on this page. Free, since the pools
   * had to run to produce the ranking either way.
   */
  const names = ranked.filter((r) => r.kind !== "release");
  const records = ranked.filter((r) => r.kind === "release");
  const counts = { names: names.length, releases: records.length, all: ranked.length };

  /*
   * A pool that came back exactly full is a pool that was cut short. Read off
   * the pools rather than off `counts`, since the record collapse can take a
   * saturated 200 down to 180 and hide that it was ever clipped.
   */
  const fullNames = artists.length === RANK_POOL || labels.length === RANK_POOL;
  const fullRecords = releases.length === RANK_POOL;
  const capped = {
    names: fullNames,
    releases: fullRecords,
    all: fullNames || fullRecords,
  };

  const kind: SearchKind =
    want !== "auto"
      ? want
      : ((["names", "releases", "all"] as const).find((k) => counts[k] > 0) ?? "names");

  const shown = kind === "names" ? names : kind === "releases" ? records : ranked;

  return {
    counts,
    capped,
    kind,
    hits: shown
      .slice(0, limit)
      .map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        releaseCount: r.kind === "release" ? null : r.release_count,
        detail: r.detail ?? null,
        relevance: r.relevance ?? "none",
        gradedOn: r.kind === "release" ? (r.graded_on ?? "none") : null,
        connection: connection(r),
      })),
    truncated: shown.length > limit,
  };
}

export interface Suggestion {
  id: number;
  name: string;
  kind: "artist" | "label" | "release";
  /**
   * The grade, on artists and labels and nowhere else.
   *
   * It left with the results column it mirrored on 2026-09-08, because a record
   * has no grade and a third of one merged list had no word to show. The tabs
   * are what bring it back: on the tab that holds only artists and labels,
   * every row has one, so the column answers for all of it rather than for
   * two kinds out of three. `null` on a record, and the row prints the lead
   * name there instead — the one thing that tells one pressing from another.
   */
  relevance: Relevance | null;
  /** Records only: who made it, which is a record's version of the grade. */
  artist: string | null;
}

/** The three tabs, each a slice of one ranking rather than a list of its own. */
export interface SuggestGroups {
  names: Suggestion[];
  releases: Suggestion[];
  all: Suggestion[];
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
 * Four rows a tab, and it was three until records became searchable. Three was
 * the number when every row was a name and the only question was which name;
 * with records in the list a query answers two questions at once, and the
 * fourth row is what keeps the second one from pushing the first off the
 * bottom. Past the fourth the old argument still holds, that the ranking starts
 * putting a name nobody typed under one they did, and what does not fit belongs
 * on the results page, one keystroke away and built for forty.
 *
 * Three tabs, and they are three slices of ONE ranking rather than three
 * lists. The order is the results page's order throughout, so this stays a
 * shortcut into that page and not a second opinion about it: filtering a total
 * order by kind leaves the survivors in the order they were already in.
 *
 * All three are costed and returned together, on one fetch. The pools have to
 * run anyway to know which tabs have anything behind them, so slicing the same
 * ranked array three ways is free, and it buys a tab switch that costs no
 * request at all — which is the right price for a control read at a glance
 * while the hands are still on the keys.
 *
 * The same pools and the same ranking as `search`. It used to shortlist by
 * grade first and cost the release count on only the three rows that survived,
 * which was cheap and wrong: the count is what puts a label and an artist on
 * one scale, so deferring it meant the shortlist was picked by a measure it
 * could not yet apply. Paying it up front takes the worst two-letter prefix in
 * the corpus, "re", from 39 ms to 84 ms, and an ordinary one from about 23 to
 * 30. That is the same budget that set SUGGEST_MIN_CHARS, where a single letter
 * cost 300 ms and two cost 65, and the answers are cached for five minutes and
 * per keystroke besides.
 */
export function suggest(query: string, limit = 4): SuggestGroups {
  const db = getDb();
  const empty = { names: [], releases: [], all: [] };
  if (!db || query.trim().length < SUGGEST_MIN_CHARS) return empty;

  const term = matchTerm(query);

  const ranked = oneRowPerRecord(
    rankHits(query, [...artistPool(db, term), ...labelPool(db, term), ...releasePool(db, term)]),
  );

  const row = (r: ScoredRow): Suggestion => ({
    id: r.id,
    name: r.name,
    kind: r.kind,
    relevance: r.kind === "release" ? null : (r.relevance ?? "none"),
    /*
     * The year is on the results page and not here. A shortlist is read at a
     * glance in a column the width of the search field, and "Basic Channel ·
     * 1993" is a line that has to be read rather than seen; what tells one row
     * from another at that width is the name that made it. The pressings are
     * collapsed by then anyway, so the year is answering a question the row no
     * longer raises.
     */
    artist: r.kind === "release" ? (r.artist ?? null) : null,
  });

  const take = (rows: ScoredRow[]) => rows.slice(0, limit).map(row);

  return {
    names: take(ranked.filter((r) => r.kind !== "release")),
    releases: take(ranked.filter((r) => r.kind === "release")),
    all: take(ranked),
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

/**
 * An artist's releases, newest first, with what they did on each.
 *
 * `exclude` is for the release page's "more from" list, where the record you
 * are already on is not more of anything.
 */
export function getArtistReleases(
  artistId: number,
  limit = 300,
  exclude: number | null = null,
): ArtistRelease[] {
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
        WHERE r.id <> ?
        GROUP BY r.id
        ORDER BY r.year IS NULL, r.year DESC, r.title
        LIMIT ?`,
    )
    .all(artistId, artistId, artistId, exclude ?? -1, limit) as {
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

/**
 * A label's releases, newest first.
 *
 * No `exclude` here, unlike the artist's: the release page's "more from label"
 * tab was the only caller that needed to drop the record you are on, and that
 * tab is gone.
 */
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

export interface ReleaseArtist {
  id: number;
  name: string;
  joinPhrase: string | null;
  inCorpus: boolean;
}

export interface ReleaseLabel {
  id: number;
  name: string;
  catno: string | null;
}

/** The carrier, in parts. `formatLine` writes the sentence. */
export interface ReleaseFormatRow {
  name: string;
  qty: number;
  text: string | null;
  descriptions: string[];
}

export interface ReleaseTrack {
  /** "A1", or null on a heading row, which the dump writes as a track. */
  position: string | null;
  title: string;
  duration: string | null;
}

export interface ReleaseCredit {
  id: number;
  name: string;
  inCorpus: boolean;
  /** Raw stored strings. `creditLine` names them at display time. */
  roles: string[];
}

export interface Release {
  id: number;
  title: string;
  year: number | null;
  /** The date as the dump wrote it. Often just a year: see `releasedOn`. */
  released: string | null;
  country: string | null;
  artists: ReleaseArtist[];
  labels: ReleaseLabel[];
  formats: ReleaseFormatRow[];
  /**
   * Titles and positions, and nothing else. A track is not an entity: it has no
   * id here, no credits and no page, which is the scope line holding.
   */
  tracks: ReleaseTrack[];
  /**
   * How this record entered the corpus. A fact about the boundary, not a
   * grade: a single release has no body of work behind it to measure.
   */
  isSeed: boolean;
  channelA: boolean;
  channelB: boolean;
}

/**
 * Whether a credited name has a page to pivot to.
 *
 * Most do not: 379,447 of the ids in `release_credits` never became corpus
 * artists, because `channelAMaxPeopleToAdmit` stops a crowded record admitting
 * anyone new. The eight Senegalese players on 800% Ndagga are the case that
 * matters, and a chip that answers with a 404 is the interface claiming a page
 * it does not hold.
 *
 * Artist 355 is excluded by hand. It is Discogs' "UNKNOWN ARTIST" placeholder
 * and it does have a row, so the join alone would offer a link to a page about
 * nobody; the corpus already refuses to treat it as a person elsewhere.
 */
const HAS_PAGE = `(a.id IS NOT NULL AND a.id <> 355)`;

/** One release: what it is called, who is on the line, and where it came out. */
export function getRelease(id: number): Release | null {
  const db = getDb();
  if (!db) return null;

  const row = db
    .prepare(
      `SELECT id, title, year, released, country, is_seed, channel_a, channel_b
         FROM releases WHERE id = ?`,
    )
    .get(id) as
    | {
        id: number;
        title: string;
        year: number | null;
        released: string | null;
        country: string | null;
        is_seed: number;
        channel_a: number;
        channel_b: number;
      }
    | undefined;

  if (!row) return null;

  const artists = db
    .prepare(
      `SELECT ra.artist_id AS id, ra.name, ra.join_phrase, ${HAS_PAGE} AS in_corpus
         FROM release_artists ra
         LEFT JOIN artists a ON a.id = ra.artist_id
        WHERE ra.release_id = ?
        ORDER BY ra.position`,
    )
    .all(id) as { id: number; name: string; join_phrase: string | null; in_corpus: number }[];

  const labels = db
    .prepare(
      // Grouped by label, because a release lists the same one once per
      // catalogue number variant: Rhythm & Sound 92 is filed as "R-N 092",
      // "RN92" and "r-n 92" on a single record. Those are three spellings of
      // one number, so the page shows the first rather than all three.
      // min(position) picks it, and SQLite takes the bare catno from that row.
      `SELECT rl.label_id AS id, rl.name, rl.catno, min(rl.position) AS pos
         FROM release_labels rl
        WHERE rl.release_id = ?
        GROUP BY rl.label_id
        ORDER BY pos`,
    )
    .all(id) as { id: number; name: string; catno: string | null; pos: number }[];

  const formats = db
    .prepare(
      `SELECT name, qty, text, descriptions FROM release_formats
        WHERE release_id = ? ORDER BY position`,
    )
    .all(id) as { name: string; qty: number; text: string | null; descriptions: string | null }[];

  const tracks = db
    .prepare(
      /*
       * A track with no title is not a track, it is half an entry: 87 rows
       * across 18 releases carry a printed position and nothing else, and on
       * the page they render as a number with empty space beside it, which
       * reads as a broken row rather than as a gap in the data.
       *
       * Dropped here rather than at parse time, because the rows are honest
       * about what the dump holds and re-running `enrich` to remove them costs
       * a full read of a 100 GB file. Dropping cannot empty a tracklist, since
       * no release in the corpus is untitled all the way down, and cannot
       * renumber anything, since `position` is the label printed on the record
       * rather than an index into this list.
       */
      `SELECT position, title, duration FROM release_tracks
        WHERE release_id = ? AND trim(title) <> '' ORDER BY seq`,
    )
    .all(id) as ReleaseTrack[];

  return {
    id: row.id,
    title: row.title,
    year: row.year,
    released: row.released,
    country: row.country,
    artists: artists.map((a) => ({
      id: a.id,
      name: a.name,
      joinPhrase: a.join_phrase,
      inCorpus: a.in_corpus === 1,
    })),
    labels: labels.map((l) => ({ id: l.id, name: l.name, catno: l.catno })),
    formats: formats.map((f) => ({
      name: f.name,
      qty: f.qty,
      text: f.text,
      descriptions: f.descriptions ? f.descriptions.split("\n").filter(Boolean) : [],
    })),
    tracks,
    isSeed: row.is_seed === 1,
    channelA: row.channel_a === 1,
    channelB: row.channel_b === 1,
  };
}

/**
 * Everyone credited on a release, one row each, ranked by what they did.
 *
 * Whole rather than paged, and it can be: the median record carries six
 * credits and the heaviest in the corpus carries 935. The ranking counts the
 * roles a row prints, which is a display-time reading of the raw strings, so
 * it cannot be done in SQL and a LIMIT here would page the wrong set.
 */
export function getReleaseCredits(releaseId: number): ReleaseCredit[] {
  const db = getDb();
  if (!db) return [];

  const rows = db
    .prepare(
      // One row per person, however many credits they hold: Mark Ernestus is
      // three rows on 800% Ndagga and one line on the page. group_concat can
      // only join on a comma and a role carries commas of its own, so the
      // joined string is handed over whole for the credit parser to split.
      `SELECT rc.artist_id AS id, rc.name, group_concat(rc.role) AS roles,
              min(rc.position) AS pos, ${HAS_PAGE} AS in_corpus
         FROM release_credits rc
         LEFT JOIN artists a ON a.id = rc.artist_id
        WHERE rc.release_id = ?
        GROUP BY rc.artist_id
        ORDER BY pos`,
    )
    .all(releaseId) as {
    id: number;
    name: string;
    roles: string | null;
    pos: number;
    in_corpus: number;
  }[];

  return rankCredits(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      inCorpus: r.in_corpus === 1,
      roles: r.roles ? [r.roles] : [],
    })),
  );
}

/**
 * The catalogue numbers for a page of releases, in one query rather than one
 * per row.
 *
 * Grouped for the same reason `getLabelReleases` groups: a release can list one
 * label several times, once per catalogue number variant, and min(position)
 * picks the first entry with SQLite taking the bare catno from the row it
 * matched. A release with no label carries no number and gets no cell.
 */
export function getCatnos(releaseIds: readonly number[]): Map<number, string> {
  const db = getDb();
  const out = new Map<number, string>();
  if (!db || releaseIds.length === 0) return out;

  const rows = db
    .prepare(
      `SELECT release_id, catno, min(position) AS pos FROM release_labels
        WHERE release_id IN (${releaseIds.map(() => "?").join(",")})
        GROUP BY release_id`,
    )
    .all(...releaseIds) as { release_id: number; catno: string | null; pos: number }[];

  for (const row of rows) {
    if (row.catno) out.set(row.release_id, row.catno);
  }
  return out;
}
