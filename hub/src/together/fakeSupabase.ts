// TEST-ONLY stand-in for a Supabase backend shaped like Together, holding only what the
// Together link uses: password and refresh-token sign-in, a couple's `members`, habit `todos`
// and their tally `todo_events`. Plug its `fetch` into the sender. Never imported by app code.
// Every value here is made up, and every message is our own wording.
//
// The rules it holds the sender to (the ones the brief lists, refused with standard Postgres or
// PostgREST error codes):
// - Every request carries the anon key as `apikey`; every /rest call a live access token.
//   A refresh token works once.
// - A to-do is inserted by her, for her, in her couple, with every required column, and a valid
//   id. Its id, couple, owner and creator never change afterwards. Points are never negative.
// - An event is inserted by her, in her couple, for a to-do that exists. Afterwards only
//   `deleted_at` may be set, only by her, only once, and never back to empty.
// - The same id inserted twice is a conflict (409).
// - Stricter than needed, to catch client bugs: the client never sends `created_at` or
//   `updated_at` (the server stamps them), and any column the link doesn't use is refused.
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The only columns the link writes. */
const TODO_COLUMNS = ["id", "couple_id", "owner_id", "created_by", "title", "type", "period", "target", "tally", "deleted_at", "points_earn", "points_miss"];
const EVENT_COLUMNS = ["id", "couple_id", "todo_id", "user_id", "kind", "at", "note", "deleted_at"];
const STAMPS = ["created_at", "updated_at"];

class Refusal extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

export class FakeSupabase {
  readonly url = "https://together.example.test";
  readonly anonKey = "fake-anon-key-for-tests-only";
  readonly requests: RecordedRequest[] = [];
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

  /** Tallies of a habit that aren't deleted. */
  liveTallies(todoId: string): Row[] {
    return [...this.events.values()].filter((e) => e.todo_id === todoId && !e.deleted_at);
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
    if (table === "todos" && r.method === "POST") return this.insertTodo(parse(r.body), me, couple, rep);
    if (table === "todos" && r.method === "PATCH") return this.patchTodo(eq(u, "id"), parse(r.body), me, couple, rep);
    if (table === "todo_events" && r.method === "POST") return this.insertEvent(parse(r.body), me, couple, rep);
    if (table === "todo_events" && r.method === "PATCH") return this.patchEvent(eq(u, "id"), parse(r.body), me, couple, rep);
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

  private insertTodo(body: Row, me: string, couple: string | null, rep: boolean): Response {
    columns(body, TODO_COLUMNS);
    required(body, ["id", "couple_id", "owner_id", "created_by", "title", "type"]);
    if (body.couple_id !== couple || body.created_by !== me || body.owner_id !== me) throw new Refusal(403, "42501", "fake: not her to-do");
    if (body.type !== "habit") throw new Refusal(400, "23514", "fake: the link only makes habits");
    for (const k of ["points_earn", "points_miss"]) {
      if (body[k] !== undefined && !(Number.isInteger(body[k]) && (body[k] as number) >= 0)) throw new Refusal(400, "23514", "fake: points can't be negative");
    }
    if (this.todos.has(String(body.id))) throw new Refusal(409, "23505", "fake: that id is taken");
    const stamp = new Date(this.now()).toISOString();
    const row: Row = { tally: 0, deleted_at: null, ...body, created_at: stamp, updated_at: stamp };
    this.todos.set(String(body.id), row);
    return rep ? json(201, [row]) : new Response(null, { status: 201 });
  }

  private patchTodo(id: string | null, body: Row, me: string, couple: string | null, rep: boolean): Response {
    columns(body, TODO_COLUMNS);
    const old = id === null ? undefined : this.todos.get(id);
    if (!old || old.couple_id !== couple || old.owner_id !== me) return rep ? json(200, []) : new Response(null, { status: 204 });
    for (const k of ["id", "couple_id", "created_by", "owner_id"]) {
      if (k in body && body[k] !== old[k]) throw new Refusal(400, "P0001", "fake: that column is fixed");
    }
    const row = { ...old, ...body, updated_at: new Date(this.now()).toISOString() };
    this.todos.set(id!, row);
    return rep ? json(200, [row]) : new Response(null, { status: 204 });
  }

  private insertEvent(body: Row, me: string, couple: string | null, rep: boolean): Response {
    columns(body, EVENT_COLUMNS);
    required(body, ["id", "couple_id", "todo_id", "user_id", "kind"]);
    if (body.couple_id !== couple || body.user_id !== me) throw new Refusal(403, "42501", "fake: not her event");
    if (body.kind !== "tally") throw new Refusal(400, "23514", "fake: the link only adds tallies");
    if (!this.todos.has(String(body.todo_id))) throw new Refusal(409, "23503", "fake: no such to-do");
    if (this.events.has(String(body.id))) throw new Refusal(409, "23505", "fake: that id is taken");
    const stamp = new Date(this.now()).toISOString();
    const row: Row = { at: stamp, note: null, deleted_at: null, ...body, updated_at: stamp };
    this.events.set(String(body.id), row);
    return rep ? json(201, [row]) : new Response(null, { status: 201 });
  }

  private patchEvent(id: string | null, body: Row, me: string, couple: string | null, rep: boolean): Response {
    columns(body, EVENT_COLUMNS);
    if (Object.keys(body).some((k) => k !== "deleted_at")) throw new Refusal(403, "42501", "fake: only deleted_at can be set on an event");
    const old = id === null ? undefined : this.events.get(id);
    if (!old || old.couple_id !== couple || old.user_id !== me) return rep ? json(200, []) : new Response(null, { status: 204 });
    if (old.deleted_at || !body.deleted_at) throw new Refusal(400, "P0001", "fake: an event is deleted once, for good");
    const row = { ...old, deleted_at: body.deleted_at, updated_at: new Date(this.now()).toISOString() };
    this.events.set(id!, row);
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
    if (STAMPS.includes(k)) throw new Refusal(400, "FAKE_STAMP", `fake: the server stamps ${k}, the client never sends it`);
    if (!known.includes(k)) throw new Refusal(400, "PGRST204", `fake: the link never sends ${k}`);
  }
}

function required(body: Row, keys: string[]): void {
  for (const k of keys) if (body[k] === undefined || body[k] === null) throw new Refusal(400, "23502", `fake: ${k} is required`);
  if (!UUID.test(String(body.id))) throw new Refusal(400, "22P02", "fake: id isn't a UUID");
}

/** `?col=eq.value` → value. */
function eq(u: URL, col: string): string | null {
  const v = u.searchParams.get(col);
  return v && v.startsWith("eq.") ? v.slice(3) : null;
}

function pick(row: Record<string, unknown>, u: URL): Record<string, unknown> {
  const sel = u.searchParams.get("select");
  if (!sel || sel === "*") return row;
  return Object.fromEntries(sel.split(",").map((k) => [k, row[k]]));
}
