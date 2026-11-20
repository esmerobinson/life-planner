import type { PrepareResult } from "./appUpdate";

/**
 * The phone (home-screen web app) gets onto new versions by itself (2026-11-19: her phone sat on
 * an old build for days because the service worker waited for a tap on "Reload").
 *
 * Looks for a new version (registration.update()): on start, on leaving the app (so it can be
 * ready on return), on coming back into view, and every 30 minutes while in view.
 *
 * When one is waiting it switches (skipWaiting, then a reload) only when ALL of these hold:
 *   - nothing is held (updateHolds.ts): nothing edited on this page since it was shown, no sheet
 *     or dialog open, no panel in Edit mode, no sync or pairing in progress, no camera scanner,
 *     no kept Add draft;
 *   - the Mac app's own check passes (window.esmeworldPrepareReload): nothing typed for the idle
 *     time, every draft saved and its writes landed (appUpdate.ts);
 *   - the idle time: in the first moment of coming back into view (FRESH_MS), nothing touched
 *     since coming back (so the switch happens before she starts reading); otherwise 30 s
 *     untouched. A version waiting at a cold open is taken before the first paint instead
 *     (pwaRegister.applyWaitingBeforeFirstPaint), so opening the app never flashes.
 * Right before the actual reload (the takeover, or the 10 s fallback) everything is checked
 * again: any key, tap or input since the decision, a hold, or the page hidden cancels it, and it
 * goes round again later. A page the new worker does not control yet (the first open after Add
 * to Home Screen) has no fallback timer: it reloads on the next return to the app.
 * Otherwise it tries again in 10 s while in view. Never while in the background.
 * "A new version is ready · Reload" (UpdatePrompt) shows only when that has kept being refused
 * for 5 minutes in view, or just after an automatic update when a version is waiting again (a
 * guard against reload loops).
 *
 * In the Mac app the shell reloads onto new versions itself (mac/Esmeworld/main.swift): there
 * `auto` is false and this only keeps the note, as before.
 */

/** Look for a new version this often while in view (a technical interval, not motion). */
export const CHECK_EVERY_MS = 30 * 60_000;
/** One look per return to view: pageshow and visibilitychange can both fire for one return. */
export const CHECK_GAP_MS = 1_000;
/** Coming back into view: a switch this soon after needs only "untouched since coming back". */
export const FRESH_MS = 2_000;
/** Otherwise: switch only after this long untouched (as the Mac app). */
export const IDLE_MS = 30_000;
/** While refused, try again this often (as the Mac app). */
export const RETRY_MS = 10_000;
/** Refused this long in view: show the note so she can choose. */
export const NOTE_AFTER_MS = 5 * 60_000;
/** After an automatic switch, a version waiting again within this long shows the note instead. */
export const LOOP_GUARD_MS = 2 * 60_000;
/** Switched on a controlled page, but the new version never took over: check, then reload. */
export const TAKEOVER_WAIT_MS = 10_000;
/** sessionStorage: when this tab last switched versions by itself. */
export const AUTO_UPDATE_KEY = "esmeworld.autoUpdateAt";

/** This tab switched versions by itself within LOOP_GUARD_MS. */
export function justSwitched(win: Window = window, now = Date.now()): boolean {
  try {
    const at = Number(win.sessionStorage.getItem(AUTO_UPDATE_KEY)) || 0;
    return now - at < LOOP_GUARD_MS;
  } catch {
    return false;
  }
}

/** Notes an automatic switch (for the loop guard). */
export function noteSwitched(win: Window = window, now = Date.now()): void {
  try {
    win.sessionStorage.setItem(AUTO_UPDATE_KEY, String(now));
  } catch {
    // No storage: the guard is off for this tab.
  }
}

export interface UpdateState {
  /** A new version is waiting (or has taken over and this page still runs the old one). */
  waiting: boolean;
  /** Show "A new version is ready · Reload". */
  showNote: boolean;
}

export interface AutoUpdateEnv {
  /** False in the Mac app (its shell reloads by itself): the note only. */
  auto: boolean;
  /** registration.update(): looks for a new version. */
  check: () => Promise<unknown>;
  /** Lets the waiting version take over (skipWaiting); `needReload` follows on a controlled page. */
  activate: () => unknown;
  reload: () => void;
  /** window.esmeworldPrepareReload. */
  prepare: (minIdleMs: number) => Promise<PrepareResult>;
  /** window.esmeworldFlush. */
  flush: () => Promise<unknown>;
  /** updateHolds.currentUpdateHold. */
  hold: () => string | null;
  /** updateHolds.userActivity: changes with every key, tap and input. */
  activity: () => number;
  /** A service worker controls this page (navigator.serviceWorker.controller). */
  controlled: () => boolean;
  win?: Window;
  doc?: Document;
  now?: () => number;
}

type Why = "return" | "other";

export function createAutoUpdater(env: AutoUpdateEnv) {
  const win = env.win ?? window;
  const doc = env.doc ?? document;
  const now = env.now ?? (() => Date.now());
  const visible = () => doc.visibilityState !== "hidden";

  let state: UpdateState = { waiting: false, showNote: false };
  const listeners = new Set<() => void>();
  const set = (next: Partial<UpdateState>) => {
    const s = { ...state, ...next };
    if (s.waiting === state.waiting && s.showNote === state.showNote) return;
    state = s;
    for (const fn of [...listeners]) fn();
  };

  /** The new version may already control the page: only a (checked) reload is left to do. */
  let mustReload = false;
  /** That reload waits for a return to the app (a page the worker does not control). */
  let onlyOnReturn = false;
  /** Asked the waiting version to take over; the reload is still to be checked. */
  let switching = false;
  /** userActivity() when the switch was decided: any change cancels the reload. */
  let decidedAt = 0;
  /** Her own tap on Reload: no automatic checks. */
  let asked = false;
  let busy = false;
  let disposed = false;
  /** When she last came back into view (null: not since start). */
  let returnedAt: number | null = null;
  let wasVisible = visible();
  let lastReturnCheckAt = -Infinity;
  let refusedMs = 0;
  let lastRefusedAt: number | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let takeover: ReturnType<typeof setTimeout> | null = null;

  function check() {
    if (disposed) return;
    void Promise.resolve()
      .then(env.check)
      .catch(() => {
        // Offline, or the server is unreachable: look again next time.
      });
  }

  function clearRetry() {
    if (retry) clearTimeout(retry);
    retry = null;
  }

  function clearTakeover() {
    if (takeover) clearTimeout(takeover);
    takeover = null;
  }

  function refused() {
    const t = now();
    if (lastRefusedAt !== null) refusedMs += t - lastRefusedAt;
    lastRefusedAt = t;
    if (refusedMs >= NOTE_AFTER_MS) set({ showNote: true });
    clearRetry();
    if (!disposed && visible() && !onlyOnReturn) retry = setTimeout(() => void attempt("other"), RETRY_MS);
  }

  /** The last check, right before the reload: nothing touched since the decision, nothing held. */
  function finalReload() {
    clearTakeover();
    if (disposed) return;
    if (asked || (visible() && env.activity() === decidedAt && !env.hold())) {
      env.reload();
      return;
    }
    // Something changed: go round again (the full check) later.
    switching = false;
    mustReload = true;
    set({ waiting: true });
    refused();
  }

  /** Lets the waiting version take over; the reload follows, checked once more. */
  function switchNow() {
    if (mustReload) {
      finalReload();
      return;
    }
    switching = true;
    noteSwitched(win, now());
    const controlled = env.controlled();
    clearTakeover();
    if (controlled) takeover = setTimeout(finalReload, TAKEOVER_WAIT_MS);
    void Promise.resolve()
      .then(env.activate)
      .catch(() => {});
    if (!controlled && !asked) {
      // No takeover event will come (no clientsClaim): reload on her next return to the app.
      switching = false;
      mustReload = true;
      onlyOnReturn = true;
    }
  }

  async function attempt(why: Why): Promise<void> {
    clearRetry();
    if (disposed || switching || busy || asked) return;
    if (!state.waiting && !mustReload) return;
    if (!env.auto) {
      set({ showNote: true });
      return;
    }
    if (!visible()) return; // on coming back
    if (onlyOnReturn && why !== "return") return;
    if (!mustReload && justSwitched(win, now())) {
      set({ showNote: true });
      return;
    }
    if (env.hold()) return refused();
    busy = true;
    let r: PrepareResult;
    const sinceReturn = returnedAt === null ? Infinity : Math.max(0, now() - returnedAt);
    try {
      r = await env.prepare(sinceReturn <= FRESH_MS ? sinceReturn : IDLE_MS);
    } catch {
      r = { ready: false, reason: "saving" };
    } finally {
      busy = false;
    }
    if (disposed || switching || asked) return;
    if (!visible()) return;
    if (!r.ready || env.hold()) return refused();
    decidedAt = env.activity();
    onlyOnReturn = false;
    switchNow();
  }

  function onVisibility() {
    if (!visible()) {
      wasVisible = false;
      lastRefusedAt = null; // time away does not count towards the note
      clearRetry();
      check(); // ready (installed) by the time she comes back
      return;
    }
    if (!wasVisible) {
      wasVisible = true;
      returnedAt = now();
      if (now() - lastReturnCheckAt >= CHECK_GAP_MS) {
        lastReturnCheckAt = now();
        check();
      }
      void attempt("return");
    }
  }
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted && visible() && (returnedAt === null || now() - returnedAt >= CHECK_GAP_MS)) {
      wasVisible = false; // back from the page cache: a fresh return
      onVisibility();
    }
  };

  doc.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("pageshow", onPageShow);
  const interval = setInterval(() => {
    if (visible()) check();
  }, CHECK_EVERY_MS);
  check();

  return {
    getState: (): UpdateState => state,
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Looks for a new version now (e.g. once the service worker is registered, on start). */
    checkNow(): void {
      check();
    },
    /** A new version is waiting (the plugin's onNeedRefresh). */
    needRefresh(): void {
      set({ waiting: true });
      const fresh = returnedAt !== null && now() - returnedAt <= FRESH_MS;
      void attempt(fresh ? "return" : "other");
    },
    /** A new version took over this page (the plugin's onNeedReload). */
    needReload(): void {
      if (switching) {
        finalReload();
        return;
      }
      if (!env.auto) {
        env.reload();
        return;
      }
      // Another tab switched, or a takeover after a cancelled reload: only at a safe moment.
      mustReload = true;
      onlyOnReturn = false;
      set({ waiting: true });
      void attempt("other");
    },
    /** The note's Reload (her own tap): save everything, then switch. */
    async reloadNow(): Promise<void> {
      try {
        await env.flush();
      } catch {
        // Reload anyway: she asked.
      }
      clearRetry();
      asked = true;
      if (mustReload) {
        env.reload();
        return;
      }
      switchNow();
      // An uncontrolled page gets no takeover event: she asked, so reload when it is active.
      if (!env.controlled()) takeover = setTimeout(() => env.reload(), TAKEOVER_WAIT_MS);
    },
    dispose(): void {
      disposed = true;
      clearRetry();
      clearTakeover();
      clearInterval(interval);
      doc.removeEventListener("visibilitychange", onVisibility);
      win.removeEventListener("pageshow", onPageShow);
      listeners.clear();
    },
  };
}

export type AutoUpdater = ReturnType<typeof createAutoUpdater>;

/** The app's one updater (set up in main.tsx by pwaRegister.ts; null in tests). */
let appUpdater: AutoUpdater | null = null;

export function getAppUpdater(): AutoUpdater | null {
  return appUpdater;
}

export function setAppUpdater(u: AutoUpdater | null): void {
  appUpdater = u;
}
