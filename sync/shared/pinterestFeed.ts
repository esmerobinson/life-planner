// Pinterest board RSS -> pins. Pure and dependency-free (no DOMParser in Workers), used by
// src/pinterest.ts and timed by test/node/pinterest-feed.test.ts.
//
// Linear time on ANY input: tags are found with indexOf, each search starting where the last
// one ended and bounded by the enclosing <item>; the only regexes run on short, bounded slices
// (one <img> tag of at most MAX_TAG_CHARS) or cannot backtrack (entity decoding). Hostile or
// malformed feeds (unclosed tags, nesting, look-alike names) therefore cost no more than
// reading them once.
//
// Only https://i.pinimg.com/ images and https://www.pinterest.com/ or https://pinterest.com/
// links (no credentials, no port) are ever returned; anything else is dropped.

export interface Pin {
  img: string;
  link: string;
}

/** More than the feed ever holds (about 25); a hostile feed cannot make a huge response. */
export const MAX_PINS = 200;
/** An <img ...> tag longer than this is not a real pin image and is skipped. */
export const MAX_TAG_CHARS = 4096;
/** Only the start of a description is read (the real one is ~200 chars, image first). */
export const MAX_DESCRIPTION_CHARS = 8192;
/** A link longer than this is not a pin link. */
export const MAX_LINK_CHARS = 2048;

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{1,8});/g, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name] ?? whole;
  });
}

function isTagEnd(ch: string | undefined): boolean {
  return ch === ">" || ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "/";
}

/** Index of the next `<tag` (not `<tagz`) in text[from, to), or -1. */
function findOpen(text: string, tag: string, from: number, to: number): number {
  const needle = `<${tag}`;
  let at = text.indexOf(needle, from);
  while (at !== -1 && at + needle.length < to) {
    if (isTagEnd(text[at + needle.length])) return at;
    at = text.indexOf(needle, at + needle.length);
  }
  return -1;
}

/** Content of the first <tag ...>...</tag> in `text` (one item, so every search is bounded by it), or null. */
function elementContent(text: string, tag: string): string | null {
  const open = findOpen(text, tag, 0, text.length);
  if (open === -1) return null;
  const openEnd = text.indexOf(">", open);
  if (openEnd === -1) return null;
  const close = text.indexOf(`</${tag}>`, openEnd + 1);
  if (close === -1) return null;
  return text.slice(openEnd + 1, close);
}

/** Element text: CDATA kept raw, otherwise entities decoded. */
function elementText(raw: string): string {
  const inner = raw.trim();
  if (inner.startsWith("<![CDATA[") && inner.endsWith("]]>")) return inner.slice(9, -3);
  return decodeEntities(inner);
}

/** The HTML at the start of a description (bounded, so decoding costs at most MAX_DESCRIPTION_CHARS). */
function descriptionHtml(raw: string): string {
  const head = raw.trimStart().slice(0, MAX_DESCRIPTION_CHARS);
  if (head.startsWith("<![CDATA[")) {
    const end = head.indexOf("]]>");
    return head.slice(9, end === -1 ? undefined : end);
  }
  return decodeEntities(head);
}

/** The src of the first <img> in an HTML fragment. */
function imageSrc(html: string): string | null {
  const open = findOpen(html, "img", 0, html.length);
  if (open === -1) return null;
  const end = html.indexOf(">", open);
  if (end === -1 || end - open > MAX_TAG_CHARS) return null;
  const tag = html.slice(open, end + 1);
  const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
  return src ? decodeEntities(src[1] ?? src[2] ?? "") : null;
}

function parseHttps(text: string): URL | null {
  try {
    const url = new URL(text.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

/** An https://i.pinimg.com/ image, at 736px wide when the feed gave the 236px one. */
export function safeImage(text: string): string | null {
  const url = parseHttps(text);
  if (!url || url.hostname !== "i.pinimg.com") return null;
  if (url.pathname.startsWith("/236x/")) url.pathname = `/736x/${url.pathname.slice("/236x/".length)}`;
  return url.href;
}

export function safeLink(text: string): string | null {
  const url = parseHttps(text);
  if (!url || (url.hostname !== "www.pinterest.com" && url.hostname !== "pinterest.com")) return null;
  return url.href;
}

/** Pins re-checked one by one (for lists that come from anywhere but the parser, e.g. a cache). */
export function safePins(raw: unknown): Pin[] {
  if (!Array.isArray(raw)) return [];
  const out: Pin[] = [];
  for (const p of raw.slice(0, MAX_PINS)) {
    if (typeof p !== "object" || p === null) continue;
    const { img, link } = p as Record<string, unknown>;
    const safeImg = typeof img === "string" ? safeImage(img) : null;
    const safeHref = typeof link === "string" ? safeLink(link) : null;
    if (safeImg && safeHref) out.push({ img: safeImg, link: safeHref });
  }
  return out;
}

/** The board's pins, or null when `xml` is not an RSS feed at all. */
export function parseBoardFeed(xml: string): Pin[] | null {
  if (findOpen(xml, "rss", 0, xml.length) === -1 || findOpen(xml, "channel", 0, xml.length) === -1) return null;
  const pins: Pin[] = [];
  const seen = new Set<string>();
  let from = 0;
  while (pins.length < MAX_PINS) {
    const open = findOpen(xml, "item", from, xml.length);
    if (open === -1) break;
    const close = xml.indexOf("</item>", open);
    if (close === -1) break;
    from = close + "</item>".length;
    // Items do not overlap, so searching only inside each one keeps the whole parse linear.
    const item = xml.slice(open, close);
    const linkRaw = elementContent(item, "link");
    const descriptionRaw = elementContent(item, "description");
    if (linkRaw === null || descriptionRaw === null || linkRaw.length > MAX_LINK_CHARS) continue;
    const link = safeLink(elementText(linkRaw));
    const src = imageSrc(descriptionHtml(descriptionRaw));
    const img = src === null ? null : safeImage(src);
    if (!link || !img || seen.has(link)) continue;
    seen.add(link);
    pins.push({ img, link });
  }
  return pins;
}
