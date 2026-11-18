import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BACKOFF_MS, MAX_CALLS_PER_RUN, RUN_DEADLINE_MS, runDueReminders, SYNC_RUN_GAP_MS } from "../../../src/due/cron";
import { keyOf } from "../../../src/due/reconcile";
import type { Env } from "../../../src/env";
import { scheduled } from "../../../src/index";
import { call, change, DEVICE_A, errorOf, sync, syncOk } from "../helpers";
import { FAKE_DUE_TOKEN, FAKE_DUE_URL, FakeDue } from "./fakeDue";

// Monday 16 November 2026, New York.
const at = (local: string) => Date.parse(`${local}-05:00`);
const MORNING = at("2026-11-16T08:00:00");
const dueEnv = (more: Partial<Env> = {}) => ({ ...env, DUE_TOKEN: FAKE_DUE_TOKEN, DUE_BASE_URL: FAKE_DUE_URL, ...more }) as Env;

let due: FakeDue;
beforeEach(() => {
  due = new FakeDue();
});
/** What's active in Due, by key (what and which day; the version left off). */
const activeKeys = () => due.activeIds().map(keyOf).sort();

const todo = (id: string, p: Record<string, unknown> = {}) => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "admin", priority: 2, status: "open",
  createdAt: "2026-11-01", touchedAt: "2026-11-01", updatedAt: 10, ...p,
});
const prefsRow = (p: Record<string, unknown> = {}) => ({ id: "due", on: true, timeZone: "America/New_York", ...p });

/** Puts rows on the server the way the app does (a sync), stamped `stamp`. */
async function put(rows: { table: string; data: Record<string, unknown> }[], stamp = MORNING - 1000) {
  await syncOk(DEVICE_A, 0, rows.map((r) => change(String(r.data.id), stamp, { ...r.data, updatedAt: stamp }, r.table)), { now: Math.max(MORNING, stamp + 1000) });
}

const runAt = (now: number, e = dueEnv()) => scheduled(e, { now: () => now, dueFetch: due.fetch });

describe("Due reminders: the cron run", () => {
  it("does nothing at all without the DUE_TOKEN secret", async () => {
    await put([{ table: "prefs", data: prefsRow() }, { table: "items", data: todo("a", { due: "2026-11-16" }) }]);
    const result = await runDueReminders({ ...env, DUE_TOKEN: undefined, DUE_BASE_URL: FAKE_DUE_URL } as Env, { now: () => MORNING, dueFetch: due.fetch });
    expect(result).toEqual({ kind: "off", reason: "no_token" });
    expect(due.calls).toEqual([]);
    // The test setup itself never has a token (so no test can reach the real Due).
    expect((env as unknown as Env).DUE_TOKEN).toBeUndefined();
  });

  it("refuses a base address that isn't https", async () => {
    const result = await runDueReminders(dueEnv({ DUE_BASE_URL: "http://plain.example" }), { now: () => MORNING, dueFetch: due.fetch });
    expect(result).toEqual({ kind: "off", reason: "bad_base_url" });
    expect(due.calls).toEqual([]);
  });

  it("with no settings row (or Due turned off) nothing is created", async () => {
    await put([{ table: "items", data: todo("a", { due: "2026-11-16" }) }]);
    await runAt(MORNING);
    expect(due.mutations()).toEqual([]);
  });

  it("reads her to-dos and settings from D1 and fills Due", async () => {
    await put([
      { table: "prefs", data: prefsRow({ plan: "09:00", review: "21:00", leadMinutes: 15 }) },
      { table: "items", data: todo("late", { due: "2026-11-10", priority: 1 }) },
      { table: "items", data: todo("habit", { recur: ["mon"], doneDates: ["2026-11-14"] }) },
      { table: "items", data: todo("meeting", { pinnedDate: "2026-11-16", time: "15:00", notes: "secret page words" }) },
      { table: "items", data: todo("someday") },
      { table: "items", data: todo("gone", { status: "deleted", due: "2026-11-16" }) },
    ]);
    await runAt(MORNING);
    expect(activeKeys()).toEqual([
      "esmeworld-20261116-d1-habit",
      "esmeworld-20261116-d1-late",
      "esmeworld-20261116-d2-habit",
      "esmeworld-20261116-d2-late",
      "esmeworld-20261116-plan",
      "esmeworld-20261116-review",
      "esmeworld-20261116-t-meeting",
    ]);
    const meeting = [...due.reminders.values()].find((r) => keyOf(r.id) === "esmeworld-20261116-t-meeting");
    expect(meeting).toMatchObject({ title: "Pretend meeting", dueAt: "2026-11-16T14:45:00" });
    // Nothing from a page or notes ever goes to Due.
    expect(JSON.stringify(due.calls)).not.toContain("secret page words");
  });

  it("a replay changes nothing", async () => {
    await put([{ table: "prefs", data: prefsRow() }, { table: "items", data: todo("a", { due: "2026-11-16" }) }]);
    await runAt(MORNING);
    due.calls = [];
    await runAt(MORNING + 60_000);
    expect(due.calls.map((c) => c.method)).toEqual(["GET"]);
  });

  it("done means cancelled: the next run cancels its reminders", async () => {
    await put([{ table: "prefs", data: prefsRow() }, { table: "items", data: todo("a", { due: "2026-11-16" }) }]);
    await runAt(MORNING);
    expect(activeKeys()).toContain("esmeworld-20261116-d1-a");
    await put([{ table: "items", data: todo("a", { due: "2026-11-16", status: "done", completedAt: "2026-11-16" }) }], MORNING);
    await runAt(MORNING + 15 * 60_000);
    expect(activeKeys()).toEqual(["esmeworld-20261116-plan", "esmeworld-20261116-review"]);
  });

  it("a habit ticked today stops its reminders and the nudge", async () => {
    await put([{ table: "prefs", data: prefsRow() }, { table: "items", data: todo("h", { recur: ["mon"] }) }]);
    await runAt(at("2026-11-16T12:45:00"));
    expect(activeKeys()).toContain("esmeworld-20261116-nudge");
    expect(activeKeys()).toContain("esmeworld-20261116-d2-h");
    await put([{ table: "items", data: todo("h", { recur: ["mon"], doneDates: ["2026-11-16"] }) }], MORNING);
    await runAt(at("2026-11-16T12:50:00"));
    expect(activeKeys()).toEqual(["esmeworld-20261116-review"]);
  });

  it("the nudge uses her own lines", async () => {
    await put([{ table: "prefs", data: prefsRow({ lines: ["You've got this, pretend"] }) }]);
    await runAt(at("2026-11-16T12:45:00"));
    expect(due.active().find((r) => keyOf(r.id) === "esmeworld-20261116-nudge")!.title).toBe("You've got this, pretend");
  });

  it("turning Due off cancels what's there", async () => {
    await put([{ table: "prefs", data: prefsRow() }]);
    await runAt(MORNING);
    expect(activeKeys()).toHaveLength(2);
    await put([{ table: "prefs", data: prefsRow({ on: false }) }], MORNING);
    await runAt(MORNING + 60_000);
    expect(activeKeys()).toEqual([]);
  });

  it("only one run at a time (the lease), and the lease is given back", async () => {
    await put([{ table: "prefs", data: prefsRow() }]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
      await gate;
      return due.fetch(input, init);
    }) as typeof fetch;
    const first = runDueReminders(dueEnv(), { now: () => MORNING, dueFetch: slow });
    await vi.waitFor(() => expect(due.calls.length).toBe(0));
    const second = await runDueReminders(dueEnv(), { now: () => MORNING + 1000, dueFetch: due.fetch });
    expect(second).toEqual({ kind: "busy" });
    release();
    expect((await first).kind).toBe("ran");
    expect((await runDueReminders(dueEnv(), { now: () => MORNING + 2000, dueFetch: due.fetch })).kind).toBe("ran");
  });

  it("Due down: the run logs a fixed code (never the token) and stops; the next run catches up", async () => {
    await put([{ table: "prefs", data: prefsRow() }]);
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => void logged.push(args));
    due.failWith = 503;
    await runAt(MORNING);
    spy.mockRestore();
    expect(due.calls).toHaveLength(1);
    expect(logged).toEqual([["due_reminders_stopped", "due_server_error", "status=503"]]);
    expect(JSON.stringify(logged)).not.toContain(FAKE_DUE_TOKEN);
    due.failWith = null;
    await runAt(MORNING + 15 * 60_000);
    expect(activeKeys()).toHaveLength(2);
  });

  it("never more than the call budget in one run", async () => {
    expect(MAX_CALLS_PER_RUN).toBeLessThan(50);
    // 40 stale reminders to cancel and a full day to create.
    for (let i = 0; i < 45; i++) due.seed({ id: `esmeworld-20261115-d1-x${i}-v0000abcd` });
    await put([
      { table: "prefs", data: prefsRow() },
      ...Array.from({ length: 12 }, (_, i) => ({ table: "items", data: todo(`t${i}`, { due: "2026-11-16" }) })),
    ]);
    await runAt(MORNING);
    expect(due.calls.length).toBeLessThanOrEqual(MAX_CALLS_PER_RUN);
  });
});

describe("Due reminders: fix round 1", () => {
  it("Off then On the same day brings today's reminders back (our cancellations are logged in D1, review I1)", async () => {
    await put([{ table: "prefs", data: prefsRow() }, { table: "items", data: todo("a", { due: "2026-11-16" }) }]);
    await runAt(MORNING);
    const before = activeKeys();
    await put([{ table: "prefs", data: prefsRow({ on: false }) }], MORNING);
    await runAt(MORNING + 60_000);
    expect(activeKeys()).toEqual([]);
    const logged = await env.DB.prepare("SELECT count(*) AS n FROM meta WHERE key LIKE 'due_x:%'").first<{ n: number }>();
    expect(logged!.n).toBe(before.length);
    await put([{ table: "prefs", data: prefsRow({ on: true }) }], MORNING + 120_000);
    await runAt(MORNING + 180_000);
    expect(activeKeys()).toEqual(before);
  });

  it("Off and nothing left in Due: later runs don't even ask Due (review M7)", async () => {
    await put([{ table: "prefs", data: prefsRow({ on: false }) }]);
    await runAt(MORNING);
    expect(due.calls.map((c) => c.method)).toEqual(["GET"]);
    due.calls = [];
    await runAt(MORNING + 15 * 60_000);
    expect(due.calls).toEqual([]);
    await put([{ table: "prefs", data: prefsRow({ on: true }) }], MORNING);
    await runAt(MORNING + 30 * 60_000);
    expect(activeKeys()).toHaveLength(2);
  });

  it("Due refusing every reminder: the run stops after 3 and Due is left alone for an hour (review I4)", async () => {
    await put([{ table: "prefs", data: prefsRow() }, ...Array.from({ length: 6 }, (_, i) => ({ table: "items", data: todo(`r${i}`, { due: "2026-11-16" }) }))]);
    due.refuse = () => true;
    await runAt(MORNING);
    expect(due.mutations()).toHaveLength(3);
    due.calls = [];
    await runAt(MORNING + 15 * 60_000);
    expect(due.calls).toEqual([]);
    due.refuse = null;
    await runAt(MORNING + BACKOFF_MS + 1);
    expect(activeKeys().length).toBeGreaterThan(0);
  });

  it("a slow Due: the run stops at its deadline, long before the lease ends (review I2)", async () => {
    await put([{ table: "prefs", data: prefsRow() }, ...Array.from({ length: 8 }, (_, i) => ({ table: "items", data: todo(`s${i}`, { due: "2026-11-16" }) }))]);
    let clock = 1_000_000;
    due.onCall = () => (clock += 3_000);
    const result = await runDueReminders(dueEnv(), { now: () => MORNING, dueFetch: due.fetch, clock: () => clock });
    expect(result).toMatchObject({ kind: "ran", report: { stopped: "deadline" } });
    expect(clock - 1_000_000).toBeLessThanOrEqual(RUN_DEADLINE_MS);
    // The lease was given back: the next run goes.
    due.onCall = null;
    expect((await runDueReminders(dueEnv(), { now: () => MORNING, dueFetch: due.fetch, clock: () => clock })).kind).toBe("ran");
  });

  it("reads only open to-dos that can matter today, never ideas or books (review I3)", async () => {
    await put([
      { table: "prefs", data: prefsRow() },
      { table: "items", data: todo("idea", { kind: "idea", due: "2026-11-16" }) },
      { table: "items", data: todo("far", { due: "2026-12-25" }) },
      { table: "items", data: todo("near", { due: "2026-11-16" }) },
    ]);
    await runAt(MORNING);
    expect(activeKeys().filter((k) => k.includes("-d1-"))).toEqual(["esmeworld-20261116-d1-near"]);
  });

  it("with hundreds of overdue to-dos, the SQL's cut still keeps the timed one, priority 1 and today's habit (re-review R-I1)", async () => {
    await put([
      { table: "prefs", data: prefsRow() },
      ...Array.from({ length: 400 }, (_, i) => ({ table: "items", data: todo(`old${String(i).padStart(3, "0")}`, { due: "2026-11-01", priority: 3 }) })),
      { table: "items", data: todo("urgent", { due: "2026-11-15", priority: 1 }) },
      { table: "items", data: todo("habit", { recur: ["mon"], priority: 3 }) },
      { table: "items", data: todo("notToday", { recur: ["tue"], priority: 1 }) },
      { table: "items", data: todo("meeting", { due: "2026-11-16", time: "16:00", priority: 3 }) },
    ]);
    await runAt(MORNING);
    const keys = activeKeys();
    expect(keys).toContain("esmeworld-20261116-d1-urgent");
    expect(keys).toContain("esmeworld-20261116-d1-habit");
    expect(keys).toContain("esmeworld-20261116-t-meeting");
    expect(keys.some((k) => k.endsWith("-notToday"))).toBe(false);
    expect(keys.filter((k) => k.includes("-d1-"))).toHaveLength(8);
  });

  it("the log of our own cancellations is pruned after 3 days and stays small (re-review R-M3)", async () => {
    const count = async () => (await env.DB.prepare("SELECT count(*) AS n FROM meta WHERE key LIKE 'due_x:%'").first<{ n: number }>())!.n;
    // An old entry (4 days) and a recent one (1 day).
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('due_x:esmeworld-20261112-plan-v00000000', ?1), ('due_x:esmeworld-20261115-plan-v00000000', ?2)")
      .bind(MORNING - 4 * 86_400_000, MORNING - 86_400_000).run();
    await put([{ table: "prefs", data: prefsRow() }, { table: "items", data: todo("a", { due: "2026-11-16" }) }]);
    await runAt(MORNING);
    const left = await env.DB.prepare("SELECT key FROM meta WHERE key LIKE 'due_x:%' ORDER BY key").all<{ key: string }>();
    expect(left.results.map((r) => r.key)).toEqual(["due_x:esmeworld-20261115-plan-v00000000"]);

    // Ten days of runs, each with Due turned off and on again and a to-do ticked and unticked:
    // the log only ever holds about three days of cancellations.
    let most = 0;
    for (let d = 0; d < 10; d++) {
      const day = `2026-11-${String(16 + d).padStart(2, "0")}`;
      const base = Date.parse(`${day}T08:00:00-05:00`);
      const stamp = base - 1000 + d; // later each day
      await put([{ table: "prefs", data: prefsRow({ on: true }) }, { table: "items", data: todo("a", { due: day }) }], stamp);
      await runAt(base);
      await put([{ table: "items", data: todo("a", { due: day, status: "done", completedAt: day }) }], stamp + 100);
      await runAt(base + 60_000);
      await put([{ table: "prefs", data: prefsRow({ on: false }) }], stamp + 200);
      await runAt(base + 120_000);
      most = Math.max(most, await count());
    }
    expect(most).toBeLessThanOrEqual(4 * 4);
    const oldest = await env.DB.prepare("SELECT min(value) AS v FROM meta WHERE key LIKE 'due_x:%'").first<{ v: number }>();
    expect(oldest!.v).toBeGreaterThanOrEqual(Date.parse("2026-11-25T08:00:00-05:00") - 3 * 86_400_000);
  });

  it("a run after a sync that finds another run busy doesn't use up the minute (review M2)", async () => {
    await put([{ table: "prefs", data: prefsRow() }]);
    await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('due_lease', ?1)").bind(Date.now() + 60_000).run();
    expect((await runDueReminders(dueEnv(), { now: () => MORNING, dueFetch: due.fetch }, true)).kind).toBe("busy");
    await env.DB.prepare("UPDATE meta SET value = 0 WHERE key = 'due_lease'").run();
    expect((await runDueReminders(dueEnv(), { now: () => MORNING + 1000, dueFetch: due.fetch }, true)).kind).toBe("ran");
  });
});

describe("Due reminders: sync", () => {
  it("the Worker refuses a malformed Due settings row", async () => {
    for (const bad of [{ on: "yes" }, { timeZone: "Mars/Base" }, { plan: "9am" }, { leadMinutes: -5 }, { lines: ["ok", ""] }, { lines: Array(51).fill("x") }]) {
      const result = await sync(DEVICE_A, 0, [change("due", 5, prefsRow(bad), "prefs")]);
      expect(result.status).toBe(400);
    }
    const ok = await sync(DEVICE_A, 0, [change("due", 5, prefsRow({ lines: ["A line"], laterField: 1 }), "prefs")]);
    expect(ok.status).toBe(200);
    const res = await call("/v1/sync", { method: "POST", body: { deviceId: DEVICE_A, cursor: 0, changes: [change("due", 6, { id: "nope" }, "prefs")] } });
    expect(await errorOf(res)).toBe("bad_change");
  });

  it("a sync that ticks something off cancels its reminder soon after, without waiting for Due", async () => {
    await put([{ table: "prefs", data: prefsRow() }, { table: "items", data: todo("a", { due: "2026-11-16" }) }]);
    await runAt(MORNING);
    expect(activeKeys()).toContain("esmeworld-20261116-d1-a");

    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = (async (input: RequestInfo | URL, init?: RequestInit) => {
      await gate;
      return due.fetch(input, init);
    }) as typeof fetch;
    const later: Promise<unknown>[] = [];
    const now = MORNING + 5 * 60_000;
    const res = await sync(DEVICE_A, 0, [change("a", now, todo("a", { due: "2026-11-16", status: "done", completedAt: "2026-11-16", updatedAt: now }))], {
      now, envOverride: { DUE_TOKEN: FAKE_DUE_TOKEN, DUE_BASE_URL: FAKE_DUE_URL }, deps: { dueFetch: slow, waitUntil: (p) => void later.push(p) },
    });
    // The sync answered while Due hadn't been reached yet.
    expect(res.status).toBe(200);
    expect(later).toHaveLength(1);
    expect(activeKeys()).toContain("esmeworld-20261116-d1-a");
    release();
    await Promise.all(later);
    expect(activeKeys()).not.toContain("esmeworld-20261116-d1-a");
  });

  it("sync-started runs are at most one a minute, and never without a token", async () => {
    await put([{ table: "prefs", data: prefsRow() }]);
    const later: Promise<unknown>[] = [];
    const tick = (n: number, now: number, envOverride: Record<string, unknown>) =>
      sync(DEVICE_A, 0, [change(`d${n}`, now, todo(`d${n}`, { status: "done", completedAt: "2026-11-16", updatedAt: now }))], {
        now, envOverride, deps: { dueFetch: due.fetch, waitUntil: (p) => void later.push(p) },
      });
    const withToken = { DUE_TOKEN: FAKE_DUE_TOKEN, DUE_BASE_URL: FAKE_DUE_URL };
    await tick(0, MORNING, {});
    expect(later).toHaveLength(0); // no token: nothing scheduled
    for (const [n, when] of [[1, MORNING], [2, MORNING + 1000], [3, MORNING + SYNC_RUN_GAP_MS + 1]] as const) {
      await tick(n, when, withToken);
      await Promise.all(later);
    }
    expect(due.calls.filter((c) => c.method === "GET")).toHaveLength(2);
  });

  it("adding a to-do with a time starts a run (its alert may be within 15 minutes)", async () => {
    const later: Promise<unknown>[] = [];
    await sync(DEVICE_A, 0, [change("t", MORNING, todo("t", { due: "2026-11-16", time: "08:20", updatedAt: MORNING }))], {
      now: MORNING, envOverride: { DUE_TOKEN: FAKE_DUE_TOKEN, DUE_BASE_URL: FAKE_DUE_URL }, deps: { dueFetch: due.fetch, waitUntil: (p) => void later.push(p) },
    });
    expect(later).toHaveLength(1);
  });

  it("an ordinary edit (nothing ticked) doesn't start a run", async () => {
    const later: Promise<unknown>[] = [];
    await sync(DEVICE_A, 0, [change("e", MORNING, todo("e", { updatedAt: MORNING }))], {
      now: MORNING, envOverride: { DUE_TOKEN: FAKE_DUE_TOKEN, DUE_BASE_URL: FAKE_DUE_URL }, deps: { dueFetch: due.fetch, waitUntil: (p) => void later.push(p) },
    });
    expect(later).toHaveLength(0);
  });
});

describe("Due reminders: the filtered endpoint (18 Nov)", () => {
  const fromOf = () => new URLSearchParams(due.calls.find((c) => c.method === "GET")!.search).get("from");

  it("asks for her reminders from the start of yesterday in her zone", async () => {
    await put([{ table: "prefs", data: prefsRow() }]);
    await runAt(MORNING);
    expect(due.calls[0]).toMatchObject({ method: "GET", path: "/due/api/reminders" });
    expect(new URLSearchParams(due.calls[0]!.search).get("type")).toBe("esmeworld");
    expect(fromOf()).toBe("2026-11-15T00:00:00-05:00");
  });

  it("before 3am her day is still the day before, so `from` goes back one more", async () => {
    await put([{ table: "prefs", data: prefsRow() }]);
    await runAt(at("2026-11-17T02:00:00"));
    expect(fromOf()).toBe("2026-11-15T00:00:00-05:00");
  });

  it("in another zone, `from` carries that zone's offset", async () => {
    await put([{ table: "prefs", data: prefsRow({ timeZone: "Europe/Paris" }) }]);
    await runAt(MORNING); // 14:00 in Paris
    expect(fromOf()).toBe("2026-11-15T00:00:00+01:00");
  });

  it("a body it can't read: the stop log has the status and the shape, never values or the token", async () => {
    await put([{ table: "prefs", data: prefsRow() }]);
    due.listBody = { data: { items: [{ id: "esmeworld-x", title: "Private title" }] }, "Private key": 1 };
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => void logged.push(args));
    await runAt(MORNING);
    spy.mockRestore();
    expect(logged).toEqual([["due_reminders_stopped", "due_bad_state", "status=200", "shape={data:{items:array},+1}"]]);
    expect(JSON.stringify(logged)).not.toMatch(/Private|esmeworld-x/);
    expect(JSON.stringify(logged)).not.toContain(FAKE_DUE_TOKEN);
    expect(due.mutations()).toEqual([]);
  });

  it("a non-2xx answer logs its status", async () => {
    await put([{ table: "prefs", data: prefsRow() }]);
    due.failWith = 404;
    const logged: unknown[][] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args) => void logged.push(args));
    await runAt(MORNING);
    spy.mockRestore();
    expect(logged).toEqual([["due_reminders_stopped", "due_bad_state", "status=404"]]);
  });
});
