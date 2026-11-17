// Talking to Due (Oliver's reminders server; due-integration.md in Esme's notes).
//
//   GET    /due/api/state          -> { state: { reminders: [...] } }
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
// Due's state lists every reminder it has ever held (all types, cancelled ones too), so it
// grows every day. Only what's ours for the days that matter is read: a small answer is parsed
// whole; a large one is scanned for our ids of those days (ids carry their day, rules.ts) and
// only those reminders are parsed (review I3). Above MAX_STATE_BYTES the run stops.

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
  constructor(readonly code: StopCode, readonly status = 0) {
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

  /** Our reminders (type esmeworld) whose ids carry one of `days` ("yyyymmdd"), in any state. */
  async state(days: readonly string[]): Promise<DueRemote[]> {
    const res = await this.send("GET", "/due/api/state");
    if (!res.ok) {
      await res.body?.cancel();
      throw new DueStop("due_bad_state", res.status);
    }
    return parseDueState(await readCapped(res, MAX_STATE_BYTES), days);
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

/** The end (index after the closing brace) of the JSON object starting at `start`, or -1. */
function objectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
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
 * Due's state, reduced to our reminders for `days`. Small: parsed whole. Large: each of our ids
 * of those days is found by text search and only its own object is parsed; if any can't be
 * read that way, the whole state is parsed after all (correct, just slower).
 */
export function parseDueState(text: string, days: readonly string[]): DueRemote[] {
  if (text.length <= FULL_PARSE_BYTES) return parseWhole(text, days);
  const found = new Map<string, DueRemote>();
  // One pass over the text for all the days: their common start, then each id's own day.
  let common = days[0] ?? "";
  for (const d of days) while (!d.startsWith(common)) common = common.slice(0, -1);
  const needle = `"esmeworld-${common}`;
  const wanted = days.map((d) => `"esmeworld-${d}-`);
  {
    for (let pos = text.indexOf(needle); pos >= 0; pos = text.indexOf(needle, pos + needle.length)) {
      if (!wanted.some((wd) => text.startsWith(wd, pos))) continue;
      const idEnd = text.indexOf('"', pos + 1);
      const id = text.slice(pos + 1, idEnd);
      if (found.has(id)) continue;
      // Only where it is an "id" value (a title can't hold one of our ids by chance, but check).
      if (!/"id"\s*:\s*$/.test(text.slice(Math.max(0, pos - 16), pos))) continue;
      const start = text.lastIndexOf("{", pos);
      const end = start < 0 ? -1 : objectEnd(text, start);
      let r: unknown;
      try {
        r = end < 0 ? null : JSON.parse(text.slice(start, end));
      } catch {
        r = null;
      }
      if (!r || (r as DueRemote).id !== id) return parseWhole(text, days);
      if (isOurs(r)) found.set(id, r);
    }
  }
  return [...found.values()];
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
