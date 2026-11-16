// TEST-ONLY stand-in for a Supabase backend shaped like Together, holding only what the
// Together link uses: password and refresh-token sign-in, a couple's `members`, `challenges` and
// their `challenge_days`, and (only to clean up what an earlier build made) habit `todos` and
// their `todo_events`. Plug its `fetch` into the sender. Never imported by app code.
// Every value here is made up, and every message is our own wording.
//
// The rules it holds the sender to (Together's migrations and RLS as the challenge brief lists
// them, refused with standard Postgres or PostgREST error codes):
// - Every request carries the anon key as `apikey`; every /rest call a live access token.
//   A refresh token works once. Rows of another couple are never seen or touched.
// - challenges: read by her couple. Either member may rename one (`name`); its id, start and
//   couple never change.
// - challenge_days: inserted in her couple, for a challenge of her couple, with every required
//   column and a non-blank note; `by` is her (the server's default). One row per challenge and
//   day (`unique (challenge_id, day)`), and an id once: both a conflict (409, 23505). Afterwards
//   either member may change only `note` (never blank) and `deleted_at`.
// - todos / todo_events: nothing is ever inserted (the link makes no to-dos); only `deleted_at`
//   may be set, on her own rows. A to-do may be deleted again; an event deleted once stays
//   deleted ("an undone event stays undone", P0001).
// - Stricter than needed, to catch client bugs: the client never sends `created_at`,
//   `updated_at` or `by` (the server sets them), and any column the link doesn't use is refused.
//
// Tests can queue forced responses with `inject` and read every request from `requests`.

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  status?: number;
}

export type Injection =
  | { status: number; body?: unknown; when?: (r: RecordedRequest) => boolean }
  | { networkError: true; when?: (r: RecordedRequest) => boolean }
  /** The server does the request, but the reply never arrives. */
  | { lostReply: true; when?: (r: RecordedRequest) => boolean };

type Row = Record<string, unknown>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The only columns the link writes. */
const DAY_INSERT = ["id", "couple_id", "challenge_id", "day", "note"];
const DAY_UPDATE = ["note", "deleted_at"];
const CHALLENGE_UPDATE = ["name"];
const CHALLENGE_FIXED = ["id", "start", "couple_id"];
const STAMPS = ["created_at", "updated_at", "by"];

class Refusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export class FakeSupabase {
  readonly url = "https://together.example.test";
  readonly anonKey = "fake-anon-key-for-tests-only";
  readonly requests: RecordedRequest[] = [];
  /** By id. */
  readonly challenges = new Map<string, Row>();
  /** challenge_days, by id. */
  readonly days = new Map<string, Row>();
  /** Only what an earlier build made (seeded by tests with `seedLegacy`). */
  readonly todos = new Map<string, Row>();
  readonly events = new Map<string, Row>();
  accessLifetimeMs = 3_600_000;
  now: () => number = () => Date.now();

  private readonly users = new Map<string, { id: string; password: string }>();
  private readonly members: { user_id: string; couple_id: string }[] = [];
  private readonly access = new Map<string, { userId: string; exp: number }>();
  private readonly refresh = new Map<string, { userId: string; used: boolean }>();
  private readonly injections: Injection[] = [];
  private n = 0;

  /** A made-up user, in a made-up couple (or none). */
  addUser(email: string, password: string, id: string, coupleId: string | null): void {
    this.users.set(email, { id, password });
    if (coupleId) this.members.push({ user_id: id, couple_id: coupleId });
  }

  /** A made-up challenge. */
  addChallenge(c: { id: string; couple_id: string; name: string; for_user?: string | null }): void {
    this.challenges.set(c.id, { for_user: null, start: "2026-10-01", goal_days: 10, goal_window_days: 62, deleted_at: null, ...c });
  }

  /** A day logged by hand in Together (by `by`, with an id of Together's own). */
  logByHand(c: { couple_id: string; challenge_id: string; day: string; note: string; by: string }): Row {
    const id = `00000000-0000-4000-8000-${String(++this.n).padStart(12, "0")}`;
    const stamp = new Date(this.now()).toISOString();
    const row: Row = { id, deleted_at: null, ...c, created_at: stamp, updated_at: stamp };
    this.days.set(id, row);
    return row;
  }

  /** A habit (and its tallies) as an earlier build of the link left them. */
  seedLegacy(todo: Row, events: Row[] = []): void {
    const stamp = new Date(this.now()).toISOString();
    this.todos.set(String(todo.id), { tally: 0, deleted_at: null, type: "habit", ...todo, created_at: stamp, updated_at: stamp });
    for (const e of events) this.events.set(String(e.id), { kind: "tally", note: null, deleted_at: null, ...e, todo_id: todo.id, updated_at: stamp });
  }

  inject(i: Injection): void {
    this.injections.push(i);
  }

  /** Every access token stops working now. */
  expireAccessTokens(): void {
    for (const t of this.access.values()) t.exp = 0;
  }

  /** Every refresh token is refused from now on. */
  revokeRefreshTokens(): void {
    for (const t of this.refresh.values()) t.used = true;
  }

  /** A challenge's rows (deleted ones too), by day. */
  dayRows(challengeId: string): Row[] {
    return [...this.days.values()].filter((d) => d.challenge_id === challengeId).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  }

  /** A challenge's rows that aren't deleted. */
  liveDays(challengeId: string): Row[] {
    return this.dayRows(challengeId).filter((d) => !d.deleted_at);
  }

  /** The row for one day of a challenge (deleted or not). */
  dayRow(challengeId: string, day: string): Row | undefined {
    return this.dayRows(challengeId).find((d) => d.day === day);
  }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (headers[k.toLowerCase()] = v));
    const body = typeof init.body === "string" ? init.body : "";
    const rec: RecordedRequest = { method: (init.method ?? "GET").toUpperCase(), url, headers, body };
    this.requests.push(rec);
    const i = this.injections.findIndex((x) => !x.when || x.when(rec));
    const inj = i >= 0 ? this.injections.splice(i, 1)[0]! : null;
    if (inj && "networkError" in inj) throw new TypeError("Failed to fetch");
    if (inj && "status" in inj) {
      rec.status = inj.status;
      return json(inj.status, inj.body ?? {});
    }
    let res: Response;
    try {
      res = this.handle(rec);
    } catch (e) {
      if (!(e instanceof Refusal)) throw e;
      res = json(e.status, { code: e.code, message: e.message });
    }
    rec.status = res.status;
    if (inj && "lostReply" in inj) throw new TypeError("Failed to fetch");
    return res;
  };

  private handle(r: RecordedRequest): Response {
    const u = new URL(r.url);
    if (u.origin !== this.url) throw new TypeError("Failed to fetch");
    if (r.headers["apikey"] !== this.anonKey) return json(401, { message: "fake: no or wrong anon key" });
    if (u.pathname === "/auth/v1/token" && r.method === "POST") return this.token(u.searchParams.get("grant_type"), parse(r.body));
    if (!u.pathname.startsWith("/rest/v1/")) return json(404, { message: "fake: no such endpoint" });
    const session = this.access.get((r.headers["authorization"] ?? "").replace(/^Bearer /, ""));
    if (!session || session.exp <= this.now()) return json(401, { message: "fake: access token not accepted" });
    const me = session.userId;
    const couple = this.members.find((m) => m.user_id === me)?.couple_id ?? null;
    const table = u.pathname.slice("/rest/v1/".length);
    const rep = (r.headers["prefer"] ?? "").includes("return=representation");
    if (table === "members" && r.method === "GET") {
      const want = eq(u, "user_id");
      return json(200, this.members.filter((m) => m.couple_id === couple && (want === null || m.user_id === want)).map((m) => pick(m, u)));
    }
    if (table === "challenges" && r.method === "GET") {
      const rows = [...this.challenges.values()].filter((c) => c.couple_id === couple && matches(c, u, ["couple_id", "id"]));
      return json(200, rows.map((c) => pick(c, u)));
    }
    if (table === "challenges" && r.method === "PATCH") return this.patchChallenge(u, parse(r.body), couple, rep);
    if (table === "challenge_days" && r.method === "POST") return this.insertDay(parse(r.body), me, couple, rep);
    if (table === "challenge_days" && r.method === "PATCH") return this.patchDay(u, parse(r.body), couple, rep);
    if ((table === "todos" || table === "todo_events") && r.method === "POST") throw new Refusal(403, "42501", "fake: the link never makes to-dos");
    if (table === "todos" && r.method === "PATCH") return this.deleteLegacy(this.todos, u, parse(r.body), me, couple, rep, false);
    if (table === "todo_events" && r.method === "PATCH") return this.deleteLegacy(this.events, u, parse(r.body), me, couple, rep, true);
    return json(404, { message: "fake: no such endpoint" });
  }

  private token(grant: string | null, body: Row): Response {
    let userId: string;
    if (grant === "password") {
      const user = this.users.get(String(body.email ?? ""));
      if (!user || user.password !== body.password) return json(400, { error: "invalid_grant", error_description: "fake: wrong email or password" });
      userId = user.id;
    } else if (grant === "refresh_token") {
      const t = this.refresh.get(String(body.refresh_token ?? ""));
      if (!t || t.used) return json(400, { error: "invalid_grant", error_description: "fake: refresh token already used" });
      t.used = true;
      userId = t.userId;
    } else {
      return json(400, { error: "fake: unknown grant" });
    }
    const access = `fake-access-${++this.n}`;
    const refresh = `fake-refresh-${this.n}`;
    const exp = this.now() + this.accessLifetimeMs;
    this.access.set(access, { userId, exp });
    this.refresh.set(refresh, { userId, used: false });
    return json(200, { access_token: access, expires_in: this.accessLifetimeMs / 1000, expires_at: Math.floor(exp / 1000), refresh_token: refresh, user: { id: userId } });
  }

  private patchChallenge(u: URL, body: Row, couple: string | null, rep: boolean): Response {
    if (eq(u, "id") === null) throw new Refusal(400, "FAKE_FILTER", "fake: the link only ever renames one challenge, by id");
    for (const k of Object.keys(body)) {
      if (CHALLENGE_FIXED.includes(k)) throw new Refusal(400, "P0001", `fake: a challenge's ${k} never changes`);
    }
    columns(body, CHALLENGE_UPDATE);
    if (typeof body.name !== "string" || body.name.trim() === "") throw new Refusal(400, "23514", "fake: a challenge needs a name");
    const rows = [...this.challenges.values()].filter((c) => c.couple_id === couple && matches(c, u, ["couple_id", "id"]));
    const out = rows.map((c) => {
      const row = { ...c, name: body.name, updated_at: new Date(this.now()).toISOString() };
      this.challenges.set(String(c.id), row);
      return row;
    });
    return rep ? json(200, out) : new Response(null, { status: 204 });
  }

  private insertDay(body: Row, me: string, couple: string | null, rep: boolean): Response {
    columns(body, DAY_INSERT);
    for (const k of DAY_INSERT) if (body[k] === undefined || body[k] === null) throw new Refusal(400, "23502", `fake: ${k} is required`);
    if (typeof body.id !== "string" || body.id === "") throw new Refusal(400, "22P02", "fake: id must be text");
    if (body.couple_id !== couple) throw new Refusal(403, "42501", "fake: not her couple");
    if (typeof body.day !== "string" || !DATE.test(body.day)) throw new Refusal(400, "22007", "fake: day isn't a date");
    if (typeof body.note !== "string" || body.note.trim() === "") throw new Refusal(400, "23514", "fake: a note can't be blank");
    const ch = this.challenges.get(String(body.challenge_id));
    if (!ch || ch.couple_id !== couple) throw new Refusal(409, "23503", "fake: no such challenge");
    if (this.days.has(body.id)) throw new Refusal(409, "23505", "fake: that id is taken");
    if (this.dayRow(String(body.challenge_id), body.day)) throw new Refusal(409, "23505", "fake: that day is already logged");
    const stamp = new Date(this.now()).toISOString();
    const row: Row = { deleted_at: null, ...body, by: me, created_at: stamp, updated_at: stamp };
    this.days.set(body.id, row);
    return rep ? json(201, [row]) : new Response(null, { status: 201 });
  }

  private patchDay(u: URL, body: Row, couple: string | null, rep: boolean): Response {
    for (const k of Object.keys(body)) {
      if (!DAY_UPDATE.includes(k)) throw new Refusal(403, "42501", `fake: only note and deleted_at change (not ${k})`);
    }
    if (eq(u, "id") === null) throw new Refusal(400, "FAKE_FILTER", "fake: the link only ever changes one row, by id");
    if ("note" in body && (typeof body.note !== "string" || body.note.trim() === "")) throw new Refusal(400, "23514", "fake: a note can't be blank");
    const rows = [...this.days.values()].filter((d) => d.couple_id === couple && matches(d, u, ["couple_id", "id"]));
    const out = rows.map((d) => {
      const row = { ...d, ...body, updated_at: new Date(this.now()).toISOString() };
      this.days.set(String(d.id), row);
      return row;
    });
    return rep ? json(200, out) : new Response(null, { status: 204 });
  }

  /** An earlier build's to-do or event: only ever marked deleted, by her. */
  private deleteLegacy(table: Map<string, Row>, u: URL, body: Row, me: string, couple: string | null, rep: boolean, event: boolean): Response {
    if (Object.keys(body).some((k) => k !== "deleted_at") || !body.deleted_at) throw new Refusal(403, "42501", "fake: the link only marks old to-dos deleted");
    const id = eq(u, "id");
    const old = id === null ? undefined : table.get(id);
    const mine = old && old.couple_id === couple && (event ? old.user_id === me : old.owner_id === me);
    if (!old || !mine) return rep ? json(200, []) : new Response(null, { status: 204 });
    if (event && old.deleted_at) throw new Refusal(400, "P0001", "fake: an undone event stays undone");
    const row = { ...old, deleted_at: body.deleted_at, updated_at: new Date(this.now()).toISOString() };
    table.set(id!, row);
    return rep ? json(200, [row]) : new Response(null, { status: 204 });
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function parse(text: string): Row {
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Row;
  } catch {
    /* refused below */
  }
  throw new Refusal(400, "PGRST102", "fake: body isn't one JSON object");
}

function columns(body: Row, known: string[]): void {
  for (const k of Object.keys(body)) {
    if (STAMPS.includes(k)) throw new Refusal(400, "FAKE_STAMP", `fake: the server sets ${k}, the client never sends it`);
    if (!known.includes(k)) throw new Refusal(400, "PGRST204", `fake: the link never sends ${k}`);
  }
}

/** `?col=eq.value` → value. */
function eq(u: URL, col: string): string | null {
  const v = u.searchParams.get(col);
  return v && v.startsWith("eq.") ? v.slice(3) : null;
}

/** The row passes every `eq.` filter on these columns that the request has, and `deleted_at=is.null`. */
function matches(row: Row, u: URL, cols: string[]): boolean {
  const del = u.searchParams.get("deleted_at");
  if (del !== null && del !== "is.null") throw new Refusal(400, "FAKE_FILTER", "fake: only deleted_at=is.null is understood");
  if (del === "is.null" && row.deleted_at) return false;
  return cols.every((c) => {
    const v = eq(u, c);
    return v === null || String(row[c]) === v;
  });
}

function pick(row: Record<string, unknown>, u: URL): Record<string, unknown> {
  const sel = u.searchParams.get("select");
  if (!sel || sel === "*") return row;
  return Object.fromEntries(sel.split(",").map((k) => [k, row[k]]));
}
