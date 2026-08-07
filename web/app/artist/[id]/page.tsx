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
import { SiteHeader } from "@/components/site-header";
import { CollapsibleText } from "@/components/collapsible-text";
import { Tabs, LoadMore } from "@/components/tabs";
import {
  Absence,
  Chip,
  CreditRow,
  Eyebrow,
  FieldRow,
  LabelledBand,
  ListHeader,
} from "@/components/page-parts";
import { PAGE_SIZE, pageSize, percent, years } from "@/lib/view";

export default async function ArtistPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; show?: string }>;
}) {
  // The SQLite file is a static artifact regenerated out of band, so every page
  // must read it per request. connection() is the current way to say that: it
  // ties dynamic rendering to the incoming request, and supersedes the
  // deprecated `export const dynamic = "force-dynamic"`.
  await connection();

  const { id } = await params;
  const { tab = "collaborators", show } = await searchParams;

  const artist = getArtist(Number(id));
  if (!artist) notFound();

  const limit = pageSize(show);
  const relations = getRelations(artist.id);
  const base = `/artist/${artist.id}`;

  const tabs = [
    { key: "collaborators", label: "Collaborators", count: artist.collaboratorCount },
    { key: "labels", label: "Labels", count: artist.labelCount },
    { key: "releases", label: "Releases", count: artist.releaseCount },
  ];
  const active = tabs.some((t) => t.key === tab) ? tab : "collaborators";
  const total = tabs.find((t) => t.key === active)!.count;

  const groups: [string, Relation["kind"]][] = [
    ["Also known as", "alias"],
    ["Members", "member"],
    ["Member of", "group"],
  ];

  return (
    <>
      <SiteHeader />

      <div className="column pt-16 pb-16 md:pt-24">
        <Eyebrow>Artist</Eyebrow>
        <h1 className="text-name text-ink-strong mt-6 leading-[0.92] font-bold tracking-[-0.04em]">
          {artist.name}
        </h1>

        <p className="text-ink-muted mt-10 font-mono text-[0.8125rem] tracking-[0.06em] uppercase">
          {artist.releaseCount.toLocaleString("en-GB")} releases &nbsp;·&nbsp;{" "}
          {artist.collaboratorCount.toLocaleString("en-GB")} collaborators &nbsp;·&nbsp;{" "}
          {artist.labelCount.toLocaleString("en-GB")} labels
          {artist.seedReleases > 0 && (
            <>
              {" "}
              &nbsp;·&nbsp;{" "}
              <span className="text-accent">
                {artist.seedReleases.toLocaleString("en-GB")} in the dub techno scene
                {artist.seedShare !== null && `, ${percent(artist.seedShare)} of output`}
              </span>
            </>
          )}
        </p>

        <dl className="mt-9 max-w-[760px]">
          {artist.realName && artist.realName !== artist.name && (
            <FieldRow label="Real name">{artist.realName}</FieldRow>
          )}
          <FieldRow label="Date active">{years(artist.firstYear, artist.lastYear) || "—"}</FieldRow>
          <FieldRow label="Relevance" accent={artist.relevance !== "none"}>
            <Relevance artist={artist} />
          </FieldRow>
          <div className="border-hairline border-b">
            <FieldRow label="View on">
              <OutboundLinks kind="artist" id={artist.id} urls={artist.urls} />
            </FieldRow>
          </div>
        </dl>
      </div>

      <div className="column">
        {artist.profile && (
          <LabelledBand label="Bio">
            <CollapsibleText>
              <div className="text-body text-[#d4d4d4] leading-[1.6] whitespace-pre-line">
                <ProfileText text={artist.profile} names={getProfileNames(artist.profile)} />
              </div>
            </CollapsibleText>
          </LabelledBand>
        )}

        {groups.map(([label, kind]) => {
          const of = relations.filter((r) => r.kind === kind);
          if (of.length === 0) return null;
          return (
            <LabelledBand key={kind} label={label}>
              <div className="flex max-w-[760px] flex-wrap gap-x-3 gap-y-[10px]">
                {of.map((r) => (
                  <Chip
                    key={`${kind}-${r.id}`}
                    href={`/artist/${r.id}`}
                    name={r.name}
                    count={r.releaseCount}
                  />
                ))}
              </div>
            </LabelledBand>
          );
        })}
      </div>

      <div className="column pt-14 pb-32">
        <Tabs tabs={tabs} active={active} basePath={base} />

        {active === "collaborators" && <Collaborators artist={artist} limit={limit} />}
        {active === "labels" && <Labels artistId={artist.id} limit={limit} />}
        {active === "releases" && <Releases artistId={artist.id} limit={limit} />}

        {limit < total && (
          <LoadMore
            href={`${base}?tab=${active}&show=${limit + PAGE_SIZE}`}
            remaining={total - limit}
          />
        )}
      </div>
    </>
  );
}

function Collaborators({ artist, limit }: { artist: Artist; limit: number }) {
  const rows = getCollaborators(artist.id, limit);
  if (rows.length === 0) return <NoCollaborators artist={artist} />;

  return (
    <>
      <ListHeader name="Name" count="Shared" />
      <ul>
        {rows.map((c) => (
          <CreditRow
            key={c.id}
            count={c.sharedReleases}
            href={`/artist/${c.id}`}
            name={c.name}
            detail={c.roles.join(" · ")}
          />
        ))}
      </ul>
    </>
  );
}

function Labels({ artistId, limit }: { artistId: number; limit: number }) {
  const rows = getArtistLabels(artistId).slice(0, limit);
  if (rows.length === 0) return <Absence>No labels recorded.</Absence>;

  return (
    <>
      <ListHeader name="Label" count="Releases" meta="Active" />
      <ul>
        {rows.map((l) => (
          <CreditRow
            key={l.id}
            count={l.releaseCount}
            href={`/label/${l.id}`}
            name={l.name}
            meta={years(l.firstYear, l.lastYear)}
          />
        ))}
      </ul>
    </>
  );
}

function Releases({ artistId, limit }: { artistId: number; limit: number }) {
  const rows = getArtistReleases(artistId, limit);
  if (rows.length === 0) return <Absence>No releases in this corpus.</Absence>;

  return (
    <>
      <ListHeader name="Release" count="Year" meta="Label" />
      <ul>
        {rows.map((r) => (
          <CreditRow
            key={r.id}
            count={r.year ?? "—"}
            href={`https://www.discogs.com/release/${r.id}`}
            name={r.title}
            external
            detail={r.roles.join(" · ")}
            meta={r.label}
          />
        ))}
      </ul>
    </>
  );
}

/**
 * How central they are, said as tie strength rather than as a bare grade.
 *
 * The four steps are the ones the search results use. The clause says what the
 * step means without repeating the numbers behind it, which are already in the
 * accent stat line above.
 *
 * "Very low" carries the route as well, because an artist with no seed work is
 * not a weak version of core, they are a neighbour, and a label mate is not a
 * weak collaborator. That distinction is too useful to drop.
 */
const RELEVANCE_REASON: Record<string, string> = {
  high: "very strong ties with the core dub techno scene",
  medium: "strong ties with the core dub techno scene",
  low: "weak ties with the core dub techno scene",
};

function Relevance({ artist }: { artist: Artist }) {
  if (artist.relevance !== "none") {
    return (
      <>
        <span className="capitalize">{artist.relevance}</span>
        <span className="text-ink-faint">, {RELEVANCE_REASON[artist.relevance]}</span>
      </>
    );
  }

  const route =
    artist.channelA && artist.channelB
      ? "a one time collaborator and label mate"
      : artist.channelA
        ? "a one time collaborator"
        : artist.channelB
          ? "a one time label mate"
          : "a one time collaborator or label mate";

  return (
    <>
      Very low
      <span className="text-ink-faint">
        , very weak ties with the core dub techno scene (here as {route})
      </span>
    </>
  );
}

/**
 * "Nobody has entered the credits" and "they worked alone" are different
 * answers, and an empty list that looks like an answer is worse than an honest
 * absence. The coverage flags are what let the page tell them apart.
 */
function NoCollaborators({ artist }: { artist: Artist }) {
  if (artist.releaseCount === 0) return <Absence>No releases in this corpus.</Absence>;
  if (artist.creditedReleases === 0) {
    return (
      <Absence>
        No credits recorded. Nobody has entered credits for any of these{" "}
        {artist.releaseCount.toLocaleString("en-GB")} releases, so this is missing data rather than
        solo work.
      </Absence>
    );
  }
  return (
    <Absence>
      Worked alone. Credits exist on {artist.creditedReleases.toLocaleString("en-GB")} of{" "}
      {artist.releaseCount.toLocaleString("en-GB")} releases and name no one else.
    </Absence>
  );
}
