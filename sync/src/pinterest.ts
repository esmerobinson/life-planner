// GET /v1/pinterest-board?board=<user>/<board>: the pins of a PUBLIC Pinterest board, for the
// app's Vision board page. Browsers cannot read Pinterest's RSS feed themselves (no CORS), so
// the Worker reads it server-side. It needs the sync token (see index.ts), so it is not an
// open proxy, and it only ever fetches https://www.pinterest.com/<user>/<board>.rss.
//
// Only image URLs on https://i.pinimg.com/ and pin links on https://www.pinterest.com/ or
// https://pinterest.com/ are ever returned; anything else in the feed is dropped. Parsed
// boards are kept in the edge cache for 15 minutes to be kind to Pinterest.

import { parseBoardFeed, safePins, type Pin } from "../shared/pinterestFeed";
import { HttpError, json, readCapped } from "./http";

export { parseBoardFeed, MAX_PINS } from "../shared/pinterestFeed";

export const BOARD_PATTERN = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,100}$/;
/** Whole upstream exchange (headers and body). */
export const PINTEREST_TIMEOUT_MS = 5000;
/** The real feed is about 18 KB; this leaves plenty of room and bounds parsing work. */
export const MAX_FEED_BYTES = 256 * 1024;
export const BOARD_CACHE_MS = 15 * 60 * 1000;

const USER_AGENT = "Esmeworld/1.0 (personal vision board; +https://life-hub-eoy.pages.dev)";
const CACHE_PREFIX = "https://pinterest-board.esmeworld-sync.internal/v1/";

export type { Pin };

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
    const fresh =
      body.board === board && typeof body.fetchedAt === "number" && body.fetchedAt <= now && now - body.fetchedAt < BOARD_CACHE_MS;
    // Re-checked on the way out: the default cache is shared by every Worker on the zone.
    return fresh && Array.isArray(body.pins) ? { board, fetchedAt: body.fetchedAt, pins: safePins(body.pins) } : null;
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
