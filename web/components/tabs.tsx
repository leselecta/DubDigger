import Link from "next/link";

export interface Tab {
  key: string;
  label: string;
  count: number;
}

/**
 * The list switcher on the artist and label pages.
 *
 * Links carrying a search param rather than client state, for three reasons
 * that all point the same way: the lists stay server rendered so a 556 row
 * roster is never serialised into the page as JSON, every tab is a real URL
 * that can be linked and gone back to, and it works before any JavaScript
 * arrives. Next.js navigates these client side, so it still feels like a tab.
 */
export function Tabs({
  tabs,
  active,
  basePath,
}: {
  tabs: Tab[];
  active: string;
  basePath: string;
}) {
  // The hairline sits on the wrapper rather than on the scrolling row, so the
  // active tab's heavier underline lands on top of it instead of being clipped
  // away by the scroll container.
  return (
    <div className="border-hairline mb-2 border-b">
      <nav className="flex gap-6 overflow-x-auto sm:gap-[34px]">
        {tabs.map((tab) => {
          const isActive = tab.key === active;
          return (
            <Link
              key={tab.key}
              href={tab.key === tabs[0]!.key ? basePath : `${basePath}?tab=${tab.key}`}
              scroll={false}
              aria-current={isActive ? "page" : undefined}
              className={`shrink-0 pb-4 font-mono text-[0.8125rem] tracking-[0.14em] whitespace-nowrap uppercase ${
                isActive ? "text-ink-strong border-b-[1.5px] border-white" : "text-[#7c7c7c]"
              }`}
            >
              {tab.label}{" "}
              <span className={isActive ? "text-ink-faint" : "text-[#5a5a5a]"}>
                {tab.count.toLocaleString("en-GB")}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Ghost button that reveals the next page of a list, again via the URL. */
export function LoadMore({ href, remaining }: { href: string; remaining: number }) {
  return (
    <Link
      href={href}
      scroll={false}
      className="border-edge-strong hover:bg-ink hover:text-bg mt-10 inline-block border px-8 py-[15px] font-mono text-xs tracking-[0.2em] uppercase transition-colors"
    >
      Load more
      <span className="text-ink-faint ml-3">{remaining.toLocaleString("en-GB")}</span>
    </Link>
  );
}
