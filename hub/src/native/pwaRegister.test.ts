import { registered } from "../test/pwa-register-stub";
import { applyWaitingBeforeFirstPaint, startPwaUpdates } from "./pwaRegister";
import { AUTO_UPDATE_KEY, getAppUpdater, setAppUpdater } from "./pwaUpdate";
import { NATIVE_PREPARE_RELOAD } from "./appUpdate";
import { syncController } from "../sync";
import type { SyncState } from "../sync/controller";

const w = window as unknown as Record<string, unknown>;

afterEach(() => {
  getAppUpdater()?.dispose();
  setAppUpdater(null);
  delete w[NATIVE_PREPARE_RELOAD];
  vi.restoreAllMocks();
});

describe("starting the phone's automatic updates", () => {
  it("registers the service worker and becomes the app's updater", () => {
    const stop = startPwaUpdates();
    expect(registered.options?.immediate).toBe(true);
    expect(getAppUpdater()).not.toBeNull();
    stop();
    expect(getAppUpdater()).toBeNull();
  });

  it("looks for a new version as soon as the service worker is registered (on start)", async () => {
    const stop = startPwaUpdates();
    const update = vi.fn(async () => {});
    await new Promise((r) => setTimeout(r, 20)); // registering takes a moment
    registered.options!.onRegisteredSW!("/sw.js", { update } as unknown as ServiceWorkerRegistration);
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    stop();
  });

  it("switches by itself on the web, asking the Mac's save-first check", async () => {
    const prepare = vi.fn(async () => ({ ready: true, reason: "" }));
    w[NATIVE_PREPARE_RELOAD] = prepare;
    const before = registered.updates;
    const stop = startPwaUpdates();
    registered.options!.onNeedRefresh!();
    await vi.waitFor(() => expect(registered.updates).toBe(before + 1));
    expect(prepare).toHaveBeenCalled();
    stop();
  });

  it("in the Mac app (esmeworld://) never switches by itself: its shell does", async () => {
    const prepare = vi.fn(async () => ({ ready: true, reason: "" }));
    w[NATIVE_PREPARE_RELOAD] = prepare;
    const before = registered.updates;
    const stop = startPwaUpdates({ protocol: "esmeworld:" });
    registered.options!.onNeedRefresh!();
    await new Promise((r) => setTimeout(r, 20));
    expect(prepare).not.toHaveBeenCalled();
    expect(registered.updates).toBe(before);
    expect(getAppUpdater()!.getState().showNote).toBe(true);
    stop();
  });

  it("waits while a sync is running", async () => {
    const prepare = vi.fn(async () => ({ ready: true, reason: "" }));
    w[NATIVE_PREPARE_RELOAD] = prepare;
    const real = syncController.getState();
    vi.spyOn(syncController, "getState").mockReturnValue({ ...real, status: "syncing" } as SyncState);
    const stop = startPwaUpdates();
    registered.options!.onNeedRefresh!();
    await new Promise((r) => setTimeout(r, 20));
    expect(prepare).not.toHaveBeenCalled();
    stop();
  });

  it("without the save-first check on the page, never switches", async () => {
    const before = registered.updates;
    const stop = startPwaUpdates();
    registered.options!.onNeedRefresh!();
    await new Promise((r) => setTimeout(r, 20));
    expect(registered.updates).toBe(before);
    stop();
  });
});

describe("a version already waiting when the app opens: taken before the first paint (no flash)", () => {
  type Listener = () => void;
  function fakeSW(opts: { controlled: boolean; waiting: boolean }) {
    const listeners: Listener[] = [];
    const posted: unknown[] = [];
    const waiting = opts.waiting ? { postMessage: (m: unknown) => posted.push(m) } : null;
    const sw = {
      controller: opts.controlled ? {} : null,
      getRegistration: async () => ({ waiting }),
      addEventListener: (_: string, fn: Listener) => listeners.push(fn),
      removeEventListener: (_: string, fn: Listener) => listeners.splice(listeners.indexOf(fn), 1),
    };
    return { sw, posted, takeOver: () => [...listeners].forEach((f) => f()) };
  }

  beforeEach(() => sessionStorage.clear());

  it("asks the waiting version to take over, then reloads onto it (and the app is not drawn)", async () => {
    const f = fakeSW({ controlled: true, waiting: true });
    const reload = vi.fn();
    const p = applyWaitingBeforeFirstPaint({ sw: f.sw as never, reload, protocol: "https:" });
    await vi.waitFor(() => expect(f.posted).toEqual([{ type: "SKIP_WAITING" }]));
    f.takeOver();
    expect(await p).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("nothing waiting: draws the app at once", async () => {
    const f = fakeSW({ controlled: true, waiting: false });
    expect(await applyWaitingBeforeFirstPaint({ sw: f.sw as never, reload: vi.fn(), protocol: "https:" })).toBe(false);
  });

  it("the takeover is slow: draws the app after a moment and leaves the rest to the safe path", async () => {
    const f = fakeSW({ controlled: true, waiting: true });
    const reload = vi.fn();
    const p = applyWaitingBeforeFirstPaint({ sw: f.sw as never, reload, protocol: "https:", timeoutMs: 30 });
    expect(await p).toBe(false);
    f.takeOver(); // too late: no blind reload over a drawn app
    expect(reload).not.toHaveBeenCalled();
  });

  it("not in the Mac app, not on a page no worker controls, not right after an automatic switch", async () => {
    for (const [opts, protocol, guard] of [
      [{ controlled: true, waiting: true }, "esmeworld:", false],
      [{ controlled: false, waiting: true }, "https:", false],
      [{ controlled: true, waiting: true }, "https:", true],
    ] as const) {
      sessionStorage.clear();
      if (guard) sessionStorage.setItem(AUTO_UPDATE_KEY, String(Date.now()));
      const f = fakeSW(opts);
      expect(await applyWaitingBeforeFirstPaint({ sw: f.sw as never, reload: vi.fn(), protocol, timeoutMs: 30 })).toBe(false);
      expect(f.posted).toEqual([]);
    }
  });

  it("remembers the switch (the loop guard)", async () => {
    const f = fakeSW({ controlled: true, waiting: true });
    const p = applyWaitingBeforeFirstPaint({ sw: f.sw as never, reload: vi.fn(), protocol: "https:" });
    await vi.waitFor(() => expect(f.posted).toHaveLength(1));
    f.takeOver();
    await p;
    expect(Number(sessionStorage.getItem(AUTO_UPDATE_KEY))).toBeGreaterThan(0);
  });
});
