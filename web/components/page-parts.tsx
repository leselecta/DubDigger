import Link from "next/link";

/**
 * The pieces the artist and label pages share. Both are the same page with
 * different nouns, so the layout lives here once.
 */

/**
 * The small accented line above a headline. On the home page it names the site,
 * on an entity page it names what you are looking at, which is the one thing
 * the big name itself cannot tell you: "Chain Reaction" is both a label and two
 * unrelated artists.
 */
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-accent font-mono text-xs tracking-[0.32em] uppercase">{children}</p>
  );
}

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
 * The tables inside the tabs, sharing one shape with the search results: the
 * name leads, then a count, then a piece of meta.
 *
 * One grid constant for the header and every row, so the columns line up down
 * the page. Anything long, roles in particular, wraps under the name in the
 * first column rather than being squeezed into one of the narrow ones: Juan
 * Atkins holds fourteen distinct role strings on Moritz von Oswald's records.
 */
const LIST_GRID = "grid-cols-[1fr_5rem] md:grid-cols-[1fr_6rem_10rem]";

export function ListHeader({
  name,
  count,
  meta,
}: {
  name: string;
  count: string;
  meta?: string;
}) {
  return (
    <div
      className={`border-hairline text-ink-faint grid ${LIST_GRID} gap-x-[22px] border-b pb-3 font-mono text-[0.6875rem] tracking-[0.2em] uppercase`}
    >
      <span>{name}</span>
      <span>{count}</span>
      <span className="hidden md:block">{meta ?? ""}</span>
    </div>
  );
}

export function CreditRow({
  count,
  href,
  name,
  detail,
  meta,
  external = false,
}: {
  count: React.ReactNode;
  href: string;
  name: string;
  /** Long text, wrapped under the name. Roles, mostly. */
  detail?: string | null;
  /** Short text for the third column. Years, a catalogue number. */
  meta?: React.ReactNode;
  external?: boolean;
}) {
  const nameProps = {
    className: "text-row justify-self-start font-bold tracking-[-0.01em]",
    style: { borderBottom: "1px solid rgb(255 255 255 / 0.25)" },
  };

  return (
    <li
      className={`border-hairline-soft grid ${LIST_GRID} items-baseline gap-x-[22px] border-b py-[18px]`}
    >
      <div className="min-w-0">
        {external ? (
          <a href={href} rel="noreferrer" {...nameProps}>
            {name}
          </a>
        ) : (
          <Link href={href} {...nameProps}>
            {name}
          </Link>
        )}
        {detail && (
          <p className="text-ink-dim mt-2 max-w-[920px] font-mono text-xs leading-[1.65]">
            {detail}
          </p>
        )}
      </div>

      <span className="text-ink-faint font-mono text-[0.8125rem] font-medium tabular-nums">
        {count}
      </span>

      <span className="text-ink-faint col-start-1 font-mono text-[0.8125rem] tabular-nums md:col-start-3">
        {meta}
      </span>
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
