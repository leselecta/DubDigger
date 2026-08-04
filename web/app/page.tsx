import { getCorpusStats, getDbPath } from "@/lib/db";

// The SQLite file is a static artifact regenerated out of band, so pages must
// read it at request time. Prerendering would bake one ingest in permanently.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const stats = getCorpusStats();

  return (
    <div className="max-w-2xl">
      <p className="text-ink-dim mb-4 text-sm">
        Type an artist. See who they worked with and what labels they released on.
        Then click any of those and keep digging.
      </p>

      {stats === null ? <NoDatabase /> : <CorpusSummary stats={stats} />}
    </div>
  );
}

/*
 * An empty result that looks like an answer is worse than an honest "no data".
 * That principle starts here: before any ingest has run, say so plainly rather
 * than rendering a search box that silently returns nothing.
 */
function NoDatabase() {
  return (
    <section className="border border-line bg-surface-raised px-4 py-3">
      <h2 className="text-sm font-semibold">No database yet</h2>
      <p className="text-ink-dim mt-2 text-sm">
        Nothing has been ingested. The app expects a precomputed SQLite file at:
      </p>
      <p className="text-ink-faint mt-2 font-mono text-xs break-all">{getDbPath()}</p>
      <p className="text-ink-dim mt-3 text-sm">
        Run the ingest steps in <span className="font-mono text-xs">ingest/</span>,
        then copy the result into <span className="font-mono text-xs">web/data/</span>.
      </p>
    </section>
  );
}

function CorpusSummary({ stats }: { stats: NonNullable<ReturnType<typeof getCorpusStats>> }) {
  const rows: [string, number][] = [
    ["Artists", stats.artists],
    ["Labels", stats.labels],
    ["Releases", stats.releases],
    ["Seed artists", stats.seedArtists],
    ["Seed labels", stats.seedLabels],
    ["Distinct role strings", stats.distinctRoles],
  ];

  return (
    <section>
      <h2 className="text-ink-faint mb-2 text-xs font-semibold tracking-wide uppercase">
        Corpus
      </h2>
      <dl className="border-line divide-line divide-y border-y">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between py-1 text-sm">
            <dt className="text-ink-dim">{label}</dt>
            <dd className="font-mono tabular-nums">{value.toLocaleString("en-GB")}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
