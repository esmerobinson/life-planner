// When the Together sender runs. Sending is manual (Esme, 2026-11-09): only "Send now" sends
// (mode "send"). The automatic runs, after each successful sync run (the sync's "last synced"
// time moves on and no run is in flight) and when the app opens or comes back into view (at most
// once a minute), only take words out (mode "hide"): a private tick made after sending, a day
// removed. Never during a sync. Holds the latest outcome for the Together box. The sender itself
// makes sure only one tab sends at a time, and that only a device that signed in sends at all.

import { db as appDb } from "../data/db";
import { sendToTogether, type SendOutcome } from "./sender";
import { readSent } from "./store";

/** Automatic (hiding) runs on opening or coming back into view: at most this often (no storm). */
export const HELD_RUN_GAP_MS = 60_000;

export interface RunOpts {
  retryRefused?: boolean;
  /** "send" only from Send now; automatic runs are "hide". */
  mode: "send" | "hide";
}
import type { Fetch } from "./client";

/** The parts of the sync controller the runner watches. */
export interface SyncWatch {
  getState(): { status: string; lastSyncedAt: number | null };
  subscribe(fn: () => void): () => void;
}

export interface RunnerState {
  running: boolean;
  last: SendOutcome | null;
}

export class TogetherRunner {
  private state: RunnerState = { running: false, last: null };
  private readonly listeners = new Set<() => void>();
  private inFlight: Promise<SendOutcome> | null = null;

  constructor(
    private readonly send: (opts: RunOpts) => Promise<SendOutcome>,
    /**
     * An automatic (hiding) run is worth starting without a sync: something is in Together that a
     * tick made here could need hidden (a day sent with answers), or a hiding run stopped at its
     * limit, or a stop with removing is unfinished.
     */
    private readonly held: () => Promise<boolean> = async () => {
      const s = await readSent(appDb);
      if (!s) return false;
      return s.backlog === true || s.removing === true || Object.values(s.days ?? {}).some((d) => d.live && Object.values(d.parts).includes("answers"));
    },
  ) {}

  /** The last run started because answers were held (bug #68), for the once-a-minute limit. */
  private lastHeldRun = -Infinity;

  getState = (): RunnerState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /**
   * Runs once each time a sync run finishes with a newer "last synced". While answers are held
   * after a Replace (bug #68: with sync off, nothing else would run it), also when the app opens,
   * comes back into view, or the sync state changes, at most once a minute: the sender itself
   * decides whether the hold has passed. Returns the stop.
   */
  start(sync: SyncWatch): () => void {
    let seen = sync.getState().lastSyncedAt;
    const off = sync.subscribe(() => {
      const s = sync.getState();
      if (s.status === "syncing") return;
      if (s.lastSyncedAt !== null && s.lastSyncedAt !== seen) {
        seen = s.lastSyncedAt;
        void this.run({ mode: "hide" });
        return;
      }
      void this.runIfHeld();
    });
    const onVisible = () => {
      if (typeof document === "undefined" || document.visibilityState === "visible") void this.runIfHeld();
    };
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    void this.runIfHeld(); // the app opening
    return () => {
      off();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible);
    };
  }

  private async runIfHeld(): Promise<void> {
    const now = Date.now();
    if (now - this.lastHeldRun < HELD_RUN_GAP_MS) return;
    if (!(await this.held().catch(() => false))) return;
    this.lastHeldRun = now;
    await this.run({ mode: "hide" });
  }

  /** "Send now": sends everything new or changed, and tries again what was set aside. */
  sendNow(): Promise<SendOutcome> {
    return this.run({ retryRefused: true, mode: "send" });
  }

  private run(opts: RunOpts): Promise<SendOutcome> {
    if (this.inFlight) {
      // A sync (or a tick's sync) finished, or Send now was pressed, during this send: one more
      // run as soon as this one ends, never only after the next sync (bug #43). A press wins.
      const want: RunOpts = {
        retryRefused: !!(this.next?.opts.retryRefused || opts.retryRefused),
        mode: this.next?.opts.mode === "send" || opts.mode === "send" ? "send" : "hide",
      };
      if (!this.next) {
        let start!: () => void;
        const ready = new Promise<void>((r) => (start = r));
        const next: NonNullable<TogetherRunner["next"]> = { opts: want, promise: Promise.resolve(null as never), start };
        next.promise = ready.then(() => this.start1(next.opts));
        this.next = next;
      } else {
        this.next.opts = want;
      }
      return this.next.promise;
    }
    return this.start1(opts);
  }

  /** The follow-up run asked for while one was in flight. */
  private next: { opts: RunOpts; promise: Promise<SendOutcome>; start: () => void } | null = null;

  private start1(opts: RunOpts): Promise<SendOutcome> {
    const p = (async () => {
      this.set({ running: true });
      let out: SendOutcome;
      try {
        out = await this.send(opts);
      } catch {
        out = { kind: "offline" };
      }
      this.set({ running: false, last: out.kind === "busy" ? this.state.last : out });
      return out;
    })();
    this.inFlight = p;
    void p.finally(() => {
      if (this.inFlight !== p) return;
      this.inFlight = null;
      const next = this.next;
      this.next = null;
      next?.start();
    });
    return p;
  }

  private set(next: Partial<RunnerState>): void {
    this.state = { ...this.state, ...next };
    for (const fn of this.listeners) fn();
  }
}

export function makeRunner(fetchFn: Fetch): TogetherRunner {
  return new TogetherRunner((opts) => sendToTogether({ fetch: fetchFn, retryRefused: opts.retryRefused, mode: opts.mode }));
}

/** The app's one runner, on the browser's fetch. */
export const togetherRunner = makeRunner((input, init) => fetch(input, init));
