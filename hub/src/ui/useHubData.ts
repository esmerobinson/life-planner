import { useCallback, useEffect, useState } from "react";
import { listGoals, listItems } from "../data/repo";
import type { Goal, ISODate, Item } from "../domain/types";

export function useHubData(_today: ISODate): {
  items: Item[];
  goals: Goal[];
  refresh: () => Promise<void>;
} {
  const [items, setItems] = useState<Item[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);

  const refresh = useCallback(async () => {
    // done items are needed for monthly progress, so read all non-archived
    const [i, g] = await Promise.all([listItems(), listGoals()]);
    setItems(i);
    setGoals(g);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { items, goals, refresh };
}
