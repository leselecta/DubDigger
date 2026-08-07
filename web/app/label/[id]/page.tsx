import { notFound } from "next/navigation";
import { connection } from "next/server";
import {
  getLabel,
  getRoster,
  getProfileNames,
  getLabelReleases,
  type Label,
} from "@/lib/queries";
import { ProfileText } from "@/components/profile-text";
import { OutboundLinks } from "@/components/outbound-links";
import { SiteHeader } from "@/components/site-header";
import { CollapsibleText } from "@/components/collapsible-text";
import { Tabs, LoadMore } from "@/components/tabs";
import {
  Absence,
  CreditRow,
  Eyebrow,
  FieldRow,
  LabelledBand,
  ListHeader,
} from "@/components/page-parts";
import { PAGE_SIZE, pageSize, years } from "@/lib/view";

export default async function LabelPage({
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
  const { tab = "roster", show } = await searchParams;

  const label = getLabel(Number(id));
  if (!label) notFound();

  const limit = pageSize(show);
  const base = `/label/${label.id}`;

  const tabs = [
    { key: "roster", label: "Roster", count: label.artistCount },
    { key: "releases", label: "Releases", count: label.releaseCount },
  ];
  const active = tabs.some((t) => t.key === tab) ? tab : "roster";
  const total = tabs.find((t) => t.key === active)!.count;

  return (
    <>
      <SiteHeader />

      <div className="column pt-16 pb-16 md:pt-24">
        <Eyebrow>Label</Eyebrow>
        <h1 className="text-name-label text-ink-strong mt-6 leading-[0.9] font-bold tracking-[-0.045em]">
          {label.name}
        </h1>

        <p className="text-ink-muted mt-10 font-mono text-[0.8125rem] tracking-[0.06em] uppercase">
          {/*
           * No scene share here, unlike the artist stat line. The Relevance
           * row below carries the same percentage, and the two sit close enough
           * that repeating it reads as a mistake.
           */}
          {label.releaseCount.toLocaleString("en-GB")} releases &nbsp;·&nbsp;{" "}
          {label.artistCount.toLocaleString("en-GB")} artists
        </p>

        <dl className="mt-9 max-w-[760px]">
          <FieldRow label="Date active">{years(label.firstYear, label.lastYear) || "—"}</FieldRow>
          <FieldRow label="Relevance" accent={label.isSeed}>
            <Relevance label={label} />
          </FieldRow>
          <div className="border-hairline border-b">
            <FieldRow label="View on">
              <OutboundLinks kind="label" id={label.id} urls={label.urls} />
            </FieldRow>
          </div>
        </dl>
      </div>

      {label.profile && (
        <div className="column">
          <LabelledBand label="Info">
            <CollapsibleText>
              <div className="text-body text-[#d4d4d4] leading-[1.6] whitespace-pre-line">
                <ProfileText text={label.profile} names={getProfileNames(label.profile)} />
              </div>
            </CollapsibleText>
          </LabelledBand>
        </div>
      )}

      <div className="column pt-14 pb-32">
        <Tabs tabs={tabs} active={active} basePath={base} />

        {active === "roster" ? (
          <Roster labelId={label.id} limit={limit} />
        ) : (
          <Releases labelId={label.id} limit={limit} />
        )}

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

function Roster({ labelId, limit }: { labelId: number; limit: number }) {
  const rows = getRoster(labelId, limit);
  if (rows.length === 0) return <Absence>No roster recorded for this label.</Absence>;

  return (
    <>
      <ListHeader name="Artist" count="Releases" meta="Active" />
      <ul>
        {rows.map((a) => (
          <CreditRow
            key={a.id}
            count={a.releaseCount}
            href={`/artist/${a.id}`}
            name={a.name}
            meta={years(a.firstYear, a.lastYear)}
          />
        ))}
      </ul>
    </>
  );
}

function Releases({ labelId, limit }: { labelId: number; limit: number }) {
  const rows = getLabelReleases(labelId, limit);
  if (rows.length === 0) return <Absence>No releases in this corpus.</Absence>;

  return (
    <>
      <ListHeader name="Release" count="Year" meta="Cat no." />
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
 * How close to the scene, in the words the search results use.
 *
 * Labels are not on the artist scale, but they have a measure of their own: a
 * seed label is a scene label by roster concentration. The grade comes first
 * for the same reason it does on the artist page — one vocabulary, whichever
 * page you land on — and the reason rides alongside it, since a label's grade
 * rests entirely on a percentage worth reading.
 *
 * A one artist label is not a thin roster, it is an imprint, and saying
 * "partial roster" about Purpose Maker would be describing complete data as
 * incomplete.
 */
function Relevance({ label }: { label: Label }) {
  const reason = label.isImprint
    ? "artist-run imprint, one artist on every release"
    : label.seedRatio !== null
      ? `${Math.round(label.seedRatio * 100)}% of roster in the dub techno scene`
      : "here through its artists, not as a label in the dub techno scene";

  return (
    <>
      {label.isSeed ? "High" : "Low"}
      <span className="text-ink-faint">, {reason}</span>
    </>
  );
}
