import Link from "next/link";
import { getCorpusStats } from "@/lib/db";
import { AboutMenu } from "./about-menu";
import { SearchField } from "./search-field";

/**
 * Wordmark, search, and the About control.
 *
 * The home page carries its search in the hero, so the header one is suppressed
 * there rather than asking twice for the same thing.
 */
export function SiteHeader({ search = true }: { search?: boolean }) {
  const stats = getCorpusStats();

  return (
    <header className="border-hairline border-b">
      <div className="column flex h-[76px] items-center justify-between gap-8">
        <Link
          href="/"
          className="shrink-0 text-xl font-semibold tracking-tight"
          style={{ letterSpacing: "-0.02em" }}
        >
          dub<span className="text-accent">.</span>digger
        </Link>

        {search ? (
          <div className="hidden max-w-[420px] flex-1 sm:block">
            <SearchField size="header" />
          </div>
        ) : (
          <span className="flex-1" />
        )}

        <AboutMenu
          artists={stats?.artists ?? 0}
          labels={stats?.labels ?? 0}
          releases={stats?.releases ?? 0}
        />
      </div>
    </header>
  );
}
