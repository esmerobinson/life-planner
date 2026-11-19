import {
  AUTO_UPDATE_KEY, CHECK_EVERY_MS, IDLE_MS, LOOP_GUARD_MS, NOTE_AFTER_MS, RETRY_MS, createAutoUpdater,
} from "./pwaUpdate";
import type { PrepareResult } from "./appUpdate";

/** Pretends the page went to the background (hidden) or came back (visible). */
function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

function fakeEnv(over: { auto?: boolean } = {}) {
  const log: string[] = [];
  const env = {
    auto: over.auto ?? true,
    hold: null as string | null,
    prepareAnswer: { ready: true, reason: "" } as PrepareResult,
    minIdles: [] as number[],
    /** Replaces the plain answers when set. */
    holdFn: null as null | (() => string | null),
    prepareFn: null as null | (() => Promise<PrepareResult>),
  };
  const updater = createAutoUpdater({
    auto: env.auto,
    check: async () => {
      log.push("check");
    },
    activate: () => {
      log.push("activate");
    },
    reload: () => log.push("reload"),
    prepare: async (minIdleMs) => {
      env.minIdles.push(minIdleMs);
      log.push("prepare");
      return env.prepareFn ? env.prepareFn() : env.prepareAnswer;
    },
    flush: async () => {
      log.push("flush");
    },
    hold: () => (env.holdFn ? env.holdFn() : env.hold),
  });
  return { log, env, updater };
}

/** Lets the updater's awaits run (fake timers do not run promises by themselves). */
const settle = () => vi.advanceTimersByTimeAsync(0);

let current: ReturnType<typeof fakeEnv> | null = null;
function make(over: { auto?: boolean } = {}) {
  current = fakeEnv(over);
  return current;
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
  sessionStorage.clear();
});
afterEach(() => {
  current?.updater.dispose();
  current = null;
  vi.useRealTimers();
  delete (document as unknown as { visibilityState?: string }).visibilityState;
});

describe("looking for a new version", () => {
  it("looks on start", async () => {
    const { log } = make();
    await settle();
    expect(log).toEqual(["check"]);
  });

  it("looks again whenever the app comes back into view", async () => {
    const { log } = make();
    await settle();
    await vi.advanceTimersByTimeAsync(60_000);
    setVisibility("hidden");
    setVisibility("visible");
    await settle();
    expect(log.filter((l) => l === "check")).toHaveLength(2);
  });

  it("also on pageshow (back from the iPhone's page cache), but not twice for one return", async () => {
    const { log } = make();
    await vi.advanceTimersByTimeAsync(60_000);
    setVisibility("hidden");
    setVisibility("visible");
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await settle();
    expect(log.filter((l) => l === "check")).toHaveLength(2);
  });

  it("every 30 minutes while in view, never while in the background", async () => {
    const { log } = make();
    await settle();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(log.filter((l) => l === "check")).toHaveLength(2);
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 3);
    expect(log.filter((l) => l === "check")).toHaveLength(2);
  });

  it("a failed look (offline) changes nothing", async () => {
    const updater = createAutoUpdater({
      auto: true,
      check: () => Promise.reject(new TypeError("offline")),
      activate: () => {},
      reload: () => {},
      prepare: async () => ({ ready: true, reason: "" }),
      flush: async () => {},
      hold: () => null,
    });
    await settle();
    expect(updater.getState()).toEqual({ waiting: false, showNote: false });
    updater.dispose();
  });
});

describe("taking a new version by itself", () => {
  it("on open, with nothing in the way: saves, switches, reloads; no note", async () => {
    const { log, updater, env } = make();
    await settle();
    updater.needRefresh();
    await settle();
    expect(log).toEqual(["check", "prepare", "activate"]);
    expect(env.minIdles).toEqual([0]); // nothing touched since it opened
    updater.needReload(); // the new version took over
    expect(log.at(-1)).toBe("reload");
    expect(updater.getState().showNote).toBe(false);
  });

  it("on coming back into view: takes it at once", async () => {
    const { log, updater, env } = make();
    await settle();
    setVisibility("hidden");
    updater.needRefresh(); // found while away: waits for her to come back
    await settle();
    expect(log).not.toContain("activate");
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    setVisibility("visible");
    await settle();
    expect(log.at(-1)).toBe("activate");
    expect(env.minIdles.at(-1)).toBe(0);
  });

  it("asks the Mac's check for no input since she came back, or none for 30 s", async () => {
    const { updater, env } = make();
    env.prepareAnswer = { ready: false, reason: "typing" };
    await settle();
    await vi.advanceTimersByTimeAsync(4_000);
    updater.needRefresh();
    await settle();
    expect(env.minIdles).toEqual([4_000]);
    await vi.advanceTimersByTimeAsync(RETRY_MS * 4);
    expect(Math.max(...env.minIdles)).toBe(IDLE_MS);
  });

  it("while she is typing: waits, and takes it once she has stopped", async () => {
    const { log, updater, env } = make();
    env.prepareAnswer = { ready: false, reason: "typing" };
    await settle();
    updater.needRefresh();
    await settle();
    expect(log).not.toContain("activate");
    env.prepareAnswer = { ready: true, reason: "" };
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(log.at(-1)).toBe("activate");
  });

  it("an open sheet with text, the journal, a sync: waits without even saving, then takes it", async () => {
    for (const reason of ["sheet", "journal", "syncing", "editing"]) {
      sessionStorage.clear(); // (each round is a fresh page)
      const { log, updater, env } = make();
      env.hold = reason;
      await settle();
      updater.needRefresh();
      await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
      expect(log).toEqual(["check"]);
      env.hold = null;
      await vi.advanceTimersByTimeAsync(RETRY_MS);
      expect(log).toEqual(["check", "prepare", "activate"]);
      updater.dispose();
    }
  });

  it("something opened while it was saving: does not switch", async () => {
    const { log, updater, env } = make();
    await settle();
    let calls = 0;
    // Clear before saving, then a sheet with text is open.
    env.holdFn = () => (calls++ === 0 ? null : "sheet");
    updater.needRefresh();
    await settle();
    expect(log).toEqual(["check", "prepare"]);
  });

  it("not while in the background (only on coming back or while in view)", async () => {
    const { log, updater } = make();
    await settle();
    setVisibility("hidden");
    updater.needRefresh();
    await vi.advanceTimersByTimeAsync(RETRY_MS * 5);
    expect(log).toEqual(["check"]);
  });

  it("hidden while it was saving: does not switch then", async () => {
    const { log, updater, env } = make();
    await settle();
    let release: (r: PrepareResult) => void = () => {};
    const slow = new Promise<PrepareResult>((r) => (release = r));
    env.prepareFn = () => slow;
    updater.needRefresh();
    setVisibility("hidden");
    release({ ready: true, reason: "" });
    await settle();
    expect(log).not.toContain("activate");
  });

  it("if the new version never takes over, reloads anyway (then the loop guard decides)", async () => {
    const { log, updater } = make();
    await settle();
    updater.needRefresh();
    await settle();
    expect(log.at(-1)).toBe("activate");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(log.at(-1)).toBe("reload");
  });
});

describe("the note (A new version is ready · Reload)", () => {
  it("is not shown while the automatic update is just waiting a little", async () => {
    const { updater, env } = make();
    env.hold = "sheet";
    await settle();
    updater.needRefresh();
    await vi.advanceTimersByTimeAsync(NOTE_AFTER_MS - RETRY_MS);
    expect(updater.getState()).toEqual({ waiting: true, showNote: false });
  });

  it("shows once it has been refused for a while in view", async () => {
    const { updater, env } = make();
    env.hold = "sheet";
    await settle();
    updater.needRefresh();
    await vi.advanceTimersByTimeAsync(NOTE_AFTER_MS + RETRY_MS);
    expect(updater.getState()).toEqual({ waiting: true, showNote: true });
  });

  it("time in the background does not count", async () => {
    const { updater, env } = make();
    env.hold = "journal";
    await settle();
    updater.needRefresh();
    await vi.advanceTimersByTimeAsync(RETRY_MS * 2);
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(NOTE_AFTER_MS * 10);
    setVisibility("visible");
    await vi.advanceTimersByTimeAsync(RETRY_MS * 2);
    expect(updater.getState().showNote).toBe(false);
  });

  it("tells whoever listens when it changes", async () => {
    const { updater } = make({ auto: false });
    const seen: boolean[] = [];
    updater.subscribe(() => seen.push(updater.getState().showNote));
    updater.needRefresh();
    expect(seen).toContain(true);
  });

  it("Reload saves first, then switches", async () => {
    const { log, updater, env } = make();
    env.hold = "journal";
    await settle();
    updater.needRefresh();
    await updater.reloadNow();
    expect(log.slice(-2)).toEqual(["flush", "activate"]);
    updater.needReload();
    expect(log.at(-1)).toBe("reload");
  });
});

describe("never fighting the Mac app, never looping", () => {
  it("in the Mac app: never switches by itself; the note shows at once, as before", async () => {
    const { log, updater } = make({ auto: false });
    await settle();
    updater.needRefresh();
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
    expect(log).not.toContain("prepare");
    expect(log).not.toContain("activate");
    expect(updater.getState().showNote).toBe(true);
  });

  it("just updated by itself and a version is waiting again: shows the note instead of reloading again", async () => {
    sessionStorage.setItem(AUTO_UPDATE_KEY, String(Date.now() - 1_000));
    const { log, updater } = make();
    await settle();
    updater.needRefresh();
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
    expect(log).not.toContain("activate");
    expect(updater.getState().showNote).toBe(true);
  });

  it("the guard lasts only a while", async () => {
    sessionStorage.setItem(AUTO_UPDATE_KEY, String(Date.now() - LOOP_GUARD_MS - 1));
    const { log, updater } = make();
    await settle();
    updater.needRefresh();
    await settle();
    expect(log).toContain("activate");
  });

  it("remembers that it switched (for the guard)", async () => {
    const { updater } = make();
    await settle();
    updater.needRefresh();
    await settle();
    expect(Number(sessionStorage.getItem(AUTO_UPDATE_KEY))).toBe(Date.now());
  });

  it("another tab switched versions while she types here: this page waits before reloading", async () => {
    const { log, updater, env } = make();
    env.prepareAnswer = { ready: false, reason: "typing" };
    await settle();
    updater.needReload();
    await settle();
    expect(log).not.toContain("reload");
    env.prepareAnswer = { ready: true, reason: "" };
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(log.at(-1)).toBe("reload");
    expect(log).not.toContain("activate");
  });
});
