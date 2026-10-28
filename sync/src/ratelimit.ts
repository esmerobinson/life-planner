// Failed-authentication rate limiting, stored in D1 table `auth_failures(ip, ts)`.
// Only the client IP and a timestamp are stored; never anything from the request.

export const IP_MAX_FAILURES = 5;
export const IP_WINDOW_MS = 15 * 60 * 1000;
export const GLOBAL_MAX_FAILURES = 100;
export const GLOBAL_WINDOW_MS = 60 * 60 * 1000;

export interface Limit {
  limited: boolean;
  /** Whole seconds until the limit lifts (>= 1) when limited. */
  retryAfter: number;
}

const NOT_LIMITED: Limit = { limited: false, retryAfter: 0 };

/** The rate-limit bucket for a request: Cloudflare's client IP, or one shared bucket if absent. */
export function clientIp(request: Request): string {
  const ip = request.headers.get("CF-Connecting-IP")?.trim();
  return ip ? ip.slice(0, 64) : "unknown";
}

/**
 * Checks a window: limited when at least `max` failures have `ts > now - windowMs`.
 * It lifts when the `max`-th most recent failure leaves the window.
 */
async function checkWindow(stmt: D1PreparedStatement, windowMs: number, now: number): Promise<Limit> {
  const row = await stmt.first<{ ts: number }>();
  if (!row) return NOT_LIMITED;
  const liftsAt = row.ts + windowMs;
  return { limited: true, retryAfter: Math.max(1, Math.ceil((liftsAt - now) / 1000)) };
}

export function checkIpLimit(db: D1Database, ip: string, now: number): Promise<Limit> {
  const since = now - IP_WINDOW_MS;
  const stmt = db
    .prepare("SELECT ts FROM auth_failures WHERE ip = ?1 AND ts > ?2 ORDER BY ts DESC LIMIT 1 OFFSET ?3")
    .bind(ip, since, IP_MAX_FAILURES - 1);
  return checkWindow(stmt, IP_WINDOW_MS, now);
}

export function checkGlobalLimit(db: D1Database, now: number): Promise<Limit> {
  const since = now - GLOBAL_WINDOW_MS;
  const stmt = db
    .prepare("SELECT ts FROM auth_failures WHERE ts > ?1 ORDER BY ts DESC LIMIT 1 OFFSET ?2")
    .bind(since, GLOBAL_MAX_FAILURES - 1);
  return checkWindow(stmt, GLOBAL_WINDOW_MS, now);
}

/** Records one failure and prunes rows older than the longest window. */
export async function recordFailure(db: D1Database, ip: string, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM auth_failures WHERE ts <= ?1").bind(now - GLOBAL_WINDOW_MS),
    db.prepare("INSERT INTO auth_failures (ip, ts) VALUES (?1, ?2)").bind(ip, now),
  ]);
}
