import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ShellContext } from "./shellContext";
import { DATA_ERROR } from "./messages";
import { listGoals, listItems } from "../data/repo";
import type { Goal, ISODate, Item } from "../domain/types";

export function useHubData(_today: ISODate): {
  items: Item[];
  goals: Goal[];
  refresh: () => Promise<void>;
  loaded: boolean;
  error: string | null;
} {
  const [items, setItems] = useState<Item[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = useRef(0);
  const mounted = useRef(false);

  // Never rejects: a failed read becomes `error` (and `loaded`, so pages can say so).
  const refresh = useCallback(async () => {
    const id = ++latest.current;
    try {
      const [i, g] = await Promise.all([listItems(), listGoals()]);
      if (!mounted.current || id !== latest.current) return; // stale or unmounted
      setItems(i);
      setGoals(g);
      setError(null);
    } catch {
      if (!mounted.current || id !== latest.current) return;
      setError(DATA_ERROR);
    }
    setLoaded(true);
  }, []);

  // Re-read when the shell reports a change; 0 (no provider) keeps this standalone.
  const version = useContext(ShellContext)?.version ?? 0;

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh, version]);

  return { items, goals, refresh, loaded, error };
}
