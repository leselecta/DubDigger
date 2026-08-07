import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  getArtist,
  getCollaborators,
  getArtistLabels,
  getProfileNames,
  getRelations,
  getArtistReleases,
  type Artist,
  type Relation,
} from "@/lib/queries";
import { ProfileText } from "@/components/profile-text";
import { OutboundLinks } from "@/components/outbound-links";

function years(from: number | null, to: number | null): string {
  if (!from && !to) return "";
  if (from === to) return String(from);
  return `${from ?? "?"}–${to ?? "?"}`;
}

export default async function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  // The SQLite file is a static artifact regenerated out of band, so every page
  // must read it per request. connection() is the current way to say that: it
  // ties dynamic rendering to the incoming request, and supersedes the
  // deprecated `export const dynamic = "force-dynamic"`.
  await connection();

  const { id } = await params;
  const artist = getArtist(Number(id));
  if (!artist) notFound();

  const collaborators = getCollaborators(artist.id);
  const labels = getArtistLabels(artist.id);
  const names = getProfileNames(artist.profile);
  const relations = getRelations(artist.id);
  const releases = getArtistReleases(artist.id);

  return (
    <div className="max-w-4xl">
      <header className="border-line mb-3 border-b pb-2">
        <h1 className="text-base font-semibold tracking-tight">{artist.name}</h1>
        {artist.realName && artist.realName !== artist.name && (
          <p className="text-ink-faint text-xs">{artist.realName}</p>
        )}
        <p className="text-ink-dim mt-1 flex flex-wrap gap-x-3 text-xs tabular-nums">
          <span>{artist.releaseCount} releases</span>
          <span>{artist.collaboratorCount} collaborators</span>
          <span>{artist.labelCount} labels</span>
          {years(artist.firstYear, artist.lastYear) && (
            <span>{years(artist.firstYear, artist.lastYear)}</span>
          )}
          <Provenance artist={artist} />
        </p>
        <OutboundLinks kind="artist" id={artist.id} urls={artist.urls} />
      </header>

      {artist.profile && (
        <section className="mb-4 max-w-2xl">
          <p className="text-ink-dim text-sm leading-relaxed whitespace-pre-line">
            <ProfileText text={artist.profile} names={names} />
          </p>
        </section>
      )}

      <Relations relations={relations} />

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <Heading>Collaborators</Heading>
          {collaborators.length > 0 ? (
            <ul className="divide-line border-line divide-y border-y">
              {collaborators.map((c) => (
                <li key={c.id} className="flex gap-2 py-1 text-sm">
                  <span className="text-ink-faint w-6 shrink-0 text-right tabular-nums">
                    {c.sharedReleases}
                  </span>
                  <span className="min-w-0">
                    <Link href={`/artist/${c.id}`}>{c.name}</Link>
                    {c.roles.length > 0 && (
                      <span className="text-ink-faint block truncate text-xs">
                        {c.roles.join(", ")}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <NoCollaborators artist={artist} />
          )}
        </section>

        <section>
          <Heading>Labels</Heading>
          {labels.length > 0 ? (
            <ul className="divide-line border-line divide-y border-y">
              {labels.map((l) => (
                <li key={l.id} className="flex gap-2 py-1 text-sm">
                  <span className="text-ink-faint w-6 shrink-0 text-right tabular-nums">
                    {l.releaseCount}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link href={`/label/${l.id}`}>{l.name}</Link>
                  </span>
                  <span className="text-ink-faint shrink-0 text-xs tabular-nums">
                    {years(l.firstYear, l.lastYear)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No labels recorded.</Empty>
          )}
        </section>
      </div>

      <section className="mt-6">
        <Heading>Releases</Heading>
        {releases.length > 0 ? (
          <ul className="divide-line border-line divide-y border-y">
            {releases.map((r) => (
              <li key={r.id} className="flex gap-2 py-1 text-sm">
                <span className="text-ink-faint w-9 shrink-0 text-right text-xs tabular-nums">
                  {r.year ?? ""}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  <a
                    href={`https://www.discogs.com/release/${r.id}`}
                    rel="noreferrer"
                    className="underline-offset-2 hover:underline"
                  >
                    {r.title}
                  </a>
                  {r.roles.length > 0 && (
                    <span className="text-ink-faint text-xs"> {r.roles.join(", ")}</span>
                  )}
                </span>
                {r.label && (
                  <span className="text-ink-faint shrink-0 truncate text-xs">{r.label}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No releases in this corpus.</Empty>
        )}
      </section>
    </div>
  );
}

/**
 * Aliases, members and groups, kept apart from the collaborator list.
 *
 * Basic Channel IS Moritz von Oswald and Mark Ernestus. That is a different
 * fact from having been co-credited with them, and the credits alone never say
 * it: their releases credit Moritz twice, as a cutting engineer, and Ernestus
 * not at all. Showing this as a collaboration would be the same dishonesty as
 * calling a label mate a collaborator.
 */
function Relations({ relations }: { relations: Relation[] }) {
  if (relations.length === 0) return null;

  const groups: [string, Relation["kind"]][] = [
    ["Also known as", "alias"],
    ["Members", "member"],
    ["Member of", "group"],
  ];

  return (
    <section className="mb-4">
      {groups.map(([label, kind]) => {
        const of = relations.filter((r) => r.kind === kind);
        if (of.length === 0) return null;
        return (
          <p key={kind} className="mb-1 flex flex-wrap items-baseline gap-x-2 text-sm">
            <span className="text-ink-faint w-24 shrink-0 text-xs tracking-wide uppercase">
              {label}
            </span>
            {of.map((r, i) => (
              <span key={r.id}>
                <Link href={`/artist/${r.id}`} className={r.inCorpus ? "" : "text-ink-faint"}>
                  {r.name}
                </Link>
                {r.releaseCount > 0 && (
                  <span className="text-ink-faint text-xs tabular-nums"> {r.releaseCount}</span>
                )}
                {i < of.length - 1 && <span className="text-ink-faint">,</span>}
              </span>
            ))}
          </p>
        );
      })}
    </section>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-ink-faint mb-1 text-xs font-semibold tracking-wide uppercase">
      {children}
    </h2>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-ink-faint border-line border-y py-2 text-sm">{children}</p>;
}

/**
 * "Nobody has entered the credits" and "they worked alone" are different
 * answers, and an empty list that looks like an answer is worse than an honest
 * absence. The coverage flags are what let the page tell them apart.
 */
function NoCollaborators({ artist }: { artist: { releaseCount: number; creditedReleases: number } }) {
  if (artist.releaseCount === 0) return <Empty>No releases in this corpus.</Empty>;
  if (artist.creditedReleases === 0) {
    return (
      <Empty>
        No credits recorded. Nobody has entered credits for any of these{" "}
        {artist.releaseCount} releases, so this is missing data rather than solo work.
      </Empty>
    );
  }
  return (
    <Empty>
      Worked alone. Credits exist on {artist.creditedReleases} of {artist.releaseCount} releases
      and name no one else.
    </Empty>
  );
}

/**
 * How central they are, with the numbers behind it.
 *
 * A grade on its own is an assertion. "high · 61 in the scene, 79% of their
 * output" is the same claim with its working shown, which is the difference
 * between asking a digger to trust the tool and letting them check it.
 *
 * The share is against their whole catalogue, which is deliberately not the
 * release count beside it: that one counts the corpus, and for an artist who
 * mostly works elsewhere the two are far apart. Showing the percentage rather
 * than the second total keeps the honest number without putting two totals on
 * one line for the reader to reconcile.
 *
 * For an artist with no scene work at all the grade would be meaningless, so
 * the row says how they got here instead: a collaborator is not the same as a
 * label mate, and neither is a weak version of being core.
 */
function Provenance({ artist }: { artist: Artist }) {
  if (artist.relevance === "none") {
    if (artist.channelA && artist.channelB) return <span>collaborator + label mate</span>;
    if (artist.channelA) return <span>collaborator</span>;
    if (artist.channelB) return <span>label mate</span>;
    return null;
  }

  return (
    <span className={artist.relevance === "high" ? "text-accent" : undefined}>
      {artist.relevance}
      <span className="text-ink-faint">
        {" · "}
        {artist.seedReleases} in the scene
        {artist.seedShare !== null && `, ${Math.round(artist.seedShare * 100)}% of their output`}
      </span>
    </span>
  );
}
