// GET /v1/pinterest-board?board=<user>/<board>: the pins of a PUBLIC Pinterest board, for the
// app's Vision board page. Browsers cannot read Pinterest's RSS feed themselves (no CORS), so
// the Worker reads it server-side. It needs the sync token (see index.ts), so it is not an
// open proxy, and it only ever fetches https://www.pinterest.com/<user>/<board>.rss.
//
// Only image URLs on https://i.pinimg.com/ and pin links on https://www.pinterest.com/ or
// https://pinterest.com/ are ever returned; anything else in the feed is dropped. Parsed
// boards are kept in the edge cache for 15 minutes to be kind to Pinterest.

import { HttpError, json, readCapped } from "./http";

export const BOARD_PATTERN = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,100}$/;
/** Whole upstream exchange (headers and body). */
export const PINTEREST_TIMEOUT_MS = 5000;
export const MAX_FEED_BYTES = 2 * 1024 * 1024;
export const BOARD_CACHE_MS = 15 * 60 * 1000;
/** More than the feed ever holds (about 25); a hostile feed cannot make a huge response. */
export const MAX_PINS = 200;

const USER_AGENT = "Esmeworld/1.0 (personal vision board; +https://life-hub-eoy.pages.dev)";
const CACHE_PREFIX = "https://pinterest-board.esmeworld-sync.internal/v1/";

export interface Pin {
  img: string;
  link: string;
}

export interface BoardBody {
  board: string;
  fetchedAt: number;
  pins: Pin[];
}

export interface PinterestDeps {
  now: () => number;
  upstreamFetch: typeof fetch;
  upstreamTimeoutMs: number;
  /** The edge cache; null runs without one. */
  boardCache: Cache | null;
}

export function upstreamFeedUrl(board: string): string {
  return `https://www.pinterest.com/${board}.rss`;
}

/** The one `board` query parameter, if it is a valid `<user>/<board>`. */
export function boardParam(url: URL): string {
  const values = url.searchParams.getAll("board");
  const board = values.length === 1 ? values[0]! : "";
  if (!BOARD_PATTERN.test(board)) throw new HttpError(400, "bad_board");
  return board;
}

export async function pinterestBoardResponse(url: URL, deps: PinterestDeps): Promise<Response> {
  const board = boardParam(url);
  const now = deps.now();
  const cached = await readCache(deps.boardCache, board, now);
  if (cached) return json(200, cached);

  const pins = await fetchPins(board, deps);
  const body: BoardBody = { board, fetchedAt: now, pins };
  await writeCache(deps.boardCache, board, body);
  return json(200, body);
}

// ---- upstream ----

async function fetchPins(board: string, deps: PinterestDeps): Promise<Pin[]> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, deps.upstreamTimeoutMs);
  });
  try {
    const text = await Promise.race([readFeed(board, deps.upstreamFetch, controller.signal), timeout]);
    const pins = parseBoardFeed(text);
    if (!pins) throw new Error("not_a_feed");
    return pins;
  } catch {
    // Whatever went wrong upstream, the caller only learns that Pinterest was unavailable.
    throw new HttpError(502, "pinterest_unavailable");
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

async function readFeed(board: string, upstreamFetch: typeof fetch, signal: AbortSignal): Promise<string> {
  const response = await upstreamFetch(upstreamFeedUrl(board), {
    method: "GET",
    headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/xml, text/xml" },
    redirect: "manual",
    signal,
  });
  if (response.status !== 200) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("status");
  }
  const declared = response.headers.get("Content-Length");
  if (declared !== null && Number(declared) > MAX_FEED_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("too_large");
  }
  const bytes = await readCapped(response.body, MAX_FEED_BYTES, signal);
  return new TextDecoder("utf-8").decode(bytes);
}

// ---- parsing ----

const NAMED_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]+);/g, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name] ?? whole;
  });
}

/** The text content of the first <tag> element in `xml` (CDATA kept raw, entities decoded). */
function elementText(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(xml);
  if (!match) return null;
  const inner = match[1]!.trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner);
  return cdata ? cdata[1]! : decodeEntities(inner);
}

/** The src of the first <img> in an HTML fragment. */
function imageSrc(html: string): string | null {
  const tag = /<img\b[^>]*>/i.exec(html);
  if (!tag) return null;
  const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag[0]);
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
function safeImage(text: string): string | null {
  const url = parseHttps(text);
  if (!url || url.hostname !== "i.pinimg.com") return null;
  if (url.pathname.startsWith("/236x/")) url.pathname = `/736x/${url.pathname.slice("/236x/".length)}`;
  return url.href;
}

function safeLink(text: string): string | null {
  const url = parseHttps(text);
  if (!url || (url.hostname !== "www.pinterest.com" && url.hostname !== "pinterest.com")) return null;
  return url.href;
}

/** The board's pins, or null when `xml` is not an RSS feed at all. */
export function parseBoardFeed(xml: string): Pin[] | null {
  if (!/<rss[\s>]/i.test(xml) || !/<channel[\s>]/i.test(xml)) return null;
  const pins: Pin[] = [];
  const seen = new Set<string>();
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    if (pins.length >= MAX_PINS) break;
    const item = match[1]!;
    const link = safeLink(elementText(item, "link") ?? "");
    const src = imageSrc(elementText(item, "description") ?? "");
    const img = src === null ? null : safeImage(src);
    if (!link || !img || seen.has(link)) continue;
    seen.add(link);
    pins.push({ img, link });
  }
  return pins;
}

// ---- edge cache ----

function cacheKey(board: string): string {
  return `${CACHE_PREFIX}${board}`;
}

async function readCache(cache: Cache | null, board: string, now: number): Promise<BoardBody | null> {
  if (!cache) return null;
  try {
    const hit = await cache.match(cacheKey(board));
    if (!hit) return null;
    const body = (await hit.json()) as BoardBody;
    const fresh = body.board === board && body.fetchedAt <= now && now - body.fetchedAt < BOARD_CACHE_MS;
    return fresh && Array.isArray(body.pins) ? body : null;
  } catch {
    return null; // a cache problem only costs a fetch
  }
}

async function writeCache(cache: Cache | null, board: string, body: BoardBody): Promise<void> {
  if (!cache) return;
  try {
    const response = json(200, body, { "Cache-Control": `public, max-age=${BOARD_CACHE_MS / 1000}` });
    await cache.put(cacheKey(board), response);
  } catch {
    /* not cached this time */
  }
}
