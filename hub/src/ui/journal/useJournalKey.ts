import Dexie from "dexie";
import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../../data/db";
import type { JournalKey } from "../../journal/crypto";
import {
  confirmJournalKey, isKeychainError, journalKeyUnreadable, loadJournalKeyInfo, type JournalKeyState,
} from "../../journal/keyStore";
import { loadTimeout } from "./loadTimeout";

/**
 * Why the key check couldn't finish: the macOS keychain refused the stored key ("keychain"),
 * or it failed or took longer than loadTimeout.ms ("failed"). Nothing is deleted either way.
 */
export type KeyProblem = "keychain" | "failed";

export type KeyView =
  | { state: "loading" }
  | { state: Exclude<JournalKeyState, "confirmed"> }
  | { state: "confirmed"; jk: JournalKey }
  | { state: "error"; problem: KeyProblem };

type Held = { v: KeyView; id: string | null };

/**
 * This device's journal key state: "confirmed" (with the only key that may seal), "checking"
 * (a candidate waiting for sync to accept its passphrase) or "locked". Re-checked whenever the
 * database changes, so a sync that accepts the passphrase confirms the key at once.
 *
 * Never stuck on "loading" (2026-11-02): a check that throws, or doesn't answer within
 * loadTimeout.ms, becomes "error" (the page offers Try again); a late answer still shows.
 * `retry` starts a fresh check even while an old one hangs.
 */
export function useJournalKey(): KeyView & { retry: () => void } {
  const [view, setView] = useState<Held>({ v: { state: "loading" }, id: null });
  const mounted = useRef(true);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const generation = useRef(0);

  const check = useCallback(async (gen: number) => {
    let next: Held;
    try {
      const state = await confirmJournalKey(db);
      const info = state === "confirmed" ? await loadJournalKeyInfo(db) : undefined;
      if (info) next = { v: { state: "confirmed", jk: { key: info.key, mac: info.mac, fp: info.fp } }, id: info.id };
      else if (await journalKeyUnreadable(db)) next = { v: { state: "error", problem: "keychain" }, id: null };
      else next = { v: { state: state === "confirmed" ? "locked" : state }, id: null };
    } catch (e) {
      next = { v: { state: "error", problem: isKeychainError(e) ? "keychain" : "failed" }, id: null };
    }
    if (!mounted.current || gen !== generation.current) return;
    setView((prev) => {
      if (next.v.state === "confirmed") return prev.v.state === "confirmed" && prev.id === next.id ? prev : next;
      if (next.v.state === "error") return prev.v.state === "error" && prev.v.problem === next.v.problem ? prev : next;
      return prev.v.state === next.v.state ? prev : next;
    });
  }, []);

  // One check at a time; changes during a check ask for one more. A check that doesn't answer
  // in time shows "error" (only while nothing better is known), but its late answer still counts.
  const reload = useCallback(
    (fresh = false) => {
      if (running.current && !fresh) {
        again.current = true;
        return;
      }
      const gen = fresh ? ++generation.current : generation.current;
      const timer = setTimeout(() => {
        if (!mounted.current || gen !== generation.current) return;
        setView((prev) => (prev.v.state === "loading" ? { v: { state: "error", problem: "failed" }, id: null } : prev));
      }, loadTimeout.ms);
      const run = (async () => {
        do {
          again.current = false;
          await check(gen);
        } while (again.current && mounted.current && gen === generation.current);
      })();
      running.current = run;
      void run.finally(() => {
        clearTimeout(timer);
        if (running.current === run) running.current = null;
      });
    },
    [check],
  );

  const retry = useCallback(() => {
    setView({ v: { state: "loading" }, id: null });
    reload(true);
  }, [reload]);

  useEffect(() => {
    mounted.current = true;
    reload();
    const onMutated = () => reload();
    Dexie.on.storagemutated.subscribe(onMutated);
    return () => {
      mounted.current = false;
      Dexie.on.storagemutated.unsubscribe(onMutated);
    };
  }, [reload]);
  return { ...view.v, retry } as KeyView & { retry: () => void };
}

/** Calls `fn` whenever the database changes (sync arriving, another tab). */
export function useDbChanges(fn: () => void): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const onMutated = () => ref.current();
    Dexie.on.storagemutated.subscribe(onMutated);
    return () => Dexie.on.storagemutated.unsubscribe(onMutated);
  }, []);
}
