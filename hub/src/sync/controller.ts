// When to sync, and what the UI shows about it.
//
// Triggers (automatic): app start, the browser coming online, the tab becoming visible, a
// short debounce after local writes, and a steady interval while the tab is visible.
// Rules: at most one sync in flight (a trigger during a run asks for one follow-up run);
// nothing runs without a stored token and address; after a 401 the token is gone, so
// nothing runs again until the passphrase is entered; after a 429 nothing runs (not even
// "Sync now") until Retry-After has passed, then one run is scheduled.

import { liveQuery, type Subscription } from "dexie";
import type { HubDB } from "../data/db";
import { onLocalWrite } from "../data/changeTracking";
import { NEEDS_PASSPHRASE_MESSAGE, RATE_LIMITED_MESSAGE, retryStuck, syncOnce, type SyncOutcome } from "./engine";

/** Wait after the last local write before syncing (a technical batching delay, not motion). */
export const SYNC_DEBOUNCE_MS = 2000;
/** Steady sync while the tab is visible (a technical polling interval, not motion). */
export const SYNC_INTERVAL_MS = 60_000;

export type SyncStatus = "idle" | "syncing" | "error" | "needs-passphrase";

export interface SyncState {
  status: SyncStatus;
  /** Calm text for the current problem, or null. */
  message: string | null;
  lastSyncedAt: number | null;
  pendingCount: number;
  /** Local changes the server refused one by one; kept here, not sent until edited again. */
  stuckCount: number;
  /** Rows from the server this app version cannot read yet. */
  quarantineCount: number;
  /** A token and an address are stored. */
  configured: boolean;
  serverUrl: string | null;
  /** Sync is on (a token, or one refused and waiting for the passphrase). */
  syncOn: boolean;
  /** This device has pulled everything the server had at least once. */
  firstPullDone: boolean;
}

export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (id: unknown) => void;
}

const browserTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (id) => globalThis.clearTimeout(id as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
  clearInterval: (id) => globalThis.clearInterval(id as ReturnType<typeof setInterval>),
};

interface Stored {
  lastSyncedAt: number | null;
  pendingCount: number;
  stuckCount: number;
  quarantineCount: number;
  configured: boolean;
  needsPassphrase: boolean;
  serverUrl: string | null;
  syncOn: boolean;
  firstPullDone: boolean;
}

export class SyncController {
  readonly db: HubDB;
  private readonly fetchFn: typeof fetch;
  private readonly timers: Timers;

  private stored: Stored = {
    lastSyncedAt: null, pendingCount: 0, stuckCount: 0, quarantineCount: 0, configured: false, needsPassphrase: false, serverUrl: null,
    syncOn: false, firstPullDone: false,
  };
  private running = false;
  private error: string | null = null;
  private state: SyncState;
  private readonly listeners = new Set<() => void>();

  private inFlight: Promise<SyncOutcome | null> | null = null;
  private rerun = false;
  private blockedUntil = 0;
  private onSynced: (() => void) | undefined;

  private starts = 0;
  private stopAll: (() => void) | null = null;
  private debounce: unknown = null;
  private retryTimer: unknown = null;
  /** Set on app start and by "Sync now": the next run first lets stuck changes be retried. */
  private retryStuckNext = false;

  constructor(env: { db: HubDB; fetch: typeof fetch; timers?: Timers }) {
    this.db = env.db;
    this.fetchFn = env.fetch;
    this.timers = env.timers ?? browserTimers;
    this.state = this.compute();
  }

  getState = (): SyncState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Starts automatic sync. Safe to call more than once; returns the matching stop. */
  start(options: { onSynced?: () => void } = {}): () => void {
    if (options.onSynced) this.onSynced = options.onSynced;
    this.starts++;
    if (this.starts === 1) this.stopAll = this.attach();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.starts--;
      if (this.starts === 0) {
        this.stopAll?.();
        this.stopAll = null;
      }
    };
  }

  /** "Sync now": runs a sync (or joins the one in flight). Respects a 429 wait. */
  async syncNow(): Promise<void> {
    this.retryStuckNext = true;
    await this.run();
  }

  /** Re-reads the stored settings after the Sync page changed them. */
  async reload(): Promise<void> {
    await this.readStored();
  }

  /** Clears any error shown (e.g. after new settings were saved). */
  clearError(): void {
    this.error = null;
    this.emit();
  }

  private attach(): () => void {
    this.retryStuckNext = true; // once per app start
    const auto = () => void this.run();
    const onVisible = () => {
      if (document.visibilityState === "visible") auto();
    };
    const offWrite = onLocalWrite(this.db, () => {
      if (this.debounce !== null) this.timers.clearTimeout(this.debounce);
      this.debounce = this.timers.setTimeout(() => {
        this.debounce = null;
        auto();
      }, SYNC_DEBOUNCE_MS);
    });
    const interval = this.timers.setInterval(() => {
      if (document.visibilityState === "visible") auto();
    }, SYNC_INTERVAL_MS);
    window.addEventListener("online", auto);
    document.addEventListener("visibilitychange", onVisible);
    // Settings, pending count and last sync, kept current across tabs.
    const sub: Subscription = liveQuery(() => this.load()).subscribe({
      next: (s) => this.setStored(s),
      error: () => {
        /* reads failing is shown by the pages that read data */
      },
    });
    auto(); // on start
    return () => {
      offWrite();
      sub.unsubscribe();
      this.timers.clearInterval(interval);
      if (this.debounce !== null) this.timers.clearTimeout(this.debounce);
      if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
      this.debounce = null;
      this.retryTimer = null;
      window.removeEventListener("online", auto);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }

  private run(): Promise<SyncOutcome | null> {
    if (this.inFlight) {
      this.rerun = true;
      return this.inFlight;
    }
    if (Date.now() < this.blockedUntil) return Promise.resolve(null);
    this.inFlight = (async () => {
      let out: SyncOutcome | null = null;
      try {
        let rounds = 0;
        do {
          this.rerun = false;
          out = await this.once();
          // A token saved during the run: run again with it (bounded, never a loop).
        } while (++rounds < 5 && ((this.rerun && out.kind === "ok") || out.kind === "superseded"));
        return out;
      } finally {
        this.inFlight = null;
        this.running = false;
        this.emit();
      }
    })();
    return this.inFlight;
  }

  private async once(): Promise<SyncOutcome> {
    this.running = true;
    this.emit();
    let out: SyncOutcome;
    try {
      if (this.retryStuckNext) {
        this.retryStuckNext = false;
        await retryStuck(this.db);
      }
      out = await syncOnce({ db: this.db, fetch: this.fetchFn });
    } catch {
      out = { kind: "error", message: "Sync did not work this time. Your changes are kept on this device." };
    }
    switch (out.kind) {
      case "ok":
        this.error = null; // changes held back are counted on the Sync page
        break;
      case "not-configured":
      case "superseded":
        this.error = null;
        break;
      case "needs-passphrase":
        this.error = null; // shown from the stored flag
        break;
      case "rate-limited":
        this.error = RATE_LIMITED_MESSAGE;
        this.blockedUntil = Date.now() + out.retryAfterMs;
        if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
        this.retryTimer = this.timers.setTimeout(() => {
          this.retryTimer = null;
          this.blockedUntil = 0;
          void this.run();
        }, out.retryAfterMs);
        break;
      default:
        this.error = out.message;
    }
    await this.readStored();
    if (out.kind === "ok" && out.received > 0) {
      try {
        this.onSynced?.();
      } catch {
        /* the data is saved; views re-read on the next change */
      }
    }
    return out;
  }

  private async load(): Promise<Stored> {
    return this.db.transaction("r", this.db.syncMeta, this.db.pending, this.db.quarantine, async () => {
      const meta = new Map((await this.db.syncMeta.toArray()).map((r) => [r.key, r.value]));
      const serverUrl = typeof meta.get("serverUrl") === "string" ? (meta.get("serverUrl") as string) : null;
      return {
        lastSyncedAt: typeof meta.get("lastSyncedAt") === "number" ? (meta.get("lastSyncedAt") as number) : null,
        pendingCount: await this.db.pending.filter((p) => !p.stuck).count(),
        stuckCount: await this.db.pending.filter((p) => p.stuck === true).count(),
        quarantineCount: await this.db.quarantine.count(),
        configured: Boolean(serverUrl && meta.get("token")),
        needsPassphrase: meta.get("needsPassphrase") === true,
        serverUrl,
        syncOn: Boolean(meta.get("token")) || meta.get("needsPassphrase") === true,
        firstPullDone: meta.get("firstPullDone") === true,
      };
    });
  }

  private async readStored() {
    try {
      this.setStored(await this.load());
    } catch {
      /* keep the last known state */
    }
  }

  private setStored(s: Stored) {
    this.stored = s;
    this.emit();
  }

  private compute(): SyncState {
    const s = this.stored;
    const status: SyncStatus = this.running
      ? "syncing"
      : s.needsPassphrase
        ? "needs-passphrase"
        : this.error
          ? "error"
          : "idle";
    return {
      status,
      message: s.needsPassphrase ? NEEDS_PASSPHRASE_MESSAGE : this.error,
      lastSyncedAt: s.lastSyncedAt,
      pendingCount: s.pendingCount,
      stuckCount: s.stuckCount,
      quarantineCount: s.quarantineCount,
      configured: s.configured,
      serverUrl: s.serverUrl,
      syncOn: s.syncOn,
      firstPullDone: s.firstPullDone,
    };
  }

  private emit() {
    this.state = this.compute();
    this.listeners.forEach((fn) => fn());
  }
}
