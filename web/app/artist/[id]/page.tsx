import Link from "next/link";
import { notFound } from "next/navigation";
import { getArtist, getCollaborators, getArtistLabels } from "@/lib/queries";

export const dynamic = "force-dynamic";

function years(from: number | null, to: number | null): string {
  if (!from && !to) return "";
  if (from === to) return String(from);
  return `${from ?? "?"}–${to ?? "?"}`;
}

export default async function ArtistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artist = getArtist(Number(id));
  if (!artist) notFound();

  const collaborators = getCollaborators(artist.id);
  const labels = getArtistLabels(artist.id);

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
      </header>

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
    </div>
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

/** A collaborator is not the same as a label mate, so the page says which. */
function Provenance({ artist }: { artist: { isSeed: boolean; channelA: boolean; channelB: boolean } }) {
  if (artist.isSeed) return <span className="text-accent">core</span>;
  if (artist.channelA && artist.channelB) return <span>collaborator + label mate</span>;
  if (artist.channelA) return <span>collaborator</span>;
  if (artist.channelB) return <span>label mate</span>;
  return null;
}
