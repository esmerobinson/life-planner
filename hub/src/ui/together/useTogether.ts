import { liveQuery } from "dexie";
import { useEffect, useState, useSyncExternalStore } from "react";
import { db } from "../../data/db";
import { readAuth, readSent, type TogetherAuth, type TogetherSent } from "../../together/store";
import { togetherRunner, type TogetherRunner } from "../../together/runner";

export interface TogetherView {
  auth: TogetherAuth | undefined;
  sent: TogetherSent | undefined;
}

/** The Together settings on this device, kept current (across tabs too). */
export function useTogetherMeta(): TogetherView | null {
  const [v, setV] = useState<TogetherView | null>(null);
  useEffect(() => {
    const sub = liveQuery(async () => ({ auth: await readAuth(db), sent: await readSent(db) })).subscribe({
      next: setV,
      error: () => undefined,
    });
    return () => sub.unsubscribe();
  }, []);
  return v;
}

export function useRunner(runner: TogetherRunner = togetherRunner) {
  return useSyncExternalStore(runner.subscribe, runner.getState);
}
