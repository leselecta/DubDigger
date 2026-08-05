import Link from "next/link";

/**
 * Renders a Discogs profile, which arrives as their own markup:
 *
 *   [a123] [l456]        typed references, by id
 *   [a=Name] [l=Name]    typed references, by name only
 *   [b] [i] [u]          emphasis
 *   [url=http://x]y[/url]
 *
 * The id forms are the interesting ones: they turn a bio into more threads to
 * follow, linking straight into this tool's own pages. The name-only forms have
 * no id to resolve, so they render as plain text rather than as a guess.
 */

const TOKEN = /\[(a|l)(\d+)\]|\[(a|l)=([^\]]+)\]|\[url=([^\]]+)\]([^[]*)\[\/url\]|\[\/?[biu]\]/gi;

export function ProfileText({ text, names = {} }: { text: string; names?: Record<string, string> }) {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of text.matchAll(TOKEN)) {
    const at = match.index;
    if (at > cursor) nodes.push(text.slice(cursor, at));
    cursor = at + match[0].length;

    const [, kindById, id, , nameOnly, href, label] = match;

    if (kindById && id) {
      const path = kindById.toLowerCase() === "a" ? "artist" : "label";
      // Falls back to the bare id only when the entity is outside this corpus.
      nodes.push(
        <Link key={key++} href={`/${path}/${id}`} className="underline underline-offset-2">
          {names[`${kindById.toLowerCase()}${id}`] ?? `${path} ${id}`}
        </Link>,
      );
    } else if (nameOnly) {
      nodes.push(nameOnly);
    } else if (href) {
      nodes.push(
        <a key={key++} href={href} rel="noreferrer nofollow" className="underline underline-offset-2">
          {label || href}
        </a>,
      );
    }
    // Emphasis tags fall through: the tag is dropped, its text is already kept.
  }

  if (cursor < text.length) nodes.push(text.slice(cursor));
  return <>{nodes}</>;
}
