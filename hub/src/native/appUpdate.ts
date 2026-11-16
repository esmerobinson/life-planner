import { runHiddenFlushes } from "../ui/useDraft";

/**
 * Getting onto a new version without losing anything typed (bug #39).
 *
 * The Mac app (mac/Esmeworld/main.swift) notices when a newer bundle has been installed under
 * it. Before it reloads the page onto the new files it calls
 * `await window.esmeworldPrepareReload(minIdleMs)`: that refuses while she is typing (anything
 * typed in the last `minIdleMs`, or a character being composed), otherwise runs every
 * save-on-hide (the same saves as switching away from the app) and waits for their writes to
 * land in IndexedDB. Only `{ ready: true }` lets the app reload. `window.esmeworldFlush()` runs
 * the saves alone (the app calls it before quitting).
 *
 * The chunk guard: when a lazily loaded part of the app fails to load (an old page asking for
 * files a new install replaced), the page saves and reloads rather than running half-new code.
 */

/** `await window.esmeworldFlush()` → `{ settled }`. */
export const NATIVE_FLUSH = "esmeworldFlush";
/** `await window.esmeworldPrepareReload(minIdleMs)` → `{ ready, reason }`. */
export const NATIVE_PREPARE_RELOAD = "esmeworldPrepareReload";

const CHUNK_RELOAD_KEY = "esmeworld.chunkReloadAt";
/** After a chunk-failure reload, the next failure within this long is left to fail normally. */
const CHUNK_RELOAD_GUARD_MS = 60_000;

// Open IndexedDB write transactions, counted by wrapping IDBDatabase.transaction once. Dexie
// calls it for every write, so "none open, none for a moment" means the saves have landed.
let openWrites = 0;
let lastWriteActivity = -Infinity;
let trackedProto: object | null = null;

function trackWrites(): void {
  const proto = (globalThis as { IDBDatabase?: { prototype: IDBDatabase } }).IDBDatabase?.prototype;
  if (!proto || trackedProto === proto) return;
  trackedProto = proto;
  const original = proto.transaction;
  proto.transaction = function (this: IDBDatabase, ...args: Parameters<IDBDatabase["transaction"]>) {
    const tx = original.apply(this, args);
    if (tx.mode !== "readonly") {
      openWrites++;
      lastWriteActivity = Date.now();
      let open = true;
      const end = () => {
        if (!open) return;
        open = false;
        openWrites--;
        lastWriteActivity = Date.now();
      };
      tx.addEventListener("complete", end);
      tx.addEventListener("error", end);
      tx.addEventListener("abort", end);
    }
    return tx;
  } as IDBDatabase["transaction"];
}

const INPUT_EVENTS = ["keydown", "beforeinput", "input", "paste", "cut", "drop", "pointerdown"] as const;

export type PrepareResult = { ready: boolean; reason: "" | "typing" | "saving" };

export function createUpdateHooks(
  opts: {
    win?: Window;
    /** How long no write may be open or have just ended before the saves count as landed. */
    settleMs?: number;
    /** Longest the flush waits for saves. */
    maxMs?: number;
    /** The clock for "how long since she typed" (tests move it). */
    now?: () => number;
    reload?: () => void;
  } = {},
) {
  const win = opts.win ?? window;
  const settleMs = opts.settleMs ?? 300;
  const maxMs = opts.maxMs ?? 5_000;
  const now = opts.now ?? (() => Date.now());
  const reload = opts.reload ?? (() => win.location.reload());
  trackWrites();

  let lastInputAt = -Infinity;
  let inputs = 0;
  let composing = false;
  const onInput = () => {
    lastInputAt = now();
    inputs++;
  };
  const onCompositionStart = () => {
    composing = true;
    onInput();
  };
  const onCompositionEnd = () => {
    composing = false;
    onInput();
  };
  const capture = { capture: true, passive: true } as const;
  for (const ev of INPUT_EVENTS) win.addEventListener(ev, onInput, capture);
  win.addEventListener("compositionstart", onCompositionStart, capture);
  win.addEventListener("compositionupdate", onInput, capture);
  win.addEventListener("compositionend", onCompositionEnd, capture);

  async function flushNow(): Promise<{ settled: boolean }> {
    const start = Date.now();
    const pending = runHiddenFlushes().filter(
      (r): r is PromiseLike<unknown> => !!r && typeof (r as PromiseLike<unknown>).then === "function",
    );
    const waitLimit = new Promise((r) => setTimeout(r, maxMs));
    await Promise.race([Promise.allSettled(pending), waitLimit]);
    // Saves may do async work (encryption) before they open their write: wait at least
    // settleMs, and until no write is open and none has opened or closed for settleMs.
    while (Date.now() - start < maxMs) {
      const t = Date.now();
      if (openWrites === 0 && t - start >= settleMs && t - lastWriteActivity >= settleMs) {
        return { settled: true };
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    return { settled: openWrites === 0 };
  }

  async function prepareReload(minIdleMs: number): Promise<PrepareResult> {
    if (composing || now() - lastInputAt < minIdleMs) return { ready: false, reason: "typing" };
    const before = inputs;
    const { settled } = await flushNow();
    // Anything typed while saving is not saved yet: try again later.
    if (composing || inputs !== before) return { ready: false, reason: "typing" };
    if (!settled) return { ready: false, reason: "saving" };
    return { ready: true, reason: "" };
  }

  const onChunkError = () => {
    let last = 0;
    try {
      last = Number(win.sessionStorage.getItem(CHUNK_RELOAD_KEY)) || 0;
    } catch {
      // no storage: still reload once (this page)
    }
    if (now() - last < CHUNK_RELOAD_GUARD_MS) return; // just reloaded for this: let it fail
    try {
      win.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now()));
    } catch {
      // ignore
    }
    void flushNow().finally(reload);
  };
  win.addEventListener("vite:preloadError", onChunkError);

  function dispose(): void {
    for (const ev of INPUT_EVENTS) win.removeEventListener(ev, onInput, capture);
    win.removeEventListener("compositionstart", onCompositionStart, capture);
    win.removeEventListener("compositionupdate", onInput, capture);
    win.removeEventListener("compositionend", onCompositionEnd, capture);
    win.removeEventListener("vite:preloadError", onChunkError);
  }

  return { flushNow, prepareReload, dispose };
}

/** Puts the Mac app's hooks on window (main.tsx). Returns a function that takes them off. */
export function installAppUpdateHooks(): () => void {
  const hooks = createUpdateHooks();
  const w = window as unknown as Record<string, unknown>;
  const flush = () => hooks.flushNow();
  const prepare = (minIdleMs: unknown) => hooks.prepareReload(Math.max(0, Number(minIdleMs) || 0));
  w[NATIVE_FLUSH] = flush;
  w[NATIVE_PREPARE_RELOAD] = prepare;
  return () => {
    hooks.dispose();
    if (w[NATIVE_FLUSH] === flush) delete w[NATIVE_FLUSH];
    if (w[NATIVE_PREPARE_RELOAD] === prepare) delete w[NATIVE_PREPARE_RELOAD];
  };
}
