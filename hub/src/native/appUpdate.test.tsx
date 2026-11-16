import { render } from "@testing-library/react";
import { createUpdateHooks, installAppUpdateHooks, NATIVE_FLUSH, NATIVE_PREPARE_RELOAD } from "./appUpdate";
import { useHiddenFlush } from "../ui/useDraft";

function Saver({ onFlush }: { onFlush: () => void }) {
  useHiddenFlush(onFlush);
  return null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function openDb(name: string): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

/** A save like the journal's: some async work first (encryption), then a write. */
function slowSave(db: IDBDatabase, log: string[]): () => void {
  return () => {
    log.push("flush");
    void sleep(40).then(
      () =>
        new Promise<void>((res) => {
          const tx = db.transaction("kv", "readwrite");
          tx.objectStore("kv").put("typed words", "draft");
          tx.oncomplete = () => {
            log.push("written");
            res();
          };
        }),
    );
  };
}

let hooks: ReturnType<typeof createUpdateHooks> | null = null;
afterEach(() => {
  hooks?.dispose();
  hooks = null;
  sessionStorage.clear();
});

describe("flushing before the Mac app reloads onto a new version (bug #39)", () => {
  it("runs every mounted save-on-hide and waits for its write to land", async () => {
    const db = await openDb("flush-test-1");
    const log: string[] = [];
    hooks = createUpdateHooks({ settleMs: 120 });
    const { unmount } = render(<Saver onFlush={slowSave(db, log)} />);
    const result = await hooks.flushNow();
    log.push("flushNow resolved");
    expect(log).toEqual(["flush", "written", "flushNow resolved"]);
    expect(result.settled).toBe(true);
    unmount();
    db.close();
  });

  it("no longer calls a save whose page has gone", async () => {
    const calls: string[] = [];
    hooks = createUpdateHooks({ settleMs: 10 });
    const { unmount } = render(<Saver onFlush={() => calls.push("x")} />);
    unmount();
    await hooks.flushNow();
    expect(calls).toEqual([]);
  });

  it("waits for a save that returns a promise", async () => {
    const log: string[] = [];
    hooks = createUpdateHooks({ settleMs: 10 });
    // A flush may hand back its save (the fire-and-forget kind is covered by the IndexedDB test).
    const asPromise = (() => sleep(60).then(() => log.push("saved"))) as unknown as () => void;
    render(<Saver onFlush={asPromise} />);
    await hooks.flushNow();
    expect(log).toEqual(["saved"]);
  });

  it("is not ready while she is typing, and then does not flush", async () => {
    const calls: string[] = [];
    hooks = createUpdateHooks({ settleMs: 10 });
    render(<Saver onFlush={() => calls.push("flush")} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(await hooks.prepareReload(30_000)).toEqual({ ready: false, reason: "typing" });
    expect(calls).toEqual([]);
  });

  it("is ready when nothing was typed for long enough, after flushing", async () => {
    const calls: string[] = [];
    let t = 1_000_000;
    hooks = createUpdateHooks({ settleMs: 10, now: () => t });
    render(<Saver onFlush={() => calls.push("flush")} />);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    t += 31_000;
    const r = await hooks.prepareReload(30_000);
    expect(r).toEqual({ ready: true, reason: "" });
    expect(calls).toEqual(["flush"]);
  });

  it("is ready at once when the app is in the background (no idle wait)", async () => {
    hooks = createUpdateHooks({ settleMs: 10 });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));
    expect(await hooks.prepareReload(0)).toEqual({ ready: true, reason: "" });
  });

  it("is not ready in the middle of composing a character (accents, IME)", async () => {
    hooks = createUpdateHooks({ settleMs: 10 });
    window.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(await hooks.prepareReload(0)).toEqual({ ready: false, reason: "typing" });
    window.dispatchEvent(new CompositionEvent("compositionend"));
    expect((await hooks.prepareReload(0)).ready).toBe(true);
  });

  it("is not ready when she types during the flush", async () => {
    hooks = createUpdateHooks({ settleMs: 60 });
    const r = hooks.prepareReload(0);
    await sleep(10);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b" }));
    expect(await r).toEqual({ ready: false, reason: "typing" });
  });
});

describe("a lazy part of the app that fails to load (old page, new files on disk)", () => {
  it("flushes, then reloads the page, instead of running half-new code", async () => {
    const log: string[] = [];
    hooks = createUpdateHooks({ settleMs: 10, reload: () => log.push("reload") });
    render(<Saver onFlush={() => log.push("flush")} />);
    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    await sleep(80);
    expect(log).toEqual(["flush", "reload"]);
  });

  it("never reloads over and over: a second failure within a minute is left alone", async () => {
    const log: string[] = [];
    hooks = createUpdateHooks({ settleMs: 10, reload: () => log.push("reload") });
    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    await sleep(60);
    // (the page reloaded; sessionStorage remembers when)
    hooks.dispose();
    hooks = createUpdateHooks({ settleMs: 10, reload: () => log.push("reload again") });
    window.dispatchEvent(new Event("vite:preloadError", { cancelable: true }));
    await sleep(60);
    expect(log).toEqual(["reload"]);
  });
});

describe("the Mac app's hooks on window", () => {
  it("are there once installed", () => {
    const dispose = installAppUpdateHooks();
    const w = window as unknown as Record<string, unknown>;
    expect(typeof w[NATIVE_FLUSH]).toBe("function");
    expect(typeof w[NATIVE_PREPARE_RELOAD]).toBe("function");
    dispose();
    expect(NATIVE_FLUSH in window).toBe(false);
    expect(NATIVE_PREPARE_RELOAD in window).toBe(false);
  });
});
