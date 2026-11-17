// Talking to Due (Oliver's reminders server; due-integration.md in Esme's notes).
//
//   GET    /due/api/state          -> { state: { reminders: [...] } }
//   POST   /due/api/reminders      {id, title, dueAt, notes, type: "esmeworld"}; 400 "reminder
//                                  already exists" when the id is taken (then DELETE, POST again)
//   DELETE /due/reminder/<id>      cancels ({cancelled:false, reason:"unknown-id"} is fine too)
//
// Every call is counted against the run's budget (Workers allow 50 subrequests per run) and
// times out. The token goes only in the Authorization header: never in a log or an error.
// A call that shows Due is down or refusing us (no answer, 5xx, 401, 403, 429) stops the
// whole run (`DueStop`): it is tried again at the next cron run, never in a loop.

export const DUE_TIMEOUT_MS = 8_000;
export const REMINDER_TYPE = "esmeworld";
/** Read at most this much of an error answer (to spot "already exists"). */
const MAX_ERROR_READ = 2_048;

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
export type StopCode = "due_unreachable" | "due_server_error" | "due_unauthorized" | "due_rate_limited" | "due_bad_state" | "budget";

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
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? DUE_TIMEOUT_MS),
      });
    } catch {
      throw new DueStop("due_unreachable");
    }
    if (res.status === 401 || res.status === 403) throw new DueStop("due_unauthorized", res.status);
    if (res.status === 429) throw new DueStop("due_rate_limited", res.status);
    if (res.status >= 500 || (res.status >= 300 && res.status < 400)) throw new DueStop("due_server_error", res.status);
    return res;
  }

  /** Every reminder Due holds (all types, any state). */
  async state(): Promise<DueRemote[]> {
    const res = await this.send("GET", "/due/api/state");
    if (!res.ok) throw new DueStop("due_bad_state", res.status);
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw new DueStop("due_bad_state", res.status);
    }
    const p = parsed as { state?: { reminders?: unknown }; reminders?: unknown } | null;
    const list = p?.state?.reminders ?? p?.reminders;
    if (!Array.isArray(list)) throw new DueStop("due_bad_state", res.status);
    return list.filter((r): r is DueRemote => typeof r === "object" && r !== null && typeof (r as DueRemote).id === "string");
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
