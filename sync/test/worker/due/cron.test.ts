import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_CALLS_PER_RUN, runDueReminders, SYNC_RUN_GAP_MS } from "../../../src/due/cron";
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

const todo = (id: string, p: Record<string, unknown> = {}) => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "admin", priority: 2, status: "open",
  createdAt: "2026-11-01", touchedAt: "2026-11-01", updatedAt: 10, ...p,
});
const prefsRow = (p: Record<string, unknown> = {}) => ({ id: "due", on: true, timeZone: "America/New_York", ...p });

/** Puts rows on the server the way the app does (a sync), stamped `stamp`. */
async function put(rows: { table: string; data: Record<string, unknown> }[], stamp = MORNING - 1000) {
  await syncOk(DEVICE_A, 0, rows.map((r) => change(String(r.data.id), stamp, { ...r.data, updatedAt: stamp }, r.table)), { now: MORNING });
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
    expect(due.activeIds()).toEqual([
      "esmeworld-2026-11-16-at-meeting-1500",
      "esmeworld-2026-11-16-due1-habit",
      "esmeworld-2026-11-16-due1-late",
      "esmeworld-2026-11-16-due2-habit",
      "esmeworld-2026-11-16-due2-late",
      "esmeworld-2026-11-16-plan",
      "esmeworld-2026-11-16-review",
    ]);
    expect(due.reminders.get("esmeworld-2026-11-16-at-meeting-1500")).toMatchObject({ title: "Pretend meeting", dueAt: "2026-11-16T14:45:00-05:00" });
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
    expect(due.activeIds()).toContain("esmeworld-2026-11-16-due1-a");
    await put([{ table: "items", data: todo("a", { due: "2026-11-16", status: "done", completedAt: "2026-11-16" }) }], MORNING);
    await runAt(MORNING + 15 * 60_000);
    expect(due.activeIds()).toEqual(["esmeworld-2026-11-16-plan", "esmeworld-2026-11-16-review"]);
  });

  it("a habit ticked today stops its reminders and the nudge", async () => {
    await put([{ table: "prefs", data: prefsRow() }, { table: "items", data: todo("h", { recur: ["mon"] }) }]);
    await runAt(at("2026-11-16T12:45:00"));
    expect(due.activeIds()).toContain("esmeworld-2026-11-16-nudge");
    expect(due.activeIds()).toContain("esmeworld-2026-11-16-due2-h");
    await put([{ table: "items", data: todo("h", { recur: ["mon"], doneDates: ["2026-11-16"] }) }], MORNING);
    await runAt(at("2026-11-16T12:50:00"));
    expect(due.activeIds()).toEqual(["esmeworld-2026-11-16-review"]);
  });

  it("the nudge uses her own lines", async () => {
    await put([{ table: "prefs", data: prefsRow({ lines: ["You've got this, pretend"] }) }]);
    await runAt(at("2026-11-16T12:45:00"));
    expect(due.reminders.get("esmeworld-2026-11-16-nudge")!.title).toBe("You've got this, pretend");
  });

  it("turning Due off cancels what's there", async () => {
    await put([{ table: "prefs", data: prefsRow() }]);
    await runAt(MORNING);
    expect(due.activeIds()).toHaveLength(2);
    await put([{ table: "prefs", data: prefsRow({ on: false }) }], MORNING);
    await runAt(MORNING + 60_000);
    expect(due.activeIds()).toEqual([]);
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
    expect(logged).toEqual([["due_reminders_stopped", "due_server_error"]]);
    expect(JSON.stringify(logged)).not.toContain(FAKE_DUE_TOKEN);
    due.failWith = null;
    await runAt(MORNING + 15 * 60_000);
    expect(due.activeIds()).toHaveLength(2);
  });

  it("never more than the call budget in one run", async () => {
    expect(MAX_CALLS_PER_RUN).toBeLessThan(50);
    // 40 stale reminders to cancel and a full day to create.
    for (let i = 0; i < 45; i++) due.seed({ id: `esmeworld-2026-11-15-due1-x${i}` });
    await put([
      { table: "prefs", data: prefsRow() },
      ...Array.from({ length: 12 }, (_, i) => ({ table: "items", data: todo(`t${i}`, { due: "2026-11-16" }) })),
    ]);
    await runAt(MORNING);
    expect(due.calls.length).toBeLessThanOrEqual(MAX_CALLS_PER_RUN);
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
    expect(due.activeIds()).toContain("esmeworld-2026-11-16-due1-a");

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
    expect(due.activeIds()).toContain("esmeworld-2026-11-16-due1-a");
    release();
    await Promise.all(later);
    expect(due.activeIds()).not.toContain("esmeworld-2026-11-16-due1-a");
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
    await tick(1, MORNING, withToken);
    await tick(2, MORNING + 1000, withToken);
    await tick(3, MORNING + SYNC_RUN_GAP_MS + 1, withToken);
    await Promise.all(later);
    expect(due.calls.filter((c) => c.method === "GET")).toHaveLength(2);
  });

  it("an ordinary edit (nothing ticked) doesn't start a run", async () => {
    const later: Promise<unknown>[] = [];
    await sync(DEVICE_A, 0, [change("e", MORNING, todo("e", { updatedAt: MORNING }))], {
      now: MORNING, envOverride: { DUE_TOKEN: FAKE_DUE_TOKEN, DUE_BASE_URL: FAKE_DUE_URL }, deps: { dueFetch: due.fetch, waitUntil: (p) => void later.push(p) },
    });
    expect(later).toHaveLength(0);
  });
});
