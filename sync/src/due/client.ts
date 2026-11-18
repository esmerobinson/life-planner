// Talking to Due (Oliver's reminders server; due-integration.md in Esme's notes).
//
//   GET    /due/api/reminders?type=esmeworld&from=<ISO with offset>
//                                  -> { reminders: [{id, title, dueAt, completedAt, deletedAt, type}] }
//                                  Oliver's filtered endpoint (17 Nov): our type only, due from
//                                  `from` on, completed and deleted ones included (we rely on
//                                  completedAt/deletedAt; reconcile.ts copes if they are left out)
//   POST   /due/api/reminders      {id, title, dueAt, notes, type: "esmeworld"}; 400 "reminder
//                                  already exists" when the id is taken (then DELETE, POST again)
//   DELETE /due/reminder/<id>      cancels ({cancelled:false, reason:"unknown-id"} is fine too)
//
// Every call is counted against the run's budget (Workers allow 50 subrequests per run), times
// out (DUE_TIMEOUT_MS), and is only started if it can finish before the run's deadline. The
// token goes only in the Authorization header: never in a log or an error. A call that shows
// Due is down or refusing us (no answer, 5xx, 401, 403, 429) stops the whole run (`DueStop`):
// it is tried again at the next cron run, never in a loop.
//
// The filtered list is small (a few days of ours). It is still read defensively, as the whole
// state used to be: a small answer is parsed whole; a large one (a server ignoring the filter)
// is scanned for our ids of the days that matter (ids carry their day, rules.ts) and only those
// reminders are parsed (review I3). Above MAX_STATE_BYTES the run stops. An answer we can't read
// stops the run with its status and its top-level shape (key names and types, never values).

export const DUE_TIMEOUT_MS = 5_000;
export const REMINDER_TYPE = "esmeworld";
/** Read at most this much of an error answer (to spot "already exists"). */
const MAX_ERROR_READ = 2_048;
/** The most of Due's state one run reads. */
export const MAX_STATE_BYTES = 8 * 1024 * 1024;
/** Up to this size the state is parsed whole; above it, scanned. */
export const FULL_PARSE_BYTES = 256 * 1024;

export interface DueRemote {
  id: string;
  title?: unknown;
  dueAt?: unknown;
  type?: unknown;
  completedAt?: unknown;
  deletedAt?: unknown;
}

export interface NewReminder {
  id: string;
  title: string;
  dueAt: string;
  notes: string;
  type: typeof REMINDER_TYPE;
}

/** Why a run stopped early: a fixed code (safe to log). */
export type StopCode =
  | "due_unreachable"
  | "due_server_error"
  | "due_unauthorized"
  | "due_rate_limited"
  | "due_bad_state"
  | "due_state_too_large"
  | "due_rejecting"
  | "deadline"
  | "budget";

export class DueStop extends Error {
  /**
   * `status`: the HTTP status, when there was an answer. `shape`: for an answer we couldn't
   * read, its top-level shape (describeShape: key names and types only), safe to log.
   */
  constructor(readonly code: StopCode, readonly status = 0, readonly shape?: string) {
    super(code);
    this.name = "DueStop";
  }
}

export interface DueClientOptions {
  baseUrl: string;
  token: string;
  fetch: typeof fetch;
  maxCalls: number;
  timeoutMs?: number;
  /** No call starts unless it can time out before this moment (epoch ms; review I2). */
  deadline?: number;
  /** The real clock, for the deadline (tests pass their own). */
  clock?: () => number;
}

export type CallResult = "ok" | "exists" | "rejected";

export class DueClient {
  calls = 0;
  constructor(private readonly opts: DueClientOptions) {}

  get remaining(): number {
    return this.opts.maxCalls - this.calls;
  }

  private async send(method: string, path: string, body?: unknown): Promise<Response> {
    if (this.remaining <= 0) throw new DueStop("budget");
    const timeout = this.opts.timeoutMs ?? DUE_TIMEOUT_MS;
    const now = (this.opts.clock ?? Date.now)();
    if (this.opts.deadline !== undefined && now + timeout > this.opts.deadline) throw new DueStop("deadline");
    this.calls++;
    const headers: Record<string, string> = { Authorization: `Bearer ${this.opts.token}`, Accept: "application/json" };
    if (body !== undefined) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await this.opts.fetch(`${this.opts.baseUrl.replace(/\/+$/, "")}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw new DueStop("due_unreachable");
    }
    if (res.status === 401 || res.status === 403) throw new DueStop("due_unauthorized", res.status);
    if (res.status === 429) throw new DueStop("due_rate_limited", res.status);
    if (res.status >= 500 || (res.status >= 300 && res.status < 400)) throw new DueStop("due_server_error", res.status);
    return res;
  }

  /**
   * Our reminders (type esmeworld) whose ids carry one of `days` ("yyyymmdd"), in any state,
   * from Due's list of those due from `from` (ISO-8601 with an offset) on.
   */
  async reminders(days: readonly string[], from: string): Promise<DueRemote[]> {
    const res = await this.send("GET", `/due/api/reminders?type=${REMINDER_TYPE}&from=${encodeURIComponent(from)}`);
    if (!res.ok) {
      await res.body?.cancel();
      throw new DueStop("due_bad_state", res.status);
    }
    const text = await readCapped(res, MAX_STATE_BYTES);
    try {
      return parseDueState(text, days);
    } catch (error) {
      if (error instanceof DueStop && error.code === "due_bad_state") {
        throw new DueStop("due_bad_state", res.status, describeShape(text, res.headers.get("Content-Type")));
      }
      throw error;
    }
  }

  async create(reminder: NewReminder): Promise<CallResult> {
    const res = await this.send("POST", "/due/api/reminders", reminder);
    if (res.ok) return drain(res, "ok");
    if (res.status === 400 || res.status === 409) {
      const said = await readSome(res);
      if (/already exists/i.test(said)) return "exists";
    } else await res.body?.cancel();
    return "rejected";
  }

  async cancel(id: string): Promise<CallResult> {
    const res = await this.send("DELETE", `/due/reminder/${encodeURIComponent(id)}`);
    // 404 and {cancelled:false, reason:"unknown-id"} both mean it isn't there: fine.
    return drain(res, res.ok || res.status === 404 ? "ok" : "rejected");
  }
}

/** The body as text, or a stop when it is larger than `max` bytes. */
async function readCapped(res: Response, max: number): Promise<string> {
  const declared = Number(res.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > max) {
    await res.body?.cancel();
    throw new DueStop("due_state_too_large", res.status);
  }
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) {
        await reader.cancel();
        throw new DueStop("due_state_too_large", res.status);
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof DueStop) throw error;
    throw new DueStop("due_unreachable");
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder().decode(all);
}

const isOurs = (r: unknown): r is DueRemote =>
  typeof r === "object" && r !== null && typeof (r as DueRemote).id === "string" &&
  (r as DueRemote).type === REMINDER_TYPE && (r as DueRemote).id.startsWith("esmeworld-");

/** Ours, for one of `days`. */
const forDays = (r: DueRemote, days: readonly string[]) => days.some((d) => r.id.startsWith(`esmeworld-${d}-`));

function parseWhole(text: string, days: readonly string[]): DueRemote[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new DueStop("due_bad_state");
  }
  const p = parsed as { state?: { reminders?: unknown }; reminders?: unknown } | null;
  const list = p?.state?.reminders ?? p?.reminders;
  if (!Array.isArray(list)) throw new DueStop("due_bad_state");
  return list.filter((r): r is DueRemote => isOurs(r) && forDays(r, days));
}

/** Our reminder objects are small (under 1 KB); a candidate longer than this isn't one of ours. */
const MAX_OBJECT_CHARS = 4 * 1024;
/** How many `{` before an id are tried as the start of its reminder object. */
const MAX_CANDIDATES = 64;
const REMINDERS_ARRAY = /"reminders"\s*:\s*\[/;

/**
 * The end (index after the closing brace) of the JSON object starting at `start`, or -1 if it
 * doesn't close within MAX_OBJECT_CHARS.
 */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  const stop = Math.min(text.length, start + MAX_OBJECT_CHARS);
  for (let i = start; i < stop; i++) {
    const c = text.charCodeAt(i);
    if (inString) {
      if (c === 92) i++; // backslash: skip the escaped character
      else if (c === 34) inString = false;
    } else if (c === 34) inString = true;
    else if (c === 123) depth++;
    else if (c === 125 && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * The reminder object whose own "id" is the one at `pos`: the nearest `{` before it that opens
 * an object containing `pos` whose top-level id is that id. A nested object before "id", or a
 * `{` inside a string, is stepped over (its object ends before `pos`, or doesn't parse).
 */
/** A `{` that can open a JSON object: next comes a key (`"`), `}` or whitespace, never other text. */
function opensObject(text: string, at: number): boolean {
  const c = text.charCodeAt(at + 1);
  return c === 34 || c === 125 || c === 32 || c === 10 || c === 13 || c === 9;
}

function objectAround(text: string, pos: number, id: string, floor: number): DueRemote | null {
  let start = text.lastIndexOf("{", pos);
  while (start > floor && !opensObject(text, start)) start = text.lastIndexOf("{", start - 1);
  // Fast path: a flat object (no other brace in it), as Due's reminders are expected to be.
  const close = text.indexOf("}", pos);
  const inner = text.indexOf("{", start + 1);
  if (start > floor && close > pos && (inner < 0 || inner > close) && close - start < MAX_OBJECT_CHARS) {
    try {
      const r = JSON.parse(text.slice(start, close + 1)) as DueRemote;
      if (r && typeof r === "object" && r.id === id) return r;
    } catch {
      // not flat: the careful way below
    }
  }
  for (let tries = 0; start > floor && tries < MAX_CANDIDATES; tries++) {
    const end = objectEnd(text, start);
    if (end > pos) {
      try {
        const r = JSON.parse(text.slice(start, end)) as DueRemote;
        if (r && typeof r === "object" && r.id === id) return r;
      } catch {
        // not an object start after all (a brace inside a string): try the one before
      }
    }
    start = text.lastIndexOf("{", start - 1);
    while (start > floor && !opensObject(text, start)) start = text.lastIndexOf("{", start - 1);
  }
  return null;
}

/**
 * Due's state, reduced to our reminders for `days`. Small: parsed whole. Large: within the
 * `reminders` array only, each of our ids of those days is found by text search (one pass for
 * all the days) and only its own object is parsed (re-review R-I1). If the state's shape isn't
 * the expected one, or an id's object can't be found, the whole state is parsed after all
 * (correct, slower) and that is logged once, as a fixed code.
 */
export function parseDueState(text: string, days: readonly string[]): DueRemote[] {
  if (text.length <= FULL_PARSE_BYTES) return parseWhole(text, days);
  const array = REMINDERS_ARRAY.exec(text);
  if (!array) return fallback(text, days);
  const floor = array.index + array[0].length - 1;
  const found = new Map<string, DueRemote>();
  // One pass for all the days.
  const needle = new RegExp(`"esmeworld-(?:${days.map((d) => d.replace(/\D/g, "")).join("|")})-`, "g");
  needle.lastIndex = floor;
  for (let m = needle.exec(text); m; m = needle.exec(text)) {
    const pos = m.index;
    {
      const idEnd = text.indexOf('"', pos + 1);
      const id = text.slice(pos + 1, idEnd);
      if (found.has(id)) continue;
      // Only where it is an "id" value (a title can't hold one of our ids by chance, but check).
      if (!/"id"\s*:\s*$/.test(text.slice(Math.max(0, pos - 16), pos))) continue;
      const r = objectAround(text, pos, id, floor);
      if (!r) return fallback(text, days);
      if (isOurs(r)) found.set(id, r);
    }
  }
  return [...found.values()];
}

/** Keys that are plainly field names (a key with spaces or punctuation could be a title). */
const SAFE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]{0,31}$/;
const SAFE_MIME = /^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+-]+$/;
/** The most keys named per object (the rest are counted). */
const MAX_SHAPE_KEYS = 8;

function shapeOf(v: unknown, depth: number): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v !== "object") return typeof v;
  if (depth <= 0) return "object";
  const parts: string[] = [];
  let unnamed = 0;
  for (const [k, inner] of Object.entries(v)) {
    if (parts.length < MAX_SHAPE_KEYS && SAFE_KEY.test(k)) parts.push(`${k}:${shapeOf(inner, depth - 1)}`);
    else unnamed++;
  }
  if (unnamed) parts.push(`+${unnamed}`);
  return `{${parts.join(",")}}`;
}

/**
 * An answer's shape, safe to log: two levels of key names and value types, never a value, a
 * title, or a key that isn't plainly a field name (those are only counted). Not JSON: its
 * content type ("not_json(text/html)").
 */
export function describeShape(text: string, contentType: string | null): string {
  if (text.trim() === "") return "empty";
  try {
    return shapeOf(JSON.parse(text), 2);
  } catch {
    const mime = (contentType ?? "").split(";")[0]!.trim();
    return SAFE_MIME.test(mime) ? `not_json(${mime})` : "not_json";
  }
}

function fallback(text: string, days: readonly string[]): DueRemote[] {
  console.error("due_reminders_state_fallback");
  return parseWhole(text, days);
}

async function drain(res: Response, result: CallResult): Promise<CallResult> {
  await res.body?.cancel();
  return result;
}

async function readSome(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, MAX_ERROR_READ);
  } catch {
    return "";
  }
}
