import { TogetherRunner, type SyncWatch } from "./runner";

function fakeSync(): SyncWatch & { set(s: { status: string; lastSyncedAt: number | null }): void } {
  let state = { status: "idle", lastSyncedAt: 100 as number | null };
  const fns = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (fn) => (fns.add(fn), () => fns.delete(fn)),
    set(s) {
      state = s;
      for (const fn of fns) fn();
    },
  };
}

it("runs after each finished sync run, never during one, and not on an old sync time", async () => {
  const send = vi.fn(async () => ({ kind: "ok" as const, sent: 0, refused: 0 }));
  const r = new TogetherRunner(send);
  const sync = fakeSync();
  const stop = r.start(sync);
  sync.set({ status: "idle", lastSyncedAt: 100 }); // nothing new
  sync.set({ status: "syncing", lastSyncedAt: 200 }); // mid-run (a page saved)
  expect(send).not.toHaveBeenCalled();
  sync.set({ status: "idle", lastSyncedAt: 200 }); // the run finished
  expect(send).toHaveBeenCalledTimes(1);
  sync.set({ status: "error", lastSyncedAt: 200 }); // a failed run: no newer sync time
  expect(send).toHaveBeenCalledTimes(1);
  stop();
  sync.set({ status: "idle", lastSyncedAt: 300 });
  expect(send).toHaveBeenCalledTimes(1);
  await r.getState().running;
});

it("Send now tries again what was set aside, and keeps the outcome for the box", async () => {
  const send = vi.fn(async (o: { retryRefused?: boolean }) => ({ kind: "ok" as const, sent: o.retryRefused ? 1 : 0, refused: 0 }));
  const r = new TogetherRunner(send);
  expect(await r.sendNow()).toEqual({ kind: "ok", sent: 1, refused: 0 });
  expect(send).toHaveBeenCalledWith({ retryRefused: true });
  expect(r.getState()).toEqual({ running: false, last: { kind: "ok", sent: 1, refused: 0 } });
});

it("while answers are held after a Replace: runs on app start and sync-state changes without a new sync, at most once a minute (bug #68)", async () => {
  let held = true;
  const send = vi.fn(async () => ({ kind: "ok" as const, sent: 0, refused: 0 }));
  const r = new TogetherRunner(send, async () => held);
  const sync = fakeSync();
  const stop = r.start(sync); // the app opening
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  sync.set({ status: "idle", lastSyncedAt: 100 }); // a state change, no new sync: within the minute
  await new Promise((res) => setTimeout(res, 10));
  expect(send).toHaveBeenCalledTimes(1);
  held = false;
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 61_000);
  sync.set({ status: "idle", lastSyncedAt: 100 }); // not held any more: nothing
  await new Promise((res) => setTimeout(res, 10));
  expect(send).toHaveBeenCalledTimes(1);
  vi.restoreAllMocks();
  stop();
});
