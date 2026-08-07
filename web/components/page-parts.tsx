import Link from "next/link";

/**
 * The pieces the artist and label pages share. Both are the same page with
 * different nouns, so the layout lives here once.
 */

/** A `[label | value]` row in the identity block, separated by hairlines. */
export function FieldRow({
  label,
  children,
  accent = false,
}: {
  label: string;
  children: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <div className="border-hairline grid grid-cols-[7rem_1fr] gap-x-6 border-t py-2 font-mono text-[0.8125rem] sm:grid-cols-[180px_1fr]">
      <dt className="text-ink-faint tracking-[0.12em] uppercase">{label}</dt>
      <dd className={accent ? "text-accent" : "text-[#e6e6e6]"}>{children}</dd>
    </div>
  );
}

/** A full-width band with a mono section label down the left. */
export function LabelledBand({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-hairline grid gap-6 border-t py-14 md:grid-cols-[180px_1fr]">
      <h2 className="mono-label">{label}</h2>
      <div>{children}</div>
    </div>
  );
}

/**
 * The list row used by collaborators, labels, releases and rosters: a count on
 * the left, the name and its detail on the right.
 *
 * Frequency is the signal in this project, so the count is what the eye lands
 * on first going down the column.
 */
export function CreditRow({
  count,
  href,
  name,
  detail,
  external = false,
  trailing,
}: {
  count: React.ReactNode;
  href: string;
  name: string;
  detail?: string | null;
  external?: boolean;
  trailing?: React.ReactNode;
}) {
  const nameEl = external ? (
    <a
      href={href}
      rel="noreferrer"
      className="text-row font-bold tracking-[-0.01em]"
      style={{ borderBottom: "1px solid rgb(255 255 255 / 0.25)" }}
    >
      {name}
    </a>
  ) : (
    <Link
      href={href}
      className="text-row font-bold tracking-[-0.01em]"
      style={{ borderBottom: "1px solid rgb(255 255 255 / 0.25)" }}
    >
      {name}
    </Link>
  );

  return (
    <li className="border-hairline-soft grid grid-cols-[3.25rem_1fr] items-baseline gap-x-[22px] border-b py-[18px]">
      <span className="text-ink-faint font-mono text-[0.8125rem] font-medium tabular-nums">
        {count}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          {nameEl}
          {trailing}
        </div>
        {detail && (
          <p className="text-ink-dim mt-2 max-w-[920px] font-mono text-xs leading-[1.65]">
            {detail}
          </p>
        )}
      </div>
    </li>
  );
}

/** Bordered mono chip, used for the groups an artist belongs to. */
export function Chip({
  href,
  name,
  count,
}: {
  href: string;
  name: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className="hover:border-accent hover:text-accent inline-flex items-baseline gap-2 border border-[rgb(255_255_255_/_0.18)] px-[14px] py-2 font-mono text-[0.8125rem] text-[#e6e6e6] transition-colors"
    >
      {name}
      {count !== undefined && count > 0 && <span className="text-ink-faint">{count}</span>}
    </Link>
  );
}

/**
 * An empty result that looks like an answer is worse than an honest "no data
 * here", so absence gets the same weight on the page as a list would.
 */
export function Absence({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-hairline-soft text-ink-muted max-w-[720px] border-b py-[18px] font-mono text-[0.8125rem] leading-relaxed">
      {children}
    </p>
  );
}
