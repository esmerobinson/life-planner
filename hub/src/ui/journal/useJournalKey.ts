import Dexie from "dexie";
import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../../data/db";
import type { JournalKey } from "../../journal/crypto";
import { confirmJournalKey, loadJournalKeyInfo, type JournalKeyState } from "../../journal/keyStore";

export type KeyView = { state: "loading" } | { state: Exclude<JournalKeyState, "confirmed"> } | { state: "confirmed"; jk: JournalKey };

/**
 * This device's journal key state: "confirmed" (with the only key that may seal), "checking"
 * (a candidate waiting for sync to accept its passphrase) or "locked". Re-checked whenever the
 * database changes, so a sync that accepts the passphrase confirms the key at once.
 */
export function useJournalKey(): KeyView {
  const [view, setView] = useState<{ v: KeyView; id: string | null }>({ v: { state: "loading" }, id: null });
  const mounted = useRef(true);
  const running = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const check = useCallback(async () => {
    let state: JournalKeyState = "locked";
    try {
      state = await confirmJournalKey(db);
    } catch {
      state = "locked";
    }
    const info = state === "confirmed" ? await loadJournalKeyInfo(db).catch(() => undefined) : undefined;
    if (!mounted.current) return;
    setView((prev) => {
      if (info) return prev.v.state === "confirmed" && prev.id === info.id ? prev : { v: { state: "confirmed", jk: { key: info.key, fp: info.fp } }, id: info.id };
      const s = state === "confirmed" ? "locked" : state;
      return prev.v.state === s ? prev : { v: { state: s }, id: null };
    });
  }, []);

  // One check at a time; changes during a check ask for one more.
  const reload = useCallback(() => {
    if (running.current) {
      again.current = true;
      return;
    }
    running.current = (async () => {
      do {
        again.current = false;
        await check();
      } while (again.current && mounted.current);
      running.current = null;
    })();
  }, [check]);

  useEffect(() => {
    mounted.current = true;
    reload();
    Dexie.on.storagemutated.subscribe(reload);
    return () => {
      mounted.current = false;
      Dexie.on.storagemutated.unsubscribe(reload);
    };
  }, [reload]);
  return view.v;
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
