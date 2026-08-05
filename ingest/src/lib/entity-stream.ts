import { StringDecoder } from "node:string_decoder";
import type { Readable } from "node:stream";
import { SaxesParser } from "saxes";

/** How one artist is related to another, as Discogs itself records it. */
export type RelationKind = "alias" | "member" | "group";

export interface ParsedRelation {
  kind: RelationKind;
  id: number;
  name: string;
}

export interface ParsedEntity {
  id: number;
  name: string;
  /** Artists only. Labels never carry one. */
  realName: string | null;
  /** Raw Discogs markup, rendered at display time. */
  profile: string | null;
  /** The entity's own links. */
  urls: string[];
  /**
   * Aliases, members and groups, straight from the dump.
   *
   * This is the only place the connection between an act and the people in it
   * is recorded. Basic Channel's records credit Moritz von Oswald twice, as a
   * cutting engineer, and Mark Ernestus not at all, so credits alone cannot say
   * the duo is the duo. The dump says so here, explicitly, with ids.
   */
  relations: ParsedRelation[];
}

const RELATION_SECTIONS: Record<string, RelationKind> = {
  aliases: "alias",
  members: "member",
  groups: "group",
};

/**
 * Streams the artists or labels dump, yielding one thin entity at a time.
 *
 * Both files repeat their own element name inside themselves, which is the same
 * trap the releases dump sets with <tracklist>. In the artists dump <name>
 * appears again under namevariations, aliases, members and groups; in the labels
 * dump <label> nests under <sublabels>. Only depth-1 fields are read as the
 * entity's own, and the nested sections are read only where they are wanted.
 */
export async function* streamEntities(
  input: Readable | AsyncIterable<Buffer | string>,
  kind: "artist" | "label",
): AsyncGenerator<ParsedEntity> {
  const ready: ParsedEntity[] = [];
  const parser = new SaxesParser();

  let entity: ParsedEntity | null = null;
  /** Element names inside the current entity, so a section knows its parent. */
  let stack: string[] = [];
  let text = "";

  parser.on("error", (err) => {
    throw err;
  });

  parser.on("opentag", (node) => {
    if (entity === null) {
      if (node.name !== kind) return; // the root element, and anything stray
      entity = { id: 0, name: "", realName: null, profile: null, urls: [], relations: [] };
      stack = [node.name];
      text = "";
      return;
    }

    stack.push(node.name);
    text = "";

    // <aliases>, <members> and <groups> all hold <name id="123">Someone</name>.
    // The id attribute is what makes them navigable rather than just text.
    if (node.name === "name" && stack.length === 3) {
      const section = RELATION_SECTIONS[stack[1]!];
      const id = Number(node.attributes["id"]);
      if (section && Number.isInteger(id) && id > 0) {
        entity.relations.push({ kind: section, id, name: "" });
      }
    }
  });

  parser.on("text", (chunk) => {
    if (entity !== null) text += chunk;
  });

  parser.on("closetag", (node) => {
    if (entity === null) return;

    stack.pop();
    const value = text.trim();

    if (stack.length === 0) {
      if (entity.id > 0) ready.push(entity);
      entity = null;
      text = "";
      return;
    }

    // Only the entity's own direct children count. Everything nested deeper
    // belongs to an alias, a member, a sublabel or similar.
    if (stack.length === 1) {
      if (node.name === "id") entity.id = Number(value);
      else if (node.name === "name") entity.name = value;
      else if (node.name === "realname") entity.realName = value || null;
      else if (node.name === "profile") entity.profile = value || null;
    } else if (stack.length === 2) {
      if (node.name === "url" && value) entity.urls.push(value);
      // Fill in the name of the relation opened above.
      if (node.name === "name" && RELATION_SECTIONS[stack[1]!]) {
        const last = entity.relations.at(-1);
        if (last && last.name === "") last.name = value;
      }
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
