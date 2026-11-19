import type { PrepareResult } from "./appUpdate";

/**
 * The phone (home-screen web app) gets onto new versions by itself (2026-11-19: her phone sat on
 * an old build for days because the service worker waited for a tap on "Reload").
 *
 * Looks for a new version (registration.update()): on start, whenever the app comes back into
 * view, and every 30 minutes while in view. When one is waiting, it switches to it (skipWaiting,
 * then a reload) only at a safe moment:
 *   - nothing touched since the app opened or came back into view, or nothing touched for 30 s
 *     (the Mac app's own check, window.esmeworldPrepareReload, which also saves every draft
 *     first and waits for the writes to land: see appUpdate.ts);
 *   - and nothing it must not interrupt (updateHolds.ts): an open sheet with text, a field with
 *     text being edited, the journal, a sync in progress.
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
/** In view and touched since: switch only after this long untouched (as the Mac app). */
export const IDLE_MS = 30_000;
/** While refused, try again this often (as the Mac app). */
export const RETRY_MS = 10_000;
/** Refused this long in view: show the note so she can choose. */
export const NOTE_AFTER_MS = 5 * 60_000;
/** After an automatic switch, a version waiting again within this long shows the note instead. */
export const LOOP_GUARD_MS = 2 * 60_000;
/** Switched, but the new version never took over: reload anyway after this long. */
export const TAKEOVER_WAIT_MS = 10_000;
/** sessionStorage: when this tab last switched versions by itself. */
export const AUTO_UPDATE_KEY = "esmeworld.autoUpdateAt";

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
  /** Lets the waiting version take over (skipWaiting); `needReload` follows. */
  activate: () => unknown;
  reload: () => void;
  /** window.esmeworldPrepareReload. */
  prepare: (minIdleMs: number) => Promise<PrepareResult>;
  /** window.esmeworldFlush. */
  flush: () => Promise<unknown>;
  /** updateHolds.currentUpdateHold. */
  hold: () => string | null;
  win?: Window;
  doc?: Document;
  now?: () => number;
}

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

  /** The new version already controls the page: only a reload is left to do. */
  let mustReload = false;
  /** This page asked the waiting version to take over. */
  let switching = false;
  let busy = false;
  let disposed = false;
  let visibleAt = now();
  let wasVisible = visible();
  let lastCheckAt = -Infinity;
  let refusedMs = 0;
  let lastRefusedAt: number | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let takeover: ReturnType<typeof setTimeout> | null = null;

  function check(force = false) {
    if (disposed || (!force && now() - lastCheckAt < CHECK_GAP_MS)) return;
    lastCheckAt = now();
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

  function justSwitched(): boolean {
    try {
      const at = Number(win.sessionStorage.getItem(AUTO_UPDATE_KEY)) || 0;
      return now() - at < LOOP_GUARD_MS;
    } catch {
      return false;
    }
  }

  function refused() {
    const t = now();
    if (lastRefusedAt !== null) refusedMs += t - lastRefusedAt;
    lastRefusedAt = t;
    if (refusedMs >= NOTE_AFTER_MS) set({ showNote: true });
    clearRetry();
    if (!disposed && visible()) retry = setTimeout(() => void attempt(), RETRY_MS);
  }

  function doReload() {
    if (takeover) clearTimeout(takeover);
    takeover = null;
    env.reload();
  }

  /** Lets the waiting version take over; its takeover (needReload) reloads the page. */
  function switchNow() {
    if (mustReload) {
      doReload();
      return;
    }
    switching = true;
    try {
      win.sessionStorage.setItem(AUTO_UPDATE_KEY, String(now()));
    } catch {
      // No storage: the guard is off for this tab.
    }
    if (takeover) clearTimeout(takeover);
    takeover = setTimeout(doReload, TAKEOVER_WAIT_MS);
    void Promise.resolve()
      .then(env.activate)
      .catch(() => {});
  }

  async function attempt(): Promise<void> {
    clearRetry();
    if (disposed || switching || busy) return;
    if (!state.waiting && !mustReload) return;
    if (!env.auto) {
      set({ showNote: true });
      return;
    }
    if (!visible()) return; // on coming back
    if (!mustReload && justSwitched()) {
      set({ showNote: true });
      return;
    }
    if (env.hold()) return refused();
    busy = true;
    let r: PrepareResult;
    try {
      // Untouched since she came back, or for IDLE_MS.
      r = await env.prepare(Math.min(IDLE_MS, Math.max(0, now() - visibleAt)));
    } catch {
      r = { ready: false, reason: "saving" };
    } finally {
      busy = false;
    }
    if (disposed || switching) return;
    if (!visible()) return;
    if (!r.ready || env.hold()) return refused();
    switchNow();
  }

  function onVisibility() {
    const v = visible();
    if (!v) {
      wasVisible = false;
      lastRefusedAt = null; // time away does not count towards the note
      clearRetry();
      return;
    }
    if (!wasVisible) {
      wasVisible = true;
      visibleAt = now();
    }
    check();
    void attempt();
  }
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) {
      wasVisible = false; // back from the page cache: a fresh return
      onVisibility();
    }
  };

  doc.addEventListener("visibilitychange", onVisibility);
  win.addEventListener("pageshow", onPageShow);
  const interval = setInterval(() => {
    if (visible()) check(true);
  }, CHECK_EVERY_MS);
  check(true);

  return {
    getState: (): UpdateState => state,
    subscribe(fn: () => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Looks for a new version now (e.g. once the service worker is registered, on start). */
    checkNow(): void {
      check(true);
    },
    /** A new version is waiting (the plugin's onNeedRefresh). */
    needRefresh(): void {
      set({ waiting: true });
      void attempt();
    },
    /** A new version took over this page (the plugin's onNeedReload). */
    needReload(): void {
      if (switching || !env.auto) {
        doReload();
        return;
      }
      // Another tab switched: reload this one too, but only at a safe moment.
      mustReload = true;
      set({ waiting: true });
      void attempt();
    },
    /** The note's Reload: save everything, then switch. */
    async reloadNow(): Promise<void> {
      try {
        await env.flush();
      } catch {
        // Reload anyway: she asked.
      }
      clearRetry();
      switchNow();
    },
    dispose(): void {
      disposed = true;
      clearRetry();
      if (takeover) clearTimeout(takeover);
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
