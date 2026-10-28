// The page (round 3b): a task's / idea's / goal's notes, read as Markdown blocks, ONE block
// per line. Every block keeps its line's exact text as `prefix + text`, so turning notes
// into blocks and back gives the same notes byte for byte (her older plain notes and the
// imported ones, e.g. "Check: not sure if this is still open" or "Done when: ...", stay
// plain lines). Only these lines mean something:
//   "# x" / "## x"            headings
//   "- [ ] x" / "- [x] x"     checklist (also "*" or "+", indented, "[X]")
//   "- x"                     bullet (also "*" or "+", indented)
//   "![](file:<id>)"          a picture, alone on its line (files table)
// Anything else is a paragraph line, shown as typed. URLs and obsidian:// links in the text
// (bare, or as [label](url)) are shown as links.

export type BlockType = "p" | "h1" | "h2" | "check" | "bullet" | "picture";

export interface Block {
  type: BlockType;
  /** The line's marker, exactly as written ("" for a paragraph; the whole line for a picture). */
  prefix: string;
  /** What is typed after the marker ("" for a picture). */
  text: string;
  /** Checklist: ticked. */
  done?: boolean;
  /** Picture: the files row id. */
  fileId?: string;
  /** Leading spaces/tabs before a list marker (for indenting nested lists). */
  indent: number;
}

const CHECK = /^([ \t]*)[-*+] \[([ xX])\](?: |$)/;
const BULLET = /^([ \t]*)[-*+] /;
const HEADING = /^(#{1,2}) /;
/** A picture line. File ids are UUIDs; any id of these characters is accepted. */
const PICTURE = /^!\[[^\]\n]*\]\(file:([A-Za-z0-9_-]{1,128})\)$/;
const PICTURE_ANYWHERE = /!\[[^\]\n]*\]\(file:([A-Za-z0-9_-]{1,128})\)/g;

/** One line as a block. `lineOf(parseLine(x)) === x` for every line without "\n". */
export function parseLine(line: string): Block {
  const pic = PICTURE.exec(line);
  if (pic) return { type: "picture", prefix: line, text: "", fileId: pic[1], indent: 0 };
  const check = CHECK.exec(line);
  if (check) {
    const prefix = check[0];
    return { type: "check", prefix, text: line.slice(prefix.length), done: check[2] !== " ", indent: check[1]!.length };
  }
  const bullet = BULLET.exec(line);
  if (bullet) return { type: "bullet", prefix: bullet[0], text: line.slice(bullet[0].length), indent: bullet[1]!.length };
  const heading = HEADING.exec(line);
  if (heading) {
    return { type: heading[1] === "#" ? "h1" : "h2", prefix: heading[0], text: line.slice(heading[0].length), indent: 0 };
  }
  return { type: "p", prefix: "", text: line, indent: 0 };
}

/** The line a block stands for. */
export const lineOf = (b: Block): string => b.prefix + b.text;

/** Notes as blocks (empty notes are one empty paragraph). */
export function parsePage(md: string): Block[] {
  return md.split("\n").map(parseLine);
}

/** Blocks back to notes. */
export function serializePage(blocks: Block[]): string {
  return blocks.map(lineOf).join("\n");
}

/**
 * The line after typing `text` into a block: the marker stays, with the space it needs
 * once there is text after it ("- [ ]" + "x" becomes "- [ ] x", never "- [ ]x").
 */
export function withText(b: Block, text: string): string {
  if (b.type === "picture") return b.prefix;
  const prefix = text !== "" && b.prefix !== "" && !/\s$/.test(b.prefix) ? `${b.prefix} ` : b.prefix;
  return prefix + text;
}

/** A checklist line ticked or unticked; any other line is returned as it was. */
export function toggleCheckLine(line: string): string {
  const m = CHECK.exec(line);
  if (!m) return line;
  const at = m[1]!.length + 3; // indent, marker, space, "["
  return line.slice(0, at) + (m[2] === " " ? "x" : " ") + line.slice(at + 1);
}

/** The marker a new line gets when Enter is pressed at the end of this block. */
export function continuation(b: Block): string {
  if (b.type === "check") return `${b.prefix.slice(0, b.indent)}${b.prefix.charAt(b.indent)} [ ] `;
  if (b.type === "bullet") return b.prefix;
  return "";
}

/** The picture line for a stored file. */
export const pictureLine = (fileId: string): string => `![](file:${fileId})`;

/** Every picture id a page refers to (anywhere in it). */
export function pictureIds(md: string): string[] {
  return [...md.matchAll(PICTURE_ANYWHERE)].map((m) => m[1]!);
}

/** The new-line markers the add-buttons and "/" menu use. */
export const NEW_LINE = { heading: "# ", checklist: "- [ ] " } as const;

// ---- links -------------------------------------------------------------------------------

export interface Segment {
  kind: "text" | "link";
  /** What is shown. */
  text: string;
  /** Link target (http, https or obsidian only). */
  href?: string;
  /** Where the segment sits in the raw text. */
  start: number;
  end: number;
  /** The shown text is exactly the raw text (so a click maps 1:1 back into it). */
  verbatim: boolean;
}

// [label](url) first, then bare URLs. Only web and Obsidian links become links.
const LINKS = /\[([^\]\n]+)\]\(((?:https?|obsidian):\/\/[^\s)]+)\)|((?:https?|obsidian):\/\/[^\s<>"]+)/gi;
/** Trailing punctuation that ends a sentence rather than the URL. */
const TRAILING = /[.,;:!?'")\]]+$/;

/** A line's text cut into plain text and links. */
export function linkify(text: string): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const m of text.matchAll(LINKS)) {
    const start = m.index;
    let raw = m[0];
    let label: string;
    let href: string;
    let verbatim: boolean;
    if (m[1] !== undefined) {
      label = m[1];
      href = m[2]!;
      verbatim = false;
    } else {
      raw = raw.replace(TRAILING, "");
      label = raw;
      href = raw;
      verbatim = true;
    }
    if (!/^(https?|obsidian):\/\/./i.test(href)) continue;
    if (start > at) out.push({ kind: "text", text: text.slice(at, start), start: at, end: start, verbatim: true });
    out.push({ kind: "link", text: label, href, start, end: start + raw.length, verbatim });
    at = start + raw.length;
  }
  if (at < text.length) out.push({ kind: "text", text: text.slice(at), start: at, end: text.length, verbatim: true });
  return out;
}

/** A link the person typed into the Link field, made safe to keep (web or Obsidian only). */
export function cleanLink(input: string): string | null {
  const t = input.trim();
  if (/^(https?|obsidian):\/\/\S+$/i.test(t)) return t;
  if (/^www\.\S+$/i.test(t)) return `https://${t}`;
  return null;
}
