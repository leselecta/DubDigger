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
  step("collecting people per release");
  db.exec(`
    DROP TABLE IF EXISTS temp.release_people;
    CREATE TEMP TABLE release_people AS
      SELECT release_id, artist_id, NULL AS role FROM release_artists
      UNION ALL
      SELECT release_id, artist_id, role FROM release_credits;
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

  step("ranking collaborators");
  db.exec(`
    INSERT INTO artist_collaborators (artist_id, collaborator_id, shared_releases, roles)
    SELECT a.artist_id,
           b.artist_id,
           count(DISTINCT a.release_id),
           (SELECT group_concat(role, char(10)) FROM (
              SELECT DISTINCT c.role
              FROM release_people c
              JOIN release_people d ON d.release_id = c.release_id
              WHERE c.artist_id = b.artist_id
                AND d.artist_id = a.artist_id
                AND c.role IS NOT NULL
              ORDER BY c.role
            ))
      FROM release_people a
      JOIN release_people b ON b.release_id = a.release_id AND b.artist_id <> a.artist_id
      JOIN pairable p ON p.release_id = a.release_id
     GROUP BY a.artist_id, b.artist_id;
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

  // Coverage last, since it counts what the tables above produced.
  step("recording coverage");
  db.exec(`
    INSERT INTO artist_coverage
      (artist_id, release_count, credited_releases, collaborator_count, label_count, first_year, last_year)
    SELECT c.artist_id,
           (SELECT count(DISTINCT release_id) FROM release_people p WHERE p.artist_id = c.artist_id),
           (SELECT count(DISTINCT p.release_id) FROM release_people p
              WHERE p.artist_id = c.artist_id
                AND EXISTS (SELECT 1 FROM release_credits rc WHERE rc.release_id = p.release_id)),
           (SELECT count(*) FROM artist_collaborators ac WHERE ac.artist_id = c.artist_id),
           (SELECT count(*) FROM artist_labels al WHERE al.artist_id = c.artist_id),
           (SELECT min(r.year) FROM release_people p JOIN releases r ON r.id = p.release_id
              WHERE p.artist_id = c.artist_id),
           (SELECT max(r.year) FROM release_people p JOIN releases r ON r.id = p.release_id
              WHERE p.artist_id = c.artist_id)
      FROM corpus_artists c;
  `);

  db.exec("DROP TABLE IF EXISTS temp.release_people; DROP TABLE IF EXISTS temp.pairable;");

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
