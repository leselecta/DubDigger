import { useEffect, useState } from "react";

/**
 * The hamburger, and the panel behind it.
 *
 * The design shows the control on every page without saying what it opens.
 * There is nowhere to navigate to in v1, so it holds the thing a sceptic
 * actually needs: what this corpus is, and what it is not. Someone typing a
 * name that is not here deserves to know the boundary was drawn deliberately.
 */
export function AboutMenu({
  artists,
  labels,
  releases,
}: {
  artists: number;
  labels: number;
  releases: number;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const n = (v: number) => v.toLocaleString("en-GB");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="About this index"
        aria-expanded={open}
        className="flex shrink-0 cursor-pointer flex-col gap-[6px] py-2"
      >
        <span className="bg-ink block h-[1.5px] w-[26px]" />
        <span className="bg-ink block h-[1.5px] w-[26px]" />
        <span className="bg-ink block h-[1.5px] w-[26px]" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/70"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <aside className="bg-bg border-hairline relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l px-8 py-8">
            <div className="mb-10 flex items-start justify-between">
              <h2 className="mono-label">About</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-ink-muted hover:text-ink cursor-pointer font-mono text-lg leading-none"
              >
                ×
              </button>
            </div>

            <div className="text-body text-ink space-y-5 leading-relaxed">
              <p>
                A crate digging index built on Discogs credit data. Type an artist, see who they
                worked with and what labels they released on, then follow any of those and keep
                going.
              </p>
              <p className="text-ink-muted">
                This is not all of Discogs. It is a slice centred on dub techno, widened by one hop
                to the people who worked with the scene and the people who share its labels. That
                is why {n(artists)} artists are here and a great many real ones are not.
              </p>
              <p className="text-ink-muted">
                Every artist carries how close to the scene they sit, so a distant name looks
                distant instead of being quietly hidden.
              </p>
            </div>

            <dl className="border-hairline mt-10 grid grid-cols-3 border-t pt-6 font-mono text-xs">
              {[
                ["Artists", artists],
                ["Labels", labels],
                ["Releases", releases],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-ink-faint tracking-widest uppercase">{label}</dt>
                  <dd className="text-ink-strong mt-2 text-sm tabular-nums">{n(value as number)}</dd>
                </div>
              ))}
            </dl>

            <p className="text-ink-faint mt-10 font-mono text-xs leading-relaxed">
              Built from the Discogs monthly data dumps, which are CC0. No images and no API calls:
              Discogs images are restricted data and are deliberately out of scope.
            </p>
          </aside>
        </div>
      )}
    </>
  );
}
