import { useEffect, useLayoutEffect, useState } from "react";

const DURATION_MS = 900;
const STORAGE_KEY = "dubdigger:stats-counted";

/**
 * The count has to start before the first paint, or the final figure shows for
 * a frame and then snaps back to zero. useLayoutEffect does that but is a no-op
 * on the server, so pick the one that fits where this is running.
 */
const useBeforePaint = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Decided once, before any figure mounts, so all three agree and the second one
 * does not read a flag the first one just wrote.
 *
 * Two layers, because there are two ways back to this page. The module variable
 * covers a client side navigation, where the island remounts but the JavaScript
 * context survives. sessionStorage covers a real reload, which resets the
 * module. Without both, searching would roll the corpus up again on every
 * query.
 */
let shouldPlay: boolean | null = null;

function claimAnimation(): boolean {
  if (shouldPlay !== null) return shouldPlay;

  try {
    shouldPlay =
      sessionStorage.getItem(STORAGE_KEY) === null &&
      !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (shouldPlay) sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    shouldPlay = false;
  }

  return shouldPlay;
}

/**
 * A corpus figure, rolling up from zero the first time the home page is opened.
 *
 * The server renders the real number, so it is correct with no JavaScript and
 * correct on every later visit; the roll is something the client adds on top.
 */
export function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);

  useBeforePaint(() => {
    if (!claimAnimation()) return;

    setShown(0);

    let frame = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const t = Math.min((now - start) / DURATION_MS, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(value * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value]);

  return <>{shown.toLocaleString("en-GB")}</>;
}
