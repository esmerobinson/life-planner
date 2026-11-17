// A stand-in for Due's server, as due-integration.md describes it. Nothing here ever reaches
// the network. It holds reminders in memory, records every call, and can be told to fail.

export const FAKE_DUE_URL = "https://due.example.test";
export const FAKE_DUE_TOKEN = "fake-due-token-not-real";

export interface FakeReminder {
  id: string;
  title: string;
  dueAt: string;
  notes?: string;
  type: string;
  completedAt: string | null;
  deletedAt: string | null;
}

export interface FakeCall {
  method: string;
  path: string;
  auth: string | null;
  body?: Record<string, unknown>;
}

export class FakeDue {
  reminders = new Map<string, FakeReminder>();
  calls: FakeCall[] = [];
  /** Answer every call with this status (e.g. 503), or throw (network down) when "down". */
  failWith: number | "down" | null = null;
  /** Fail only these methods. */
  failOnly: string[] | null = null;
  /** Refuse (400) a POST this says no to, e.g. a dueAt with an offset. */
  refuse: ((body: Record<string, unknown>) => boolean) | null = null;
  /** How Due stores what it was sent (an echo in another format). */
  echo: ((r: FakeReminder) => FakeReminder) | null = null;
  /** Other reminders in the state (other apps, other days), sent as they are. */
  filler: unknown[] = [];
  /** Runs before every call (tests move a clock with it). */
  onCall: (() => void) | null = null;

  /** Puts a reminder in Due as if it were already there. */
  seed(r: Partial<FakeReminder> & { id: string }): void {
    this.reminders.set(r.id, { title: "t", dueAt: "2026-11-16T09:00:00", type: "esmeworld", completedAt: null, deletedAt: null, ...r });
  }

  active(): FakeReminder[] {
    return [...this.reminders.values()].filter((r) => r.type === "esmeworld" && r.completedAt === null && r.deletedAt === null);
  }

  activeIds(): string[] {
    return this.active().map((r) => r.id).sort();
  }

  mutations(): FakeCall[] {
    return this.calls.filter((c) => c.method !== "GET");
  }

  fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === "POST" ? ((await request.json()) as Record<string, unknown>) : undefined;
    this.calls.push({ method: request.method, path: url.pathname, auth: request.headers.get("Authorization"), body });
    this.onCall?.();
    if (this.failWith !== null && (this.failOnly === null || this.failOnly.includes(request.method))) {
      if (this.failWith === "down") throw new TypeError("network down");
      return Response.json({ error: "pretend failure" }, { status: this.failWith });
    }
    if (url.origin !== FAKE_DUE_URL) return new Response("wrong host", { status: 404 });
    if (request.headers.get("Authorization") !== `Bearer ${FAKE_DUE_TOKEN}`) return Response.json({ error: "unauthorized" }, { status: 401 });

    if (request.method === "GET" && url.pathname === "/due/api/state") {
      return Response.json({
        state: { reminders: [...this.filler, ...this.reminders.values(), { id: "oliver-1", title: "Not ours", type: "manual", completedAt: null, deletedAt: null }] },
      });
    }
    if (request.method === "POST" && url.pathname === "/due/api/reminders") {
      const b = body!;
      if (typeof b.id !== "string" || typeof b.title !== "string" || typeof b.dueAt !== "string") {
        return Response.json({ error: "bad reminder" }, { status: 400 });
      }
      if (this.refuse?.(b)) return Response.json({ error: "bad dueAt" }, { status: 400 });
      const had = this.reminders.get(b.id);
      if (had && had.deletedAt === null) return Response.json({ error: "reminder already exists" }, { status: 400 });
      const stored: FakeReminder = {
        id: b.id, title: b.title, dueAt: b.dueAt, notes: b.notes as string, type: String(b.type), completedAt: null, deletedAt: null,
      };
      this.reminders.set(b.id, this.echo ? this.echo(stored) : stored);
      return Response.json({ ok: true, id: b.id });
    }
    const del = /^\/due\/reminder\/(.+)$/.exec(url.pathname);
    if (request.method === "DELETE" && del) {
      const id = decodeURIComponent(del[1]!);
      const had = this.reminders.get(id);
      if (!had || had.deletedAt !== null) return Response.json({ cancelled: false, reason: "unknown-id" });
      had.deletedAt = "2026-11-16T00:00:00Z";
      return Response.json({ cancelled: true });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}
