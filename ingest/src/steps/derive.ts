import type Database from "better-sqlite3";
import { derive as deriveDefaults, lineage, relevance } from "../config.ts";
import { startRun } from "../db/open.ts";

const { high, medium } = relevance;

/**
 * An artist's seed work as a share of everything they have ever appeared on.
 *
 * NULL when pass 1 never counted their total, which happens only with the seed
 * ratio switched off. Every comparison against NULL is itself NULL, so those
 * artists simply fall through to the rules that go on volume alone rather than
 * being graded against a denominator nobody measured.
 *
 * This is the GRADING share, and it reads pass 1's tally, which is the tally
 * every relevance dial was tuned against. It is not what a page displays.
 */
const share = "1.0 * s.seed_releases / nullif(s.total_releases, 0)";

/**
 * The seed figures a page displays, which are not the ones the grade came from.
 *
 * Two things are wrong with pass 1's tally for display purposes. It only exists
 * for artists who cleared the seed ratio, so King Tubby, on 15 seed releases and
 * dropped at 0.51% of a reissue-inflated catalogue, reported zero. And it counts
 * APPEARANCES, not releases: someone on the artist line who also engineered the
 * record counts twice, which is why pass 1 has Jeff Mills at 160 where the
 * corpus holds 116 distinct seed releases crediting him.
 *
 * So the displayed count is recomputed here, for everyone, in distinct releases.
 * It is a floor rather than a total, because a crowded release keeps its credits
 * but the dump holds seed releases pass 2 never wrote out; under-reporting is
 * the safe direction.
 *
 * The grade above is deliberately left on pass 1's numbers. Regrading on these
 * would move the dials under acts they were set by, and that is a decision to
 * take deliberately rather than as a side effect of fixing a display bug.
 */
const displayedShare =
  "1.0 * coalesce(sn.n, 0) / nullif(coalesce(s.total_releases, t.total), 0)";

/**
 * The measured grade, before any editorial rule runs.
 *
 * Written to two columns: scene_relevance keeps it, and relevance starts here
 * before the lineage floor lifts it. Splitting them is what lets a page say
 * "medium, but for lineage rather than for scene work".
 */
const grade = `CASE
             WHEN s.artist_id IS NULL OR s.seed_releases < 1 THEN 'none'
             WHEN s.seed_releases >= ${high.minSeedReleases}
              AND ${share} >= ${high.minSeedShare}                    THEN 'high'
             WHEN s.seed_releases >= ${medium.orSeedReleases}         THEN 'medium'
             WHEN s.seed_releases >= ${medium.minSeedReleases}
              AND ${share} >= ${medium.minSeedShare}                  THEN 'medium'
             ELSE 'low'
           END`;

/**
 * Builds the precomputed answers the web app reads.
 *
 * Everything here is ranked by frequency, never alphabetically. A collaborator
 * list sorted by shared releases puts the person who appears on nine records at
 * the top, where they belong; that ranking is the whole bet of the project, and
 * doing it at request time would put real work back on a server that is meant
 * to do nothing but SELECT.
 */

export interface DeriveOptions {
  maxPeoplePerRelease?: number;
  onStep?: (name: string) => void;
}

export interface DeriveStats {
  artistCollaborators: number;
  artistLabels: number;
  labelRoster: number;
  artistCoverage: number;
  /** Per tradition: how many carry the tag, and how many it lifted. */
  lineage: { name: string; tagged: number; lifted: number }[];
  /** Compilations too large to imply collaboration. Kept, but not paired. */
  releasesSkippedForPairs: number;
}

export async function runDerive(
  db: Database.Database,
  options: DeriveOptions = {},
): Promise<DeriveStats> {
  const maxPeople = options.maxPeoplePerRelease ?? deriveDefaults.maxPeoplePerRelease;
  const step = (name: string) => options.onStep?.(name);

  const run = startRun(db, "derive", null, { maxPeoplePerRelease: maxPeople });

  for (const table of ["artist_collaborators", "artist_labels", "label_roster", "artist_coverage"]) {
    db.exec(`DELETE FROM ${table}`);
  }

  // One row per person per release, whether they were on the artist line or in
  // the credits. Following the engineer is the point, so both count.
  //
  // Restricted to corpus artists. Someone pass 2 declined to admit still holds
  // their credit on a kept release, but they have no page, so ranking them as a
  // collaborator would produce rows the app can only drop on the floor.
  step("collecting people per release");
  db.exec(`
    DROP TABLE IF EXISTS temp.release_people;
    CREATE TEMP TABLE release_people AS
      SELECT release_id, artist_id, NULL AS role FROM release_artists
       WHERE artist_id IN (SELECT artist_id FROM corpus_artists)
      UNION ALL
      SELECT release_id, artist_id, role FROM release_credits
       WHERE artist_id IN (SELECT artist_id FROM corpus_artists);
    CREATE INDEX temp.idx_rp_release ON release_people (release_id);
    CREATE INDEX temp.idx_rp_artist  ON release_people (artist_id);
  `);

  step("finding releases too large to imply collaboration");
  db.exec(`
    DROP TABLE IF EXISTS temp.pairable;
    CREATE TEMP TABLE pairable AS
      SELECT release_id FROM (
        SELECT release_id, count(DISTINCT artist_id) AS people
        FROM release_people GROUP BY release_id
      ) WHERE people <= ${maxPeople};
    CREATE INDEX temp.idx_pairable ON pairable (release_id);
  `);

  const releasesSkippedForPairs =
    (db.prepare("SELECT count(*) FROM releases").pluck().get() as number) -
    (db.prepare("SELECT count(*) FROM pairable").pluck().get() as number);

  // Pair counts and pair roles are built as two set-based passes and joined,
  // never as a subquery per pair. Collecting roles inline runs its own join for
  // every pair produced, which across tens of millions of them never finishes.
  step("pairing people who appear together");
  db.exec(`
    DROP TABLE IF EXISTS temp.pair_counts;
    CREATE TEMP TABLE pair_counts AS
      SELECT a.artist_id AS aid, b.artist_id AS bid, count(DISTINCT a.release_id) AS n
        FROM release_people a
        JOIN pairable p      ON p.release_id = a.release_id
        JOIN release_people b ON b.release_id = a.release_id AND b.artist_id <> a.artist_id
       GROUP BY a.artist_id, b.artist_id;
  `);

  step("collecting the roles each collaborator held");
  db.exec(`
    DROP TABLE IF EXISTS temp.pair_roles;
    CREATE TEMP TABLE pair_roles AS
      SELECT aid, bid, group_concat(role, char(10)) AS roles FROM (
        SELECT DISTINCT a.artist_id AS aid, b.artist_id AS bid, b.role AS role
          FROM release_people a
          JOIN pairable p       ON p.release_id = a.release_id
          JOIN release_people b ON b.release_id = a.release_id AND b.artist_id <> a.artist_id
         WHERE b.role IS NOT NULL
         ORDER BY b.role
      ) GROUP BY aid, bid;
    CREATE INDEX temp.idx_pair_roles ON pair_roles (aid, bid);
  `);

  step("ranking collaborators");
  db.exec(`
    INSERT INTO artist_collaborators (artist_id, collaborator_id, shared_releases, roles)
    SELECT c.aid, c.bid, c.n, r.roles
      FROM pair_counts c
      LEFT JOIN pair_roles r ON r.aid = c.aid AND r.bid = c.bid;
  `);

  step("ranking labels per artist");
  db.exec(`
    INSERT INTO artist_labels (artist_id, label_id, release_count, first_year, last_year)
    SELECT p.artist_id,
           l.label_id,
           count(DISTINCT p.release_id),
           min(r.year),
           max(r.year)
      FROM release_people p
      JOIN release_labels l ON l.release_id = p.release_id
      JOIN releases r       ON r.id = p.release_id
     GROUP BY p.artist_id, l.label_id;
  `);

  step("building label rosters");
  db.exec(`
    INSERT INTO label_roster (label_id, artist_id, release_count, first_year, last_year)
    SELECT label_id, artist_id, release_count, first_year, last_year FROM artist_labels;
  `);

  // Coverage last, since it counts what the tables above produced. Built as
  // grouped passes for the same reason as the pairs: a subquery per artist,
  // times a million artists, is not a query anyone finishes waiting for.
  step("recording coverage");
  db.exec(`
    DROP TABLE IF EXISTS temp.credited;
    CREATE TEMP TABLE credited AS
      SELECT DISTINCT release_id FROM release_credits;
    CREATE INDEX temp.idx_credited ON credited (release_id);

    DROP TABLE IF EXISTS temp.cov;
    CREATE TEMP TABLE cov AS
      SELECT p.artist_id,
             count(DISTINCT p.release_id) AS release_count,
             count(DISTINCT CASE WHEN cr.release_id IS NOT NULL THEN p.release_id END)
               AS credited_releases,
             min(r.year) AS first_year,
             max(r.year) AS last_year
        FROM release_people p
        JOIN releases r      ON r.id = p.release_id
        LEFT JOIN credited cr ON cr.release_id = p.release_id
       GROUP BY p.artist_id;
    CREATE INDEX temp.idx_cov ON cov (artist_id);

    DROP TABLE IF EXISTS temp.collab_n;
    CREATE TEMP TABLE collab_n AS
      SELECT artist_id, count(*) AS n FROM artist_collaborators GROUP BY artist_id;
    CREATE INDEX temp.idx_collab_n ON collab_n (artist_id);

    DROP TABLE IF EXISTS temp.label_n;
    CREATE TEMP TABLE label_n AS
      SELECT artist_id, count(*) AS n FROM artist_labels GROUP BY artist_id;
    CREATE INDEX temp.idx_label_n ON label_n (artist_id);

    DROP TABLE IF EXISTS temp.seed_n;
    CREATE TEMP TABLE seed_n AS
      SELECT p.artist_id, count(DISTINCT p.release_id) AS n
        FROM release_people p
        JOIN releases r ON r.id = p.release_id AND r.is_seed = 1
       GROUP BY p.artist_id;
    CREATE INDEX temp.idx_seed_n ON seed_n (artist_id);

    DROP TABLE IF EXISTS temp.lineage_tag;
    CREATE TEMP TABLE lineage_tag (artist_id INTEGER PRIMARY KEY, name TEXT NOT NULL);
  `);

  // One INSERT per tradition, in precedence order, OR IGNORE so the first match
  // keeps the artist. Styles before labels: a Jamaican player who also cut for
  // Metroplex reads "roots dub", which is the truer of the two.
  step("tagging traditions");
  for (const t of lineage.byStyle) {
    db.exec(`
      INSERT OR IGNORE INTO lineage_tag (artist_id, name)
      SELECT p.artist_id, '${t.name}'
        FROM release_people p
        JOIN cov v ON v.artist_id = p.artist_id
       WHERE p.release_id IN (
               SELECT s.release_id FROM release_styles s
                WHERE s.style = '${t.style}'
                  ${
                    t.genre
                      ? `AND EXISTS (SELECT 1 FROM release_genres g
                                      WHERE g.release_id = s.release_id AND g.genre = '${t.genre}')`
                      : ""
                  }
             )
       GROUP BY p.artist_id
      HAVING count(DISTINCT p.release_id) >= ${t.minReleases}
         AND 1.0 * count(DISTINCT p.release_id) / v.release_count >= ${t.minShare};
    `);
  }

  for (const t of lineage.byLabel) {
    db.exec(`
      INSERT OR IGNORE INTO lineage_tag (artist_id, name)
      SELECT p.artist_id, '${t.name}'
        FROM release_people p
        JOIN cov v ON v.artist_id = p.artist_id
       WHERE p.release_id IN (
               SELECT rl.release_id FROM release_labels rl
                WHERE rl.label_id IN (${t.labels.join(", ")})
             )
       GROUP BY p.artist_id
      HAVING count(DISTINCT p.release_id) >= ${t.minReleases}
         AND 1.0 * count(DISTINCT p.release_id) / v.release_count >= ${t.minShare};
    `);
  }

  step("recording relevance");
  db.exec(`
    INSERT INTO artist_coverage
      (artist_id, release_count, credited_releases, collaborator_count, label_count,
       first_year, last_year, seed_releases, seed_share, scene_relevance, relevance, lineage)
    SELECT c.artist_id,
           coalesce(v.release_count, 0),
           coalesce(v.credited_releases, 0),
           coalesce(k.n, 0),
           coalesce(l.n, 0),
           v.first_year,
           v.last_year,
           coalesce(sn.n, 0),
           ${displayedShare},
           ${grade},
           ${grade},
           g.name
      FROM corpus_artists c
      LEFT JOIN cov                v ON v.artist_id = c.artist_id
      LEFT JOIN collab_n           k ON k.artist_id = c.artist_id
      LEFT JOIN label_n            l ON l.artist_id = c.artist_id
      LEFT JOIN seed_n            sn ON sn.artist_id = c.artist_id
      LEFT JOIN lineage_tag        g ON g.artist_id = c.artist_id
      LEFT JOIN seed_artists       s ON s.artist_id = c.artist_id
      LEFT JOIN seed_artist_totals t ON t.artist_id = c.artist_id;
  `);

  // The merge. scene_relevance keeps the measurement; relevance is what the
  // interface shows, and a tradition raises it to its own floor and no further.
  // Most traditions floor at medium; acid jazz and DNB at low, because that
  // inheritance is at one remove.
  step("applying the lineage floor");
  for (const t of [...lineage.byStyle, ...lineage.byLabel]) {
    const below = lineage.liftsFrom[t.floor];
    if (!below) throw new Error(`Tradition "${t.name}" has no rule for floor "${t.floor}"`);

    db.prepare(
      `UPDATE artist_coverage
          SET relevance = ?
        WHERE lineage = ?
          AND relevance IN (${below.map(() => "?").join(", ")})`,
    ).run(t.floor, t.name, ...below);
  }

  db.exec(`DROP TABLE IF EXISTS temp.release_people;
            DROP TABLE IF EXISTS temp.pairable;
            DROP TABLE IF EXISTS temp.pair_counts;
            DROP TABLE IF EXISTS temp.pair_roles;
            DROP TABLE IF EXISTS temp.credited;
            DROP TABLE IF EXISTS temp.cov;
            DROP TABLE IF EXISTS temp.collab_n;
            DROP TABLE IF EXISTS temp.label_n;
            DROP TABLE IF EXISTS temp.seed_n;
            DROP TABLE IF EXISTS temp.lineage_tag;`);

  const count = (table: string): number =>
    db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;

  // Tagged and lifted are the steering numbers for the lineage dials: how many
  // the tradition describes, and how many it is the only thing speaking for.
  const perTradition = db
    .prepare(
      `SELECT lineage AS name,
              count(*) AS tagged,
              sum(relevance <> scene_relevance) AS lifted
         FROM artist_coverage
        WHERE lineage IS NOT NULL
        GROUP BY lineage
        ORDER BY tagged DESC`,
    )
    .all() as DeriveStats["lineage"];

  const stats: DeriveStats = {
    artistCollaborators: count("artist_collaborators"),
    artistLabels: count("artist_labels"),
    labelRoster: count("label_roster"),
    artistCoverage: count("artist_coverage"),
    lineage: perTradition,
    releasesSkippedForPairs,
  };

  run.finish(stats);
  return stats;
}
