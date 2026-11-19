import { registered } from "../test/pwa-register-stub";
import { startPwaUpdates } from "./pwaRegister";
import { getAppUpdater, setAppUpdater } from "./pwaUpdate";
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
