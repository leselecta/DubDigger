import Link from "next/link";
import { notFound } from "next/navigation";
import { getLabel, getRoster } from "@/lib/queries";

export const dynamic = "force-dynamic";

function years(from: number | null, to: number | null): string {
  if (!from && !to) return "";
  if (from === to) return String(from);
  return `${from ?? "?"}–${to ?? "?"}`;
}

export default async function LabelPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const label = getLabel(Number(id));
  if (!label) notFound();

  const roster = getRoster(label.id);

  return (
    <div className="max-w-3xl">
      <header className="border-line mb-3 border-b pb-2">
        <h1 className="text-base font-semibold tracking-tight">{label.name}</h1>
        <p className="text-ink-dim mt-1 flex flex-wrap gap-x-3 text-xs tabular-nums">
          <span>{label.releaseCount} releases</span>
          <span>{label.artistCount} artists</span>
          {label.isSeed && label.seedRatio !== null && (
            <span className="text-accent">
              core label · {(label.seedRatio * 100).toFixed(0)}% of roster in the scene
            </span>
          )}
        </p>
      </header>

      {!label.isSeed && (
        // The corpus only follows non-seed labels as far as the artists who
        // reached it by another route, so this roster is a slice, not the whole
        // thing. Saying so beats showing 24 of 500 as if it were the answer.
        <p className="border-line text-ink-dim mb-3 border px-2 py-1 text-xs">
          Partial roster. This label sits outside the core corpus, so only artists who
          arrived through a collaboration are listed here.
        </p>
      )}

      <h2 className="text-ink-faint mb-1 text-xs font-semibold tracking-wide uppercase">
        Roster
      </h2>
      {roster.length > 0 ? (
        <ul className="divide-line border-line divide-y border-y">
          {roster.map((a) => (
            <li key={a.id} className="flex gap-2 py-1 text-sm">
              <span className="text-ink-faint w-6 shrink-0 text-right tabular-nums">
                {a.releaseCount}
              </span>
              <span className="min-w-0 flex-1 truncate">
                <Link href={`/artist/${a.id}`}>{a.name}</Link>
              </span>
              <span className="text-ink-faint shrink-0 text-xs tabular-nums">
                {years(a.firstYear, a.lastYear)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-ink-faint border-line border-y py-2 text-sm">
          No roster recorded for this label.
        </p>
      )}
    </div>
  );
}
