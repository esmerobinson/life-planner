import Dexie from "dexie";
import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../../data/db";
import { loadJournalKeyInfo } from "../../journal/keyStore";

/**
 * This device's journal key (undefined: locked). Re-read when the database changes, so
 * unlocking (here or on the Sync page) or a refused passphrase shows at once.
 */
export function useJournalKey(): { loaded: boolean; key: CryptoKey | undefined; reload: () => Promise<void> } {
  const [state, setState] = useState<{ loaded: boolean; key: CryptoKey | undefined; id: string | null }>({
    loaded: false, key: undefined, id: null,
  });
  const mounted = useRef(true);
  const reload = useCallback(async () => {
    let info: { key: CryptoKey; id: string } | undefined;
    try {
      info = await loadJournalKeyInfo(db);
    } catch {
      info = undefined;
    }
    if (!mounted.current) return;
    const id = info ? info.id : null;
    // Each read is a fresh copy of the stored key: keep the one in hand unless it changed.
    setState((prev) => (prev.loaded && prev.id === id ? prev : { loaded: true, key: info?.key, id }));
  }, []);
  useEffect(() => {
    mounted.current = true;
    void reload();
    const onMutated = () => void reload();
    Dexie.on.storagemutated.subscribe(onMutated);
    return () => {
      mounted.current = false;
      Dexie.on.storagemutated.unsubscribe(onMutated);
    };
  }, [reload]);
  return { loaded: state.loaded, key: state.key, reload };
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
