import type Database from "better-sqlite3";
import { derive as deriveDefaults } from "../config.ts";
import { startRun } from "../db/open.ts";

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

    INSERT INTO artist_coverage
      (artist_id, release_count, credited_releases, collaborator_count, label_count,
       first_year, last_year)
    SELECT c.artist_id,
           coalesce(v.release_count, 0),
           coalesce(v.credited_releases, 0),
           coalesce(k.n, 0),
           coalesce(l.n, 0),
           v.first_year,
           v.last_year
      FROM corpus_artists c
      LEFT JOIN cov      v ON v.artist_id = c.artist_id
      LEFT JOIN collab_n k ON k.artist_id = c.artist_id
      LEFT JOIN label_n  l ON l.artist_id = c.artist_id;
  `);

  db.exec(`DROP TABLE IF EXISTS temp.release_people;
            DROP TABLE IF EXISTS temp.pairable;
            DROP TABLE IF EXISTS temp.pair_counts;
            DROP TABLE IF EXISTS temp.pair_roles;
            DROP TABLE IF EXISTS temp.credited;
            DROP TABLE IF EXISTS temp.cov;
            DROP TABLE IF EXISTS temp.collab_n;
            DROP TABLE IF EXISTS temp.label_n;`);

  const count = (table: string): number =>
    db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number;

  const stats: DeriveStats = {
    artistCollaborators: count("artist_collaborators"),
    artistLabels: count("artist_labels"),
    labelRoster: count("label_roster"),
    artistCoverage: count("artist_coverage"),
    releasesSkippedForPairs,
  };

  run.finish(stats);
  return stats;
}
