import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { ShellContext } from "./shellContext";
import { listGoals, listItems } from "../data/repo";
import type { Goal, ISODate, Item } from "../domain/types";

export function useHubData(_today: ISODate): {
  items: Item[];
  goals: Goal[];
  refresh: () => Promise<void>;
  loaded: boolean;
} {
  const [items, setItems] = useState<Item[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loaded, setLoaded] = useState(false);

  const latest = useRef(0);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    const id = ++latest.current;
    const [i, g] = await Promise.all([listItems(), listGoals()]);
    if (!mounted.current || id !== latest.current) return; // stale or unmounted
    setItems(i);
    setGoals(g);
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

  return { items, goals, refresh, loaded };
}
