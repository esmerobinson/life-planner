import Dexie from "dexie";
import { vi } from "vitest";
import { HubDB } from "../data/db";
import type { Item } from "../domain/types";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings } from "./engine";
import { SYNC_DEBOUNCE_MS, SYNC_INTERVAL_MS, SyncController, type Timers } from "./controller";

const TOKEN = "beef".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";

/** Hand-driven timers, so tests never wait for real time. */
class ManualTimers implements Timers {
  /** Called with each step of time, so the test clock moves with the timers. */
  constructor(private readonly onAdvance: (ms: number) => void = (ms) => (clock += ms)) {}
  private now = 0;
  private next = 1;
  private tasks = new Map<number, { at: number; fn: () => void; every?: number }>();
  setTimeout = (fn: () => void, ms: number) => {
    const id = this.next++;
    this.tasks.set(id, { at: this.now + ms, fn });
    return id;
  };
  clearTimeout = (id: unknown) => void this.tasks.delete(id as number);
  setInterval = (fn: () => void, ms: number) => {
    const id = this.next++;
    this.tasks.set(id, { at: this.now + ms, fn, every: ms });
    return id;
  };
  clearInterval = (id: unknown) => void this.tasks.delete(id as number);
  advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const due = [...this.tasks.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, t] = due;
      this.onAdvance(t.at - this.now);
      this.now = t.at;
      if (t.every) t.at += t.every;
      else this.tasks.delete(id);
      t.fn();
    }
    this.onAdvance(end - this.now);
    this.now = end;
  }
}

const item = (id: string): Item => ({
  id, kind: "task", title: id, links: [], areaId: "art", priority: 2,
  status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01",
});

let n = 0;
let clock = 1_800_000_000_000;
const cleanup: (() => unknown)[] = [];

beforeEach(() => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  setVisibility("visible");
});
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn();
  vi.restoreAllMocks();
});

function setVisibility(v: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
}

async function setup(opts: { configured?: boolean; fetch?: typeof fetch } = {}) {
  const db = new HubDB(`controller-${++n}`);
  cleanup.push(async () => {
    db.close();
    await Dexie.delete(db.name);
  });
  if (opts.configured ?? true) await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  const server = new FakeSyncServer(TOKEN);
  const fetch = vi.fn(opts.fetch ?? server.fetch);
  const timers = new ManualTimers();
  const onSynced = vi.fn();
  const controller = new SyncController({ db, fetch, timers });
  return { db, server, fetch, timers, controller, onSynced };
}

function started(c: SyncController, onSynced?: () => void) {
  const stop = c.start({ onSynced });
  cleanup.push(stop);
  return stop;
}

describe("SyncController", () => {
  it("syncs on start, and the state shows lastSyncedAt and the pending count", async () => {
    const { db, fetch, controller } = await setup();
    await db.items.add(item("a"));
    started(controller);
    await vi.waitFor(() => expect(controller.getState().lastSyncedAt).toBe(clock));
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({ status: "idle", pendingCount: 0, configured: true }));
  });

  it("never syncs without a token or address", async () => {
    const { db, fetch, timers, controller } = await setup({ configured: false });
    started(controller);
    await db.items.add(item("a"));
    timers.advance(SYNC_INTERVAL_MS * 3);
    window.dispatchEvent(new Event("online"));
    await controller.syncNow();
    expect(fetch).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(controller.getState()).toMatchObject({ configured: false, pendingCount: 1 }));
  });

  it("syncs a short debounce after local writes, once for a burst", async () => {
    const { db, server, fetch, timers, controller } = await setup();
    started(controller);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(controller.getState().status).toBe("idle"));
    await db.items.add(item("a"));
    await db.items.add(item("b"));
    await db.items.update("a", { title: "a2" });
    timers.advance(SYNC_DEBOUNCE_MS - 1);
    expect(fetch).toHaveBeenCalledTimes(1);
    timers.advance(1);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(server.rows.size).toBe(2));
  });

  it("syncs when the browser comes online, when the tab becomes visible, and every interval while visible", async () => {
    const { fetch, timers, controller } = await setup();
    started(controller);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const settled = () => vi.waitFor(() => expect(controller.getState().status).not.toBe("syncing"));
    await settled();
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await settled();
    setVisibility("hidden");
    timers.advance(SYNC_INTERVAL_MS);
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetch).toHaveBeenCalledTimes(2); // hidden: no interval sync
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    await settled();
    timers.advance(SYNC_INTERVAL_MS);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(4));
  });

  it("never runs two syncs at once", async () => {
    let inFlight = 0;
    let most = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const server = new FakeSyncServer(TOKEN);
    const slow: typeof globalThis.fetch = async (input, init) => {
      inFlight++;
      most = Math.max(most, inFlight);
      await gate;
      try {
        return await server.fetch(input, init);
      } finally {
        inFlight--;
      }
    };
    const { db, fetch, timers, controller } = await setup({ fetch: slow });
    await db.items.add(item("a"));
    started(controller);
    const manual = [controller.syncNow(), controller.syncNow()];
    window.dispatchEvent(new Event("online"));
    timers.advance(SYNC_INTERVAL_MS);
    await new Promise((r) => setTimeout(r, 20));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe("syncing");
    release();
    await Promise.all(manual);
    await vi.waitFor(() => expect(controller.getState().status).toBe("idle"));
    expect(most).toBe(1);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(2); // the run, plus at most one follow-up
  });

  it("after 401 it asks for the passphrase and stops syncing by itself", async () => {
    const { db, server, fetch, timers, controller } = await setup();
    server.inject({ status: 401, body: { error: "unauthorized" } });
    started(controller);
    await vi.waitFor(() => expect(controller.getState().status).toBe("needs-passphrase"));
    expect(controller.getState().message).toBe("The passphrase was not accepted. Enter it again to keep syncing.");
    await db.items.add(item("a"));
    timers.advance(SYNC_DEBOUNCE_MS + SYNC_INTERVAL_MS * 5);
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(controller.getState().status).toBe("needs-passphrase");
  });

  it("after 429 it waits for Retry-After before trying again", async () => {
    const { db, server, fetch, timers, controller } = await setup();
    await db.items.add(item("a"));
    server.inject({ status: 429, body: { error: "rate_limited" }, headers: { "Retry-After": "90" } });
    started(controller);
    await vi.waitFor(() => expect(controller.getState().status).toBe("error"));
    expect(fetch).toHaveBeenCalledTimes(1);
    timers.advance(30_000);
    window.dispatchEvent(new Event("online"));
    await controller.syncNow();
    expect(fetch).toHaveBeenCalledTimes(1); // still waiting, even when asked
    timers.advance(60_000);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(server.rows.size).toBe(1));
  });

  it("tells the app to refresh after rows arrive from the server", async () => {
    const { server, controller } = await setup();
    // Another device already put a row on the server.
    const other = new HubDB(`controller-${++n}`);
    cleanup.push(async () => {
      other.close();
      await Dexie.delete(other.name);
    });
    await saveSyncSettings(other, { serverUrl: SERVER, token: TOKEN });
    await other.items.add(item("from-elsewhere"));
    const otherController = new SyncController({ db: other, fetch: server.fetch, timers: new ManualTimers() });
    await otherController.syncNow();
    const onSynced = vi.fn();
    started(controller, onSynced);
    await vi.waitFor(() => expect(onSynced).toHaveBeenCalledTimes(1));
  });
});
