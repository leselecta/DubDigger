import Link from "next/link";
import { connection } from "next/server";
import { getCorpusStats, getDbPath } from "@/lib/db";
import { search, type SearchHit } from "@/lib/queries";
import { SiteHeader } from "@/components/site-header";
import { SearchField } from "@/components/search-field";
import { Eyebrow } from "@/components/page-parts";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  // The SQLite file is a static artifact regenerated out of band, so every page
  // must read it per request. connection() is the current way to say that: it
  // ties dynamic rendering to the incoming request, and supersedes the
  // deprecated `export const dynamic = "force-dynamic"`.
  await connection();

  const { q } = await searchParams;
  const stats = getCorpusStats();
  const searching = Boolean(q);
  const results = q ? search(q) : null;

  return (
    <>
      <SiteHeader search={false} />

      {/*
       * Searching drops the tagline and keeps everything else. A headline
       * announcing what the site is has done its job by the time someone has
       * typed into it, and the results are what they came back for.
       */}
      <div
        className={`column text-center ${
          searching ? "pt-14 pb-12" : "pt-24 pb-16 md:pt-[130px] md:pb-24"
        }`}
      >
        <Eyebrow>The Dub Techno Index</Eyebrow>

        {!searching && (
          <h1 className="text-hero text-ink-strong mt-9 leading-[0.98] font-bold tracking-[-0.035em]">
            Dig the Extended Scene.
            <br />
            Dub Techno First
          </h1>
        )}

        <div className={`mx-auto max-w-[640px] ${searching ? "mt-8" : "mt-16"}`}>
          <SearchField size="hero" defaultValue={q} />
        </div>
        <p className="mt-[18px] font-mono text-xs tracking-[0.14em] text-[#5f5f5f] uppercase">
          Search artists · labels · releases
        </p>
      </div>

      {stats === null ? (
        <NoDatabase />
      ) : (
        <>
          {searching && results && (
            <Results query={q!} hits={results.hits} truncated={results.truncated} />
          )}
          <CorpusStats stats={stats} />
        </>
      )}
    </>
  );
}

function CorpusStats({ stats }: { stats: NonNullable<ReturnType<typeof getCorpusStats>> }) {
  const columns: [string, number][] = [
    ["Artists", stats.artists],
    ["Labels", stats.labels],
    ["Releases", stats.releases],
  ];

  return (
    <div className="column pt-6 pb-32">
      <dl className="border-hairline grid border-t sm:grid-cols-3">
        {columns.map(([label, value], i) => (
          <div
            key={label}
            className={`px-0 py-10 sm:px-10 sm:py-14 ${
              i < columns.length - 1 ? "border-hairline border-b sm:border-r sm:border-b-0" : ""
            }`}
          >
            <dt className="mono-label">{label}</dt>
            <dd className="text-stat text-ink-strong mt-3 font-bold tracking-[-0.03em] tabular-nums">
              {value.toLocaleString("en-GB")}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Results({
  query,
  hits,
  truncated,
}: {
  query: string;
  hits: SearchHit[];
  truncated: boolean;
}) {
  return (
    <div className="column pb-24">
      <p className="mono-label mb-6">
        {hits.length === 0
          ? `Nothing found for “${query}”`
          : truncated
            ? `Closest ${hits.length} for “${query}”`
            : `${hits.length} found for “${query}”`}
      </p>

      {hits.length === 0 ? (
        <p className="text-body text-ink-muted max-w-[720px] py-10 leading-relaxed">
          This corpus is a slice centred on dub techno, not all of Discogs, so plenty of real
          artists are legitimately absent. That is the boundary working, not a gap.
        </p>
      ) : (
        <>
          <ResultHeader />
          <ul>
            {hits.map((hit) => (
              <ResultRow key={`${hit.kind}-${hit.id}`} hit={hit} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/** The column widths, shared by the header row and every result, so they line up. */
const RESULT_GRID = "grid-cols-[4.5rem_1fr] md:grid-cols-[5.5rem_1fr_11rem_5rem]";

function ResultHeader() {
  return (
    <div
      className={`border-hairline text-ink-faint grid ${RESULT_GRID} gap-x-[22px] border-b pb-3 font-mono text-[0.6875rem] tracking-[0.2em] uppercase`}
    >
      <span className="text-right">Releases</span>
      <span>Name</span>
      <span className="hidden md:block">Dub relevance</span>
      <span className="hidden md:block">Type</span>
    </div>
  );
}

/**
 * One result, with relevance and type in their own columns.
 *
 * They were a single column and it conflated two different facts: searching
 * "Maurizio" returned the person and the imprint, one reading "high" and the
 * other "label", as though those were answers to the same question.
 */
function ResultRow({ hit }: { hit: SearchHit }) {
  return (
    <li
      className={`border-hairline-soft grid ${RESULT_GRID} items-baseline gap-x-[22px] border-b py-[18px]`}
    >
      <span className="text-ink-faint text-right font-mono text-[0.8125rem] font-medium tabular-nums">
        {hit.releaseCount.toLocaleString("en-GB")}
      </span>

      <Link
        href={`/${hit.kind}/${hit.id}`}
        className="text-row min-w-0 justify-self-start font-bold tracking-[-0.01em]"
        style={{ borderBottom: "1px solid rgb(255 255 255 / 0.25)" }}
      >
        {hit.name}
      </Link>

      <span className="col-start-2 font-mono text-xs tracking-[0.1em] uppercase md:col-start-3">
        <Relevance hit={hit} />
      </span>

      <span className="text-ink-faint col-start-2 font-mono text-xs tracking-[0.1em] uppercase md:col-start-4">
        {hit.kind}
      </span>
    </li>
  );
}

/**
 * How close to the scene a result sits, or how it got here if the answer is
 * "not at all".
 *
 * Shown because breadth is only an asset when a distant act looks distant.
 * Mozart is genuinely in this corpus, on 85 releases that really do credit
 * someone here, and saying so is honest where hiding him would not be.
 *
 * Labels are graded on the same words, from the measure they do have: a seed
 * label is a scene label by roster concentration. The underlying test is not
 * the artist one, but one column asking one question in one vocabulary beats
 * two scales sharing a heading.
 */
function Relevance({ hit }: { hit: SearchHit }) {
  if (hit.kind === "label") {
    return hit.coreLabel ? (
      <span className="text-accent">High</span>
    ) : (
      <span className="text-ink-faint">Low</span>
    );
  }

  const graded = hit.relevance !== null && hit.relevance !== "none";
  return (
    <span className={graded ? "text-accent" : "text-ink-faint"}>
      {graded ? hit.relevance : (hit.connection ?? "artist")}
    </span>
  );
}

/*
 * An empty result that looks like an answer is worse than an honest "no data".
 * That principle starts here: before any ingest has run, say so plainly rather
 * than rendering a search box that silently returns nothing.
 */
function NoDatabase() {
  return (
    <div className="column pb-32">
      <div className="border-hairline max-w-[720px] border-t pt-10">
        <h2 className="mono-label">No database yet</h2>
        <p className="text-body text-ink-muted mt-4 leading-relaxed">
          Nothing has been ingested. The app expects a precomputed SQLite file at:
        </p>
        <p className="text-ink-faint mt-4 font-mono text-xs break-all">{getDbPath()}</p>
        <p className="text-body text-ink-muted mt-4 leading-relaxed">
          Run the ingest steps in <span className="font-mono text-sm">ingest/</span>, then publish
          the result into <span className="font-mono text-sm">web/data/</span>.
        </p>
      </div>
    </div>
  );
}
