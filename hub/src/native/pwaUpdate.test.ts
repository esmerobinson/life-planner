import {
  AUTO_UPDATE_KEY, CHECK_EVERY_MS, FRESH_MS, IDLE_MS, LOOP_GUARD_MS, NOTE_AFTER_MS, RETRY_MS, TAKEOVER_WAIT_MS,
  createAutoUpdater,
} from "./pwaUpdate";
import type { PrepareResult } from "./appUpdate";

/** Pretends the page went to the background (hidden) or came back (visible). */
function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

function fakeEnv(over: { auto?: boolean; controlled?: boolean } = {}) {
  const log: string[] = [];
  const env = {
    auto: over.auto ?? true,
    controlled: over.controlled ?? true,
    hold: null as string | null,
    prepareAnswer: { ready: true, reason: "" } as PrepareResult,
    minIdles: [] as number[],
    activity: 0,
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
    activity: () => env.activity,
    controlled: () => env.controlled,
  });
  return { log, env, updater };
}

/** Lets the updater's awaits run (fake timers do not run promises by themselves). */
const settle = () => vi.advanceTimersByTimeAsync(0);

let current: ReturnType<typeof fakeEnv> | null = null;
function make(over: { auto?: boolean; controlled?: boolean } = {}) {
  current = fakeEnv(over);
  return current;
}

/** Leaves the app for a while and comes back. */
async function leaveAndComeBack(ms = 5 * 60_000) {
  setVisibility("hidden");
  await vi.advanceTimersByTimeAsync(ms);
  setVisibility("visible");
  await settle();
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

  it("looks again on leaving (so it is ready on return) and on coming back", async () => {
    const { log } = make();
    await settle();
    await leaveAndComeBack();
    expect(log.filter((l) => l === "check")).toHaveLength(3);
  });

  it("a return right after the start-up look still looks (fix round 1, M8)", async () => {
    const { log } = make();
    await settle();
    setVisibility("hidden");
    setVisibility("visible");
    await settle();
    expect(log.filter((l) => l === "check").length).toBeGreaterThanOrEqual(2);
  });

  it("pageshow and visibilitychange for one return look once", async () => {
    const { log } = make();
    await vi.advanceTimersByTimeAsync(60_000);
    setVisibility("hidden");
    await settle();
    const before = log.filter((l) => l === "check").length;
    setVisibility("visible");
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    await settle();
    expect(log.filter((l) => l === "check")).toHaveLength(before + 1);
  });

  it("every 30 minutes while in view, never while in the background", async () => {
    const { log } = make();
    await settle();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(log.filter((l) => l === "check")).toHaveLength(2);
    setVisibility("hidden");
    await settle();
    const before = log.filter((l) => l === "check").length;
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS * 3);
    expect(log.filter((l) => l === "check")).toHaveLength(before);
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
      activity: () => 0,
      controlled: () => true,
    });
    await settle();
    expect(updater.getState()).toEqual({ waiting: false, showNote: false });
    updater.dispose();
  });
});

describe("when it switches", () => {
  it("coming back with a version already waiting: switches at once, before anything is touched", async () => {
    const { log, updater, env } = make();
    await settle();
    setVisibility("hidden");
    updater.needRefresh(); // found while away
    await settle();
    expect(log).not.toContain("activate");
    await vi.advanceTimersByTimeAsync(60_000);
    setVisibility("visible");
    await settle();
    expect(log.at(-1)).toBe("activate");
    expect(env.minIdles.at(-1)).toBe(0); // nothing touched since coming back
    updater.needReload(); // the new version took over
    expect(log.at(-1)).toBe("reload");
    expect(updater.getState().showNote).toBe(false);
  });

  it("a version that turns up a few seconds into a visit waits for 30 s untouched (no reload flash while she reads)", async () => {
    const { log, updater, env } = make();
    await settle();
    await vi.advanceTimersByTimeAsync(FRESH_MS + 3_000);
    updater.needRefresh();
    await settle();
    expect(env.minIdles).toEqual([IDLE_MS]);
  });

  it("on opening (after the first paint), a version found waits for 30 s untouched as well", async () => {
    const { updater, env } = make();
    await settle();
    updater.needRefresh();
    await settle();
    expect(env.minIdles).toEqual([IDLE_MS]);
  });

  it("the Mac's check refuses (typing): waits, and takes it once she has stopped", async () => {
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

  it("anything held (edited page, a sheet, Edit mode, a sync, pairing): waits without even saving", async () => {
    for (const reason of ["edited", "sheet", "editing", "syncing", "pairing", "camera"]) {
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

  it("something held while it was saving: does not switch", async () => {
    const { log, updater, env } = make();
    await settle();
    let calls = 0;
    env.holdFn = () => (calls++ === 0 ? null : "edited");
    updater.needRefresh();
    await settle();
    expect(log).toEqual(["check", "prepare"]);
  });

  it("never while in the background", async () => {
    const { log, updater } = make();
    await settle();
    setVisibility("hidden");
    updater.needRefresh();
    await vi.advanceTimersByTimeAsync(RETRY_MS * 5);
    expect(log).not.toContain("activate");
  });

  it("hidden while it was saving: does not switch then", async () => {
    const { log, updater, env } = make();
    await settle();
    let release: (r: PrepareResult) => void = () => {};
    env.prepareFn = () => new Promise<PrepareResult>((r) => (release = r));
    updater.needRefresh();
    await settle();
    setVisibility("hidden");
    release({ ready: true, reason: "" });
    await settle();
    expect(log).not.toContain("activate");
  });
});

describe("the last check, right before the reload (fix round 1, I3)", () => {
  it("she touched something after the decision: no reload when the new version takes over", async () => {
    const { log, updater, env } = make();
    await settle();
    updater.needRefresh();
    await settle();
    expect(log.at(-1)).toBe("activate");
    env.activity++; // she starts typing
    updater.needReload();
    expect(log).not.toContain("reload");
  });

  it("…and then reloads only once it is safe again, through the full check", async () => {
    const { log, updater, env } = make();
    await settle();
    updater.needRefresh();
    await settle();
    env.activity++;
    env.hold = "edited";
    updater.needReload();
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
    expect(log).not.toContain("reload");
    env.hold = null; // (a route change)
    const prepares = log.filter((l) => l === "prepare").length;
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(log.filter((l) => l === "prepare").length).toBe(prepares + 1);
    expect(log.at(-1)).toBe("reload");
    expect(log.filter((l) => l === "activate")).toHaveLength(1);
  });

  it("a hold that appeared after the decision (a sheet opened): no reload", async () => {
    const { log, updater, env } = make();
    await settle();
    updater.needRefresh();
    await settle();
    env.hold = "sheet";
    updater.needReload();
    expect(log).not.toContain("reload");
  });

  it("hidden after the decision: no reload until she is back", async () => {
    const { log, updater } = make();
    await settle();
    updater.needRefresh();
    await settle();
    setVisibility("hidden");
    updater.needReload();
    expect(log).not.toContain("reload");
    setVisibility("visible");
    await settle();
    expect(log.at(-1)).toBe("reload");
  });

  it("a controlled page whose new version never takes over: after 10 s, reloads only if nothing changed", async () => {
    const { log, updater } = make();
    await settle();
    updater.needRefresh();
    await settle();
    await vi.advanceTimersByTimeAsync(TAKEOVER_WAIT_MS);
    expect(log.at(-1)).toBe("reload");
  });

  it("…and does not reload after 10 s if she typed meanwhile", async () => {
    const { log, updater, env } = make();
    await settle();
    updater.needRefresh();
    await settle();
    env.activity++;
    env.hold = "edited";
    await vi.advanceTimersByTimeAsync(TAKEOVER_WAIT_MS + RETRY_MS * 3);
    expect(log).not.toContain("reload");
  });

  it("a page the worker does not control yet (first open after Add to Home Screen): no blind timer", async () => {
    const { log, updater } = make({ controlled: false });
    await settle();
    updater.needRefresh();
    await settle();
    expect(log.at(-1)).toBe("activate");
    await vi.advanceTimersByTimeAsync(TAKEOVER_WAIT_MS * 6);
    expect(log).not.toContain("reload");
  });

  it("…it reloads on the next return, if nothing is in the way", async () => {
    const { log, updater, env } = make({ controlled: false });
    await settle();
    updater.needRefresh();
    await settle();
    env.activity += 5; // she used the page meanwhile; nothing edited
    await leaveAndComeBack();
    expect(log.at(-1)).toBe("reload");
  });

  it("…and not on that return if she edited something meanwhile", async () => {
    const { log, updater, env } = make({ controlled: false });
    await settle();
    updater.needRefresh();
    await settle();
    env.hold = "edited";
    await leaveAndComeBack();
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
    expect(log).not.toContain("reload");
  });
});

describe("the note (A new version is ready · Reload)", () => {
  it("is not shown while the automatic update is just waiting a little", async () => {
    const { updater, env } = make();
    env.hold = "edited";
    await settle();
    updater.needRefresh();
    await vi.advanceTimersByTimeAsync(NOTE_AFTER_MS - RETRY_MS);
    expect(updater.getState()).toEqual({ waiting: true, showNote: false });
  });

  it("shows once it has been refused for a while in view", async () => {
    const { updater, env } = make();
    env.hold = "edited";
    await settle();
    updater.needRefresh();
    await vi.advanceTimersByTimeAsync(NOTE_AFTER_MS + RETRY_MS);
    expect(updater.getState()).toEqual({ waiting: true, showNote: true });
  });

  it("time in the background does not count", async () => {
    const { updater, env } = make();
    env.hold = "edited";
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

  it("Reload (her own tap) saves first, then switches and reloads", async () => {
    const { log, updater, env } = make();
    env.hold = "edited";
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
    await leaveAndComeBack(1_000);
    updater.needRefresh();
    await settle();
    expect(log).toContain("activate");
  });

  it("remembers that it switched (for the guard)", async () => {
    const { updater } = make();
    await settle();
    await leaveAndComeBack(1_000);
    updater.needRefresh();
    await settle();
    expect(Number(sessionStorage.getItem(AUTO_UPDATE_KEY))).toBe(Date.now());
  });

  it("another tab switched versions while this one has edits: this page waits before reloading", async () => {
    const { log, updater, env } = make();
    env.hold = "edited";
    await settle();
    updater.needReload();
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
    expect(log).not.toContain("reload");
    env.hold = null;
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(log.at(-1)).toBe("reload");
    expect(log).not.toContain("activate");
  });
});
