"use client";

import { useEffect, useRef, useState } from "react";

const CLAMP_PX = 84;

/**
 * Bio and label info, clamped with a fade until asked to open.
 *
 * The control only appears when the text actually overflows the clamp, which
 * cannot be known from the server: it depends on the rendered line count at
 * this viewport. So the height is measured after paint, and a short bio simply
 * renders as a paragraph with nothing to click.
 */
export function CollapsibleText({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const inner = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = inner.current;
    if (!el) return;

    const measure = () => setOverflows(el.scrollHeight > CLAMP_PX + 1);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);

  const clamped = overflows && !open;

  return (
    <div className="max-w-[720px]">
      <div
        className="relative overflow-hidden"
        style={{ maxHeight: clamped ? CLAMP_PX : undefined }}
      >
        <div ref={inner}>{children}</div>
        {clamped && (
          <div
            className="pointer-events-none absolute right-0 bottom-0 left-0 h-12"
            style={{ background: "linear-gradient(rgb(6 6 6 / 0), rgb(6 6 6))" }}
          />
        )}
      </div>

      {overflows && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-ink-muted hover:text-ink mt-[18px] inline-flex cursor-pointer items-center gap-[9px] font-mono text-xs tracking-[0.16em] uppercase"
        >
          <span>{open ? "Collapse" : "Read more"}</span>
          <span
            className="inline-flex transition-transform duration-200"
            style={{ transform: open ? "rotate(180deg)" : undefined }}
          >
            <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path
                d="M2 4l4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>
      )}
    </div>
  );
}
