// Plain REST calls to Together's Supabase (Together link brief §1, §2; challenge brief): password
// sign-in, refresh, her challenge's days (`challenge_days`), its one rename, and marking an
// earlier build's `todos` / `todo_events` deleted. Nothing is ever read back except the sign-in
// itself, her couple id and which challenge is hers. No secret is ever logged or put in an error
// message.

import type { TogetherAuth } from "./store";

export type Fetch = typeof fetch;

/** How a call ended, for the sender to decide what happens next. */
export type CallResult =
  | { kind: "ok"; body: unknown }
  /** 401: the login is no longer accepted. Stop and ask her to sign in again. */
  | { kind: "auth" }
  /** Offline, 5xx, 408 or 429: tried again on the next run. */
  | { kind: "transient" }
  /** Any other refusal of this one row (set aside, the rest goes on). */
  | { kind: "refused"; status: number; code: string };

/** Trimmed, without trailing slashes. */
export function normaliseTogetherUrl(text: string): string {
  return text.trim().replace(/\/+$/, "");
}

/** Only https addresses (the anon key and tokens never go over plain http). */
export function validTogetherUrl(text: string): boolean {
  try {
    const u = new URL(normaliseTogetherUrl(text));
    return u.protocol === "https:" && u.username === "" && u.password === "" && u.search === "" && u.hash === "";
  } catch {
    return false;
  }
}

/**
 * The longest any one request to Together may take (bug #44): after this it is given up on (like
 * being offline), so a hung request never holds the Together lock or stops copying for good.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

async function call(fetchFn: Fetch, url: string, init: RequestInit): Promise<CallResult> {
  // Its own time limit, joined with any abort the caller passed in (Stop, Sign in).
  const ctrl = new AbortController();
  const outer = init.signal;
  const abort = () => ctrl.abort();
  if (outer?.aborted) ctrl.abort();
  else outer?.addEventListener("abort", abort);
  const timer = setTimeout(abort, REQUEST_TIMEOUT_MS);
  let res: Response;
  let text: string;
  try {
    res = await fetchFn(url, { ...init, signal: ctrl.signal });
    text = await res.text();
  } catch {
    return { kind: "transient" };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", abort);
  }
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (res.ok) return { kind: "ok", body };
  if (res.status === 401) return { kind: "auth" };
  if (res.status >= 500 || res.status === 408 || res.status === 429) return { kind: "transient" };
  const code = body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string" ? (body as { code: string }).code : "";
  return { kind: "refused", status: res.status, code };
}

export interface Session {
  userId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

function session(body: unknown, now: number): Session | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const user = b.user as { id?: unknown } | undefined;
  if (typeof b.access_token !== "string" || typeof b.refresh_token !== "string" || typeof user?.id !== "string") return null;
  const expiresAt =
    typeof b.expires_at === "number" ? b.expires_at * 1000 : typeof b.expires_in === "number" ? now + b.expires_in * 1000 : now + 3_600_000;
  return { userId: user.id, accessToken: b.access_token, refreshToken: b.refresh_token, expiresAt };
}

export type TokenResult = { kind: "ok"; session: Session } | { kind: "refused" } | { kind: "transient" };

async function token(fetchFn: Fetch, url: string, anonKey: string, grant: string, body: unknown, now: number): Promise<TokenResult> {
  const r = await call(fetchFn, `${url}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (r.kind === "transient") return r;
  if (r.kind !== "ok") return { kind: "refused" };
  const s = session(r.body, now);
  return s ? { kind: "ok", session: s } : { kind: "refused" };
}

export function signInWithPassword(fetchFn: Fetch, url: string, anonKey: string, email: string, password: string, now: number) {
  return token(fetchFn, url, anonKey, "password", { email, password }, now);
}

export function refreshSession(fetchFn: Fetch, url: string, anonKey: string, refreshToken: string, now: number) {
  return token(fetchFn, url, anonKey, "refresh_token", { refresh_token: refreshToken }, now);
}

type Live = Required<Pick<TogetherAuth, "url" | "anonKey" | "accessToken">>;

export function rest(
  fetchFn: Fetch, auth: Live, method: "GET" | "POST" | "PATCH", path: string, body?: unknown, prefer = "return=minimal",
): Promise<CallResult> {
  return call(fetchFn, `${auth.url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: auth.anonKey,
      Authorization: `Bearer ${auth.accessToken}`,
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Her couple id, from `members` (read once, at sign-in). */
export async function coupleOf(fetchFn: Fetch, auth: Live, userId: string): Promise<CallResult & { coupleId?: string }> {
  const r = await rest(fetchFn, auth, "GET", `members?user_id=eq.${encodeURIComponent(userId)}&select=couple_id`, undefined, "");
  if (r.kind !== "ok") return r;
  const row = Array.isArray(r.body) ? (r.body[0] as { couple_id?: unknown } | undefined) : undefined;
  return typeof row?.couple_id === "string" ? { ...r, coupleId: row.couple_id } : { kind: "refused", status: 200, code: "no-couple" };
}
