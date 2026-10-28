// The Vision board is always a public Pinterest board (VISUAL-LANGUAGE.md "Vision board").
// Browsers cannot read Pinterest's feed themselves, so the sync server reads it for us
// (GET /v1/pinterest-board, sync API v1.2 section G) with the same token as sync.
//
// Kept on this device in syncMeta (never synced, never in backups):
//   visionBoard: the board path "<user>/<board>" (default Esme's board);
//   visionPins:  the last good pin list { board, fetchedAt, pins }, so the board shows offline and instantly.

import type { HubDB } from "../data/db";

export const DEFAULT_BOARD = "esmelrobinson/visionboardfuture";
export const BOARD_META_KEY = "visionBoard";
export const PINS_META_KEY = "visionPins";
/** Ask again on page open when the stored list is older than this. */
export const STALE_MS = 15 * 60 * 1000;
/** Give up on the sync server after this long (it gives Pinterest 5 s). */
export const FETCH_TIMEOUT_MS = 20_000;

const BOARD_PATTERN = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,100}$/;

export interface Pin {
  img: string;
  link: string;
}

export interface CachedBoard {
  board: string;
  fetchedAt: number;
  pins: Pin[];
}

export type BoardInput = { ok: true; board: string } | { ok: false; reason: "short-link" | "invalid" };

export type FetchOutcome =
  | { kind: "ok"; board: CachedBoard }
  | { kind: "not-configured" }
  | { kind: "needs-passphrase" }
  | { kind: "rate-limited" }
  | { kind: "unavailable" }
  | { kind: "offline" }
  | { kind: "failed" };

export function isBoard(text: unknown): text is string {
  return typeof text === "string" && BOARD_PATTERN.test(text);
}

/**
 * A board from what she pasted: a board address on any pinterest.* site (sections and
 * query strings ignored), or plain "user/board". Short pin.it links redirect on Pinterest's
 * side, which the app cannot follow, so they are reported separately.
 */
export function parseBoardInput(text: string): BoardInput {
  const trimmed = text.trim();
  if (/^(?:https?:\/\/)?pin\.it(?:\/|$)/i.test(trimmed)) return { ok: false, reason: "short-link" };
  let path = trimmed;
  if (/^(?:https?:\/\/)?(?:[a-z0-9-]+\.)*pinterest\.[a-z.]+(?:[/?#]|$)/i.test(trimmed)) {
    try {
      const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
      if (!/^(?:[a-z0-9-]+\.)*pinterest\.[a-z]{2,3}(?:\.[a-z]{2})?$/i.test(url.hostname)) {
        return { ok: false, reason: "invalid" };
      }
      path = url.pathname;
    } catch {
      return { ok: false, reason: "invalid" };
    }
  } else if (/[:?#]/.test(trimmed) || /^[^/]*\./.test(trimmed)) {
    return { ok: false, reason: "invalid" }; // another site, or a scheme like javascript:
  }
  const parts = path.split("/").filter((p) => p !== "");
  if (parts.length < 2 || parts[0]!.toLowerCase() === "pin") return { ok: false, reason: "invalid" };
  const board = `${parts[0]}/${parts[1]!.replace(/\.rss$/i, "")}`;
  return isBoard(board) ? { ok: true, board } : { ok: false, reason: "invalid" };
}

function httpsOn(text: unknown, hosts: string[]): string | null {
  if (typeof text !== "string") return null;
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    return hosts.includes(url.hostname) ? url.href : null;
  } catch {
    return null;
  }
}

/** Only https://i.pinimg.com/ images and pinterest.com pin links, as plain { img, link }. */
export function safePins(raw: unknown): Pin[] {
  if (!Array.isArray(raw)) return [];
  const out: Pin[] = [];
  for (const p of raw) {
    if (typeof p !== "object" || p === null) continue;
    const img = httpsOn((p as Pin).img, ["i.pinimg.com"]);
    const link = httpsOn((p as Pin).link, ["www.pinterest.com", "pinterest.com"]);
    if (img && link) out.push({ img, link });
  }
  return out;
}

/** "just now", "5 min ago", "3 hours ago", "2 days ago". */
export function describeAge(fetchedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - fetchedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "1 day ago" : `${days} days ago`;
}

export function isStale(fetchedAt: number, now: number): boolean {
  return now < fetchedAt || now - fetchedAt >= STALE_MS;
}

export async function readBoardSetting(db: HubDB): Promise<string> {
  const value = (await db.syncMeta.get(BOARD_META_KEY))?.value;
  return isBoard(value) ? value : DEFAULT_BOARD;
}

export async function saveBoardSetting(db: HubDB, board: string): Promise<void> {
  await db.syncMeta.put({ key: BOARD_META_KEY, value: board });
}

export async function readCachedBoard(db: HubDB): Promise<CachedBoard | null> {
  const value = (await db.syncMeta.get(PINS_META_KEY))?.value as Partial<CachedBoard> | undefined;
  if (typeof value !== "object" || value === null) return null;
  if (!isBoard(value.board) || typeof value.fetchedAt !== "number" || !Array.isArray(value.pins)) return null;
  return { board: value.board, fetchedAt: value.fetchedAt, pins: safePins(value.pins) };
}

/** True when this device has a sync address and token (the board comes through the sync server). */
export async function syncConfigured(db: HubDB): Promise<boolean> {
  const [url, token] = await Promise.all([db.syncMeta.get("serverUrl"), db.syncMeta.get("token")]);
  return typeof url?.value === "string" && url.value !== "" && typeof token?.value === "string" && token.value !== "";
}

/**
 * Asks the sync server for the board's pins and, when that works, stores them as the
 * board to show. Never throws; never changes the sync settings (a refused token is
 * handled by the next sync run).
 */
export async function fetchBoard(env: { db: HubDB; fetch: typeof fetch }, board: string): Promise<FetchOutcome> {
  if (!isBoard(board)) return { kind: "failed" };
  const [url, token] = await Promise.all([env.db.syncMeta.get("serverUrl"), env.db.syncMeta.get("token")]);
  if (typeof url?.value !== "string" || !url.value || typeof token?.value !== "string" || !token.value) {
    return { kind: "not-configured" };
  }
  const address = `${url.value.replace(/\/+$/, "")}/v1/pinterest-board?board=${encodeURIComponent(board)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let response: Response;
  let body: unknown;
  try {
    response = await env.fetch(address, {
      method: "GET",
      headers: { Authorization: `Bearer ${token.value}` },
      signal: controller.signal,
    });
    if (response.status !== 200) {
      if (response.status === 401) return { kind: "needs-passphrase" };
      if (response.status === 429) return { kind: "rate-limited" };
      if (response.status === 502) return { kind: "unavailable" };
      return { kind: "failed" };
    }
    try {
      body = await response.json();
    } catch {
      return { kind: "failed" };
    }
  } catch {
    return { kind: "offline" };
  } finally {
    clearTimeout(timer);
  }
  const b = body as Partial<CachedBoard> | null;
  if (typeof b !== "object" || b === null || b.board !== board || typeof b.fetchedAt !== "number") return { kind: "failed" };
  const result: CachedBoard = { board, fetchedAt: b.fetchedAt, pins: safePins(b.pins) };
  try {
    await env.db.syncMeta.put({ key: PINS_META_KEY, value: result });
  } catch {
    /* shown now; just not kept for next time */
  }
  return { kind: "ok", board: result };
}
