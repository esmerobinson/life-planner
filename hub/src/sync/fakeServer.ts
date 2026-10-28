// TEST-ONLY in-memory stand-in for the Esmeworld sync server (Cloudflare Worker + D1),
// implementing the v1.1 contract (docs/superpowers/specs/2026-10-28-sync-api.md plus the
// v1.1 amendments) so the client can be tested without a network. Plug its `fetch` into
// the sync engine. Never imported by app code.
//
// Faithful to the contract:
// - Auth: `Authorization: Bearer <token>` must match exactly, else 401 {"error":"unauthorized"}.
// - Validation: deviceId [A-Za-z0-9_-]{8,64}; cursor a safe integer >= 0; at most 2000
//   changes; table items|goals|files; id 1-128 chars; updatedAt a positive safe integer at most
//   24 h ahead of the server clock; data a plain object. Any invalid change rejects the whole
//   request with 400 and applies nothing. Body over 5 MB: 413.
// - Cursor ahead of the server's highest seq: 409 {"error":"cursor_ahead"}.
// - Last write wins per (table, id): replace when updatedAt is greater, or equal with a
//   lexicographically greater deviceId. Every write gets the next seq.
// - Pull: rows with seq > cursor in seq order, at most `pageSize` rows / `maxResponseBytes`
//   of data (at least one row), EXCLUDING a row only when it belongs to the caller's
//   deviceId and this request carries exactly that table/id/updatedAt. Then RETURNED
//   WINNERS: for every (table, id) in the request whose stored row is not exactly a version
//   this request sent (same deviceId, updatedAt AND data), the stored row is appended (once
//   per row, never duplicated).
// - Response cursor: highest seq among paged rows when hasMore; otherwise the server's
//   highest seq (or the request cursor when that is higher, which 409 rules out). Returned
//   winners never move it.
//
// Stricter than the real server, to catch client bugs: with `strictClient` (default on),
// a change whose data.id / data.updatedAt do not match its id / updatedAt is a 400.
//
// Tests can queue forced responses with `inject` (e.g. 401, 429 with Retry-After, 409, 400,
// 500, or a thrown network error) and read every request from `requests`.

export interface FakeRow {
  table: string;
  id: string;
  updatedAt: number;
  deviceId: string;
  seq: number;
  data: string;
}

export type Injection =
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | { networkError: true };

export interface FakeRequestLog {
  method: string;
  path: string;
  authorization: string | null;
  body?: { deviceId: string; cursor: number; changes: { table: string; id: string; updatedAt: number; data: Record<string, unknown> }[] };
  bodyBytes: number;
  status?: number;
  response?: unknown;
}

const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const TABLES = new Set(["items", "goals", "files"]);
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_CHANGES = 2000;
const MAX_FUTURE_MS = 24 * 60 * 60 * 1000;
const MAX_ID_LENGTH = 128;
const MAX_ROW_BYTES = 1_000_000;

const key = (table: string, id: string) => `${table}\u0000${id}`;
const utf8 = (s: string) => new TextEncoder().encode(s).length;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export class FakeSyncServer {
  readonly rows = new Map<string, FakeRow>();
  seq = 0;
  readonly requests: FakeRequestLog[] = [];
  private readonly injections: Injection[] = [];

  constructor(
    readonly token: string,
    readonly options: {
      pageSize?: number;
      maxResponseBytes?: number;
      now?: () => number;
      strictClient?: boolean;
      /** Extra tables a LATER server accepts (to test clients against tables they don't know yet). */
      extraTables?: string[];
      /** Test hook: refuse a change (whole request, 400) with this code, e.g. a row the real server finds too large. */
      reject?: (change: { table: string; id: string; updatedAt: number; data: Record<string, unknown> }) => string | undefined;
    } = {},
  ) {}

  /** Queue forced responses; each is used by exactly one following request. */
  inject(...injections: Injection[]): void {
    this.injections.push(...injections);
  }

  /** The stored row's data, parsed. */
  data(table: string, id: string): Record<string, unknown> | undefined {
    const row = this.rows.get(key(table, id));
    return row ? (JSON.parse(row.data) as Record<string, unknown>) : undefined;
  }

  get syncRequests(): FakeRequestLog[] {
    return this.requests.filter((r) => r.path === "/v1/sync");
  }

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const text = typeof init.body === "string" ? init.body : "";
    const log: FakeRequestLog = {
      method,
      path: url.pathname,
      authorization: headers.get("Authorization"),
      bodyBytes: utf8(text),
    };
    try {
      log.body = text ? JSON.parse(text) : undefined;
    } catch {
      /* logged without a body */
    }
    this.requests.push(log);

    const forced = this.injections.shift();
    if (forced) {
      if ("networkError" in forced) throw new TypeError("Failed to fetch");
      log.status = forced.status;
      return respond(forced.status, forced.body ?? {}, forced.headers);
    }

    const { status, body } = this.handle(method, url.pathname, log.authorization, text);
    log.status = status;
    log.response = body;
    return respond(status, body);
  };

  private now(): number {
    return this.options.now ? this.options.now() : Date.now();
  }

  private handle(method: string, path: string, auth: string | null, text: string): { status: number; body: unknown } {
    if (path === "/v1/health" && method === "GET") return { status: 200, body: { ok: true, version: 1 } };
    if (path !== "/v1/sync" && path !== "/v1/export") return { status: 404, body: { error: "not_found" } };
    if (auth !== `Bearer ${this.token}`) return { status: 401, body: { error: "unauthorized" } };
    if (path === "/v1/export") {
      if (method !== "GET") return { status: 405, body: { error: "method_not_allowed" } };
      const all = [...this.rows.values()];
      return {
        status: 200,
        body: {
          exportedAt: this.now(),
          items: all.filter((r) => r.table === "items").map((r) => JSON.parse(r.data)),
          goals: all.filter((r) => r.table === "goals").map((r) => JSON.parse(r.data)),
        },
      };
    }
    if (method !== "POST") return { status: 405, body: { error: "method_not_allowed" } };
    if (utf8(text) > MAX_BODY_BYTES) return { status: 413, body: { error: "payload_too_large" } };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { status: 400, body: { error: "bad_json" } };
    }
    return this.sync(parsed);
  }

  private sync(body: unknown): { status: number; body: unknown } {
    const bad = (error: string) => ({ status: 400, body: { error } });
    if (!isObj(body)) return bad("bad_request");
    const { deviceId, cursor, changes } = body;
    if (typeof deviceId !== "string" || !DEVICE_ID.test(deviceId)) return bad("bad_device_id");
    if (typeof cursor !== "number" || !Number.isSafeInteger(cursor) || cursor < 0) return bad("bad_cursor");
    if (!Array.isArray(changes)) return bad("bad_changes");
    if (changes.length > MAX_CHANGES) return bad("too_many_changes");
    const latest = this.now() + MAX_FUTURE_MS;
    const strict = this.options.strictClient ?? true;
    for (const c of changes as unknown[]) {
      if (!isObj(c)) return bad("bad_change");
      const { table, id, updatedAt, data } = c;
      if (typeof table !== "string" || !(TABLES.has(table) || this.options.extraTables?.includes(table))) {
        return bad("bad_change");
      }
      if (typeof id !== "string" || id.length === 0 || id.length > MAX_ID_LENGTH) return bad("bad_change");
      if (typeof updatedAt !== "number" || !Number.isSafeInteger(updatedAt) || updatedAt <= 0 || updatedAt > latest) {
        return bad("bad_change");
      }
      if (!isObj(data)) return bad("bad_change");
      if (strict && (data.id !== id || data.updatedAt !== updatedAt)) return bad("bad_change");
      // The real server's row limit, measured its way (data JSON encoded twice).
      if (utf8(JSON.stringify({ t: table, i: id, u: updatedAt, d: JSON.stringify(data) })) > MAX_ROW_BYTES) {
        return bad("row_too_large");
      }
      const refused = this.options.reject?.({ table, id, updatedAt, data });
      if (refused) return bad(refused);
    }
    if (cursor > this.seq) return { status: 409, body: { error: "cursor_ahead" } };

    const valid = changes as { table: string; id: string; updatedAt: number; data: Record<string, unknown> }[];
    let applied = 0;
    for (const c of valid) {
      const k = key(c.table, c.id);
      const existing = this.rows.get(k);
      const wins =
        !existing ||
        c.updatedAt > existing.updatedAt ||
        (c.updatedAt === existing.updatedAt && deviceId > existing.deviceId);
      if (!wins) continue;
      this.rows.set(k, {
        table: c.table, id: c.id, updatedAt: c.updatedAt, deviceId, seq: ++this.seq, data: JSON.stringify(c.data),
      });
      applied++;
    }

    const sent = new Set(valid.map((c) => `${key(c.table, c.id)}\u0000${c.updatedAt}`));
    const isOwnSentVersion = (r: FakeRow) => r.deviceId === deviceId && sent.has(`${key(r.table, r.id)}\u0000${r.updatedAt}`);

    const candidates = [...this.rows.values()]
      .filter((r) => r.seq > cursor && !isOwnSentVersion(r))
      .sort((a, b) => a.seq - b.seq);
    const pageSize = this.options.pageSize ?? 500;
    const maxBytes = this.options.maxResponseBytes ?? 1024 * 1024;
    const paged: FakeRow[] = [];
    let bytes = 0;
    for (const r of candidates) {
      if (paged.length === pageSize) break;
      const size = utf8(r.data);
      if (paged.length > 0 && bytes + size > maxBytes) break;
      paged.push(r);
      bytes += size;
    }
    const hasMore = candidates.length > paged.length;
    const nextCursor = hasMore ? paged.at(-1)!.seq : Math.max(cursor, this.seq);

    // Returned winners: "exactly a version this request sent" means same deviceId,
    // updatedAt AND data (v1.1 C.5), so a reused timestamp with different data comes back.
    const sentExact = new Set(valid.map((c) => `${key(c.table, c.id)}\u0000${c.updatedAt}\u0000${JSON.stringify(c.data)}`));
    const isExactSent = (r: FakeRow) =>
      r.deviceId === deviceId && sentExact.has(`${key(r.table, r.id)}\u0000${r.updatedAt}\u0000${r.data}`);
    const out = paged.map(wire);
    const included = new Set(paged.map((r) => key(r.table, r.id)));
    for (const c of valid) {
      const k = key(c.table, c.id);
      if (included.has(k)) continue;
      const stored = this.rows.get(k);
      if (!stored || isExactSent(stored)) continue;
      included.add(k);
      out.push(wire(stored));
    }

    return {
      status: 200,
      body: { cursor: nextCursor, applied, ignored: valid.length - applied, hasMore, changes: out },
    };
  }
}

function wire(r: FakeRow) {
  return { table: r.table, id: r.id, updatedAt: r.updatedAt, data: JSON.parse(r.data) as Record<string, unknown> };
}

function respond(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
