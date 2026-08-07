/**
 * The search box, in the two sizes the design specifies: the 66px hero on the
 * home page and the 44px one that sits in the header everywhere else.
 *
 * A plain GET form, so search works with no JavaScript and every result page is
 * a real URL that can be linked or gone back to.
 */
export function SearchField({
  size,
  defaultValue,
}: {
  size: "hero" | "header";
  defaultValue?: string;
}) {
  const hero = size === "hero";

  return (
    <form action="/" className="relative w-full">
      <input
        type="search"
        name="q"
        defaultValue={defaultValue}
        autoFocus={hero}
        placeholder={
          hero ? "Basic Channel, Chain Reaction, Maurizio…" : "Basic Channel, Chain Reaction…"
        }
        aria-label="Search artists and labels"
        className={`border-edge text-ink placeholder:text-ink-faint w-full border bg-transparent font-mono outline-none ${
          hero ? "h-16 pr-14 pl-6 text-[0.9375rem]" : "h-11 pr-11 pl-4 text-[0.8125rem]"
        }`}
      />
      <span
        className="pointer-events-none absolute top-1/2 -translate-y-1/2"
        style={{ right: hero ? 24 : 16 }}
      >
        <MagnifierIcon size={hero ? 18 : 15} />
      </span>
    </form>
  );
}

function MagnifierIcon({ size }: { size: number }) {
  const r = size === 18 ? 6 : 5;
  const c = size === 18 ? 8 : 6.5;
  const from = c + r * 0.75;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden="true">
      <circle cx={c} cy={c} r={r} stroke="#8a8a8a" strokeWidth="1.4" />
      <line x1={from} y1={from} x2={size - 1} y2={size - 1} stroke="#8a8a8a" strokeWidth="1.4" />
    </svg>
  );
}
