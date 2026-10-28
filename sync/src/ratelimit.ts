// Failed-authentication rate limiting, stored in D1 table `auth_failures(ip, ts)`.
// Only the client's bucket key and a timestamp are stored; never anything from the request.
//
// Buckets: an IPv4 address, an IPv6 /64, or "unknown" when Cloudflare gave no client IP.
// Normal limit: 5 failures per bucket per 15 minutes. Global cap: once 100 failures were
// recorded across all buckets in the last hour, every bucket's limit drops to 1.
// A bucket at its limit gets 429 even for the correct token (no oracle).
//
// Every wrong or missing token is recorded with ONE conditional INSERT that only succeeds
// while the bucket is under its limit, so concurrent requests cannot overshoot it.

export const IP_MAX_FAILURES = 5;
export const IP_WINDOW_MS = 15 * 60 * 1000;
export const GLOBAL_MAX_FAILURES = 100;
export const GLOBAL_WINDOW_MS = 60 * 60 * 1000;
/** Per-bucket limit while the global cap is reached. */
export const LOCKDOWN_MAX_FAILURES = 1;

export const UNKNOWN_BUCKET = "unknown";

export interface Limit {
  limited: boolean;
  /** Whole seconds until the limit lifts (>= 1) when limited. */
  retryAfter: number;
}

const NOT_LIMITED: Limit = { limited: false, retryAfter: 0 };

// ---- bucket keys ----

function parseIPv4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const value = Number(part);
    if (value > 255) return null;
    octets.push(value);
  }
  return octets;
}

/** Parses an IPv6 address (with ::, embedded IPv4, zone id) into eight 16-bit groups. */
function parseIPv6(text: string): number[] | null {
  const zone = text.indexOf("%");
  const address = zone >= 0 ? text.slice(0, zone) : text;
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const split = (side: string) => (side === "" ? [] : side.split(":"));
  const head = split(halves[0]!);
  const tail = halves.length === 2 ? split(halves[1]!) : [];
  const last = halves.length === 2 ? tail : head;
  const final = last.at(-1);
  if (final !== undefined && final.includes(".")) {
    const v4 = parseIPv4(final);
    if (!v4) return null;
    last.splice(last.length - 1, 1, ((v4[0]! << 8) | v4[1]!).toString(16), ((v4[2]! << 8) | v4[3]!).toString(16));
  }
  for (const group of [...head, ...tail]) if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
  const toNumbers = (groups: string[]) => groups.map((g) => parseInt(g, 16));
  if (halves.length === 1) return head.length === 8 ? toNumbers(head) : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...toNumbers(head), ...new Array<number>(missing).fill(0), ...toNumbers(tail)];
}

/**
 * The rate-limit bucket for a CF-Connecting-IP value: the canonical IPv4 address, the IPv6 /64
 * ("2001:db8:1:2::/64"; IPv4-mapped addresses count as IPv4), or "unknown" when absent/unparseable.
 */
export function bucketFor(value: string | null | undefined): string {
  if (typeof value !== "string") return UNKNOWN_BUCKET;
  const text = value.trim();
  if (text === "") return UNKNOWN_BUCKET;
  if (!text.includes(":")) return parseIPv4(text)?.join(".") ?? UNKNOWN_BUCKET;
  const groups = parseIPv6(text);
  if (!groups) return UNKNOWN_BUCKET;
  if (groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff) {
    const [hi, lo] = [groups[6]!, groups[7]!];
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join(".");
  }
  return `${groups.slice(0, 4).map((g) => g.toString(16)).join(":")}::/64`;
}

export function clientBucket(request: Request): string {
  return bucketFor(request.headers.get("CF-Connecting-IP"));
}

// ---- checks ----

const BUCKET_COUNT = "(SELECT count(*) FROM auth_failures WHERE ip = ?1 AND ts > ?2)";
const GLOBAL_COUNT = "(SELECT count(*) FROM auth_failures WHERE ts > ?3)";

function effectiveLimit(globalCount: number): number {
  return globalCount >= GLOBAL_MAX_FAILURES ? LOCKDOWN_MAX_FAILURES : IP_MAX_FAILURES;
}

function retryFrom(ts: number, windowMs: number, now: number): number {
  return Math.max(1, Math.ceil((ts + windowMs - now) / 1000));
}

/** Seconds until a bucket at `limit` drops below it (its limit-th most recent failure leaves the window). */
async function bucketRetry(db: D1Database, bucket: string, limit: number, now: number): Promise<number> {
  const row = await db
    .prepare("SELECT ts FROM auth_failures WHERE ip = ?1 AND ts > ?2 ORDER BY ts DESC LIMIT 1 OFFSET ?3")
    .bind(bucket, now - IP_WINDOW_MS, limit - 1)
    .first<{ ts: number }>();
  return row ? retryFrom(row.ts, IP_WINDOW_MS, now) : 1;
}

/** Seconds until fewer than GLOBAL_MAX_FAILURES failures remain in the global window. */
async function globalRetry(db: D1Database, now: number): Promise<number> {
  const row = await db
    .prepare("SELECT ts FROM auth_failures WHERE ts > ?1 ORDER BY ts DESC LIMIT 1 OFFSET ?2")
    .bind(now - GLOBAL_WINDOW_MS, GLOBAL_MAX_FAILURES - 1)
    .first<{ ts: number }>();
  return row ? retryFrom(row.ts, GLOBAL_WINDOW_MS, now) : 1;
}

/** For a request with the CORRECT token: is its bucket at its limit? */
export async function checkBucket(db: D1Database, bucket: string, now: number): Promise<Limit> {
  const row = await db
    .prepare(`SELECT ${BUCKET_COUNT} AS bucket, ${GLOBAL_COUNT} AS global`)
    .bind(bucket, now - IP_WINDOW_MS, now - GLOBAL_WINDOW_MS)
    .first<{ bucket: number; global: number }>();
  const limit = effectiveLimit(row?.global ?? 0);
  if ((row?.bucket ?? 0) < limit) return NOT_LIMITED;
  return { limited: true, retryAfter: await bucketRetry(db, bucket, limit, now) };
}

/**
 * For a request with a WRONG or MISSING token: atomically records the failure if the bucket
 * is under its (possibly lowered) limit, pruning old rows in the same batch.
 * Returns limited=true (answer 429) when the bucket was already at its limit (nothing recorded)
 * or when the global cap had already been reached; otherwise the caller answers 401.
 */
export async function recordFailure(db: D1Database, bucket: string, now: number): Promise<Limit> {
  const [, inserted, after] = await db.batch([
    db.prepare("DELETE FROM auth_failures WHERE ts <= ?1").bind(now - GLOBAL_WINDOW_MS),
    db
      .prepare(
        `INSERT INTO auth_failures (ip, ts)
         SELECT ?1, ?4
         WHERE ${BUCKET_COUNT} < CASE WHEN ${GLOBAL_COUNT} >= ?5 THEN ?6 ELSE ?7 END
         RETURNING ts`,
      )
      .bind(bucket, now - IP_WINDOW_MS, now - GLOBAL_WINDOW_MS, now, GLOBAL_MAX_FAILURES, LOCKDOWN_MAX_FAILURES, IP_MAX_FAILURES),
    db.prepare("SELECT count(*) AS global FROM auth_failures WHERE ts > ?1").bind(now - GLOBAL_WINDOW_MS),
  ]);
  const globalAfter = (after!.results[0] as { global: number } | undefined)?.global ?? 0;
  if (inserted!.results.length === 0) {
    // Not recorded: the bucket is at its limit (computed from the unchanged global count).
    return { limited: true, retryAfter: await bucketRetry(db, bucket, effectiveLimit(globalAfter), now) };
  }
  // Recorded. If the global cap was already reached before this failure, answer 429 as well.
  if (globalAfter > GLOBAL_MAX_FAILURES) return { limited: true, retryAfter: await globalRetry(db, now) };
  return NOT_LIMITED;
}
