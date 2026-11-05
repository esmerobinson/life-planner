// When the Together sender runs (Together link brief §2): after each successful sync run (the
// sync's "last synced" time moves on and no run is in flight), and on "Send now". Never during a
// sync. Holds the latest outcome for the Together box. The sender itself makes sure only one
// tab sends at a time, and that only a device that signed in sends at all.

import { sendToTogether, type SendOutcome } from "./sender";
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

  constructor(private readonly send: (opts: { retryRefused?: boolean }) => Promise<SendOutcome>) {}

  getState = (): RunnerState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** Runs once each time a sync run finishes with a newer "last synced". Returns the stop. */
  start(sync: SyncWatch): () => void {
    let seen = sync.getState().lastSyncedAt;
    return sync.subscribe(() => {
      const s = sync.getState();
      if (s.status === "syncing" || s.lastSyncedAt === null || s.lastSyncedAt === seen) return;
      seen = s.lastSyncedAt;
      void this.run({});
    });
  }

  /** "Send now": also tries again what was set aside. */
  sendNow(): Promise<SendOutcome> {
    return this.run({ retryRefused: true });
  }

  private run(opts: { retryRefused?: boolean }): Promise<SendOutcome> {
    if (this.inFlight) {
      // A sync (or a tick's sync) finished, or Send now was pressed, during this send: one more
      // run as soon as this one ends, never only after the next sync (bug #43).
      const want = { retryRefused: !!(this.next?.opts.retryRefused || opts.retryRefused) };
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
  private next: { opts: { retryRefused?: boolean }; promise: Promise<SendOutcome>; start: () => void } | null = null;

  private start1(opts: { retryRefused?: boolean }): Promise<SendOutcome> {
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
  return new TogetherRunner((opts) => sendToTogether({ fetch: fetchFn, retryRefused: opts.retryRefused }));
}

/** The app's one runner, on the browser's fetch. */
export const togetherRunner = makeRunner((input, init) => fetch(input, init));
