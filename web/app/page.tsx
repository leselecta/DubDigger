import Link from "next/link";
import { getCorpusStats, getDbPath } from "@/lib/db";
import { search } from "@/lib/queries";

// The SQLite file is a static artifact regenerated out of band, so pages must
// read it at request time. Prerendering would bake one ingest in permanently.
export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const stats = getCorpusStats();
  const hits = q ? search(q) : [];

  return (
    <div className="max-w-2xl">
      <p className="text-ink-dim mb-3 text-sm">
        Type an artist. See who they worked with and what labels they released on.
        Then click any of those and keep digging.
      </p>

      {stats === null ? (
        <NoDatabase />
      ) : (
        <>
          <form action="/" className="mb-4 flex gap-1">
            <input
              type="search"
              name="q"
              defaultValue={q ?? ""}
              placeholder="Basic Channel, Chain Reaction, Vainqueur…"
              autoFocus
              className="border-line bg-surface-raised min-w-0 flex-1 border px-2 py-1 text-sm"
            />
            <button type="submit" className="border-line border px-3 py-1 text-sm">
              Search
            </button>
          </form>

          {q ? <Results query={q} hits={hits} /> : <CorpusSummary stats={stats} />}
        </>
      )}
    </div>
  );
}

function Results({ query, hits }: { query: string; hits: ReturnType<typeof search> }) {
  if (hits.length === 0) {
    return (
      <p className="text-ink-faint border-line border-y py-2 text-sm">
        Nothing found for “{query}”. This corpus is a slice centred on dub techno,
        not all of Discogs, so plenty of real artists are legitimately absent.
      </p>
    );
  }

  return (
    <ul className="divide-line border-line divide-y border-y">
      {hits.map((hit) => (
        <li key={`${hit.kind}-${hit.id}`} className="flex gap-2 py-1 text-sm">
          <span className="text-ink-faint w-8 shrink-0 text-right tabular-nums">
            {hit.releaseCount}
          </span>
          <Link href={`/${hit.kind}/${hit.id}`} className="min-w-0 flex-1 truncate">
            {hit.name}
          </Link>
          <span className="text-ink-faint shrink-0 text-xs">{hit.kind}</span>
        </li>
      ))}
    </ul>
  );
}

/*
 * An empty result that looks like an answer is worse than an honest "no data".
 * That principle starts here: before any ingest has run, say so plainly rather
 * than rendering a search box that silently returns nothing.
 */
function NoDatabase() {
  return (
    <section className="border-line bg-surface-raised border px-4 py-3">
      <h2 className="text-sm font-semibold">No database yet</h2>
      <p className="text-ink-dim mt-2 text-sm">
        Nothing has been ingested. The app expects a precomputed SQLite file at:
      </p>
      <p className="text-ink-faint mt-2 font-mono text-xs break-all">{getDbPath()}</p>
      <p className="text-ink-dim mt-3 text-sm">
        Run the ingest steps in <span className="font-mono text-xs">ingest/</span>, then
        copy the result into <span className="font-mono text-xs">web/data/</span>.
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
      <h2 className="text-ink-faint mb-1 text-xs font-semibold tracking-wide uppercase">
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
