import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";
import { SaxesParser } from "saxes";

export interface ParsedEntity {
  id: number;
  name: string;
  /** Artists only. Labels never carry one. */
  realName: string | null;
}

/**
 * Streams the artists or labels dump, yielding one thin entity at a time.
 *
 * Both files repeat their own element name inside themselves, which is the same
 * trap the releases dump sets with <tracklist>. In the artists dump <name>
 * appears again under namevariations, aliases, members and groups; in the labels
 * dump <label> nests under <sublabels>. Only depth-1 fields are read, and any
 * subtree is skipped rather than descended into.
 */
export async function* streamEntities(
  input: Readable | AsyncIterable<Buffer | string>,
  kind: "artist" | "label",
): AsyncGenerator<ParsedEntity> {
  const ready: ParsedEntity[] = [];
  const parser = new SaxesParser();

  let entity: ParsedEntity | null = null;
  let depth = 0;
  let text = "";

  parser.on("error", (err) => {
    throw err;
  });

  parser.on("opentag", (node) => {
    if (entity === null) {
      if (node.name !== kind) return; // the root element, and anything stray
      entity = { id: 0, name: "", realName: null };
      depth = 1;
      text = "";
      return;
    }
    depth++;
    text = "";
  });

  parser.on("text", (chunk) => {
    if (entity !== null) text += chunk;
  });

  parser.on("closetag", (node) => {
    if (entity === null) return;

    depth--;
    if (depth === 0) {
      if (entity.id > 0) ready.push(entity);
      entity = null;
      text = "";
      return;
    }

    // Only the entity's own direct children count. Everything nested deeper
    // belongs to an alias, a member, a sublabel or similar.
    if (depth === 1) {
      const value = text.trim();
      if (node.name === "id") entity.id = Number(value);
      else if (node.name === "name") entity.name = value;
      else if (node.name === "realname") entity.realName = value || null;
    }
    text = "";
  });

  const decoder = new StringDecoder("utf8");
  for await (const chunk of input) {
    const str = typeof chunk === "string" ? chunk : decoder.write(chunk);
    if (str) parser.write(str);
    while (ready.length > 0) yield ready.shift()!;
  }

  const tail = decoder.end();
  if (tail) parser.write(tail);
  parser.close();

  while (ready.length > 0) yield ready.shift()!;
}
