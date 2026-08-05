/**
 * Links out to Discogs and to the entity's own sites.
 *
 * The Discogs URL is pure id substitution, so it needs no API call and carries
 * no licensing exposure. That is deliberately the whole of it: CLAUDE.md keeps
 * images out of v1 because they are Restricted Data, and names linking out as
 * the cheap alternative.
 */
export function OutboundLinks({
  kind,
  id,
  urls,
}: {
  kind: "artist" | "label";
  id: number;
  urls: string[];
}) {
  const host = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  };

  return (
    <p className="text-ink-faint mt-1 flex flex-wrap gap-x-3 text-xs">
      <a
        href={`https://www.discogs.com/${kind}/${id}`}
        rel="noreferrer"
        className="underline underline-offset-2"
      >
        view on Discogs
      </a>
      {urls.slice(0, 4).map((url) => (
        <a key={url} href={url} rel="noreferrer nofollow" className="underline underline-offset-2">
          {host(url)}
        </a>
      ))}
    </p>
  );
}
