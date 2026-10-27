import { useEffect, useState } from "react";
import { tickItem } from "../data/repo";
import type { ISODate, Item } from "../domain/types";
import { CelebrationPlaceholder } from "./CelebrationPlaceholder";
import { useSaveError } from "./messages";
import { MoveToMenu } from "./MoveToMenu";

const CELEBRATION_MS = 1500; // invented placeholder duration, to be replaced by Esme's timing

/** Tick handler plus the celebration placeholder it triggers (or the save message if it fails). */
export function useTick(today: ISODate, refresh: () => Promise<void>) {
  const [celebrating, setCelebrating] = useState(false);
  const { attempt, saveError } = useSaveError();
  useEffect(() => {
    if (!celebrating) return;
    const t = setTimeout(() => setCelebrating(false), CELEBRATION_MS);
    return () => clearTimeout(t);
  }, [celebrating]);
  async function tick(id: string) {
    if (!(await attempt(() => tickItem(id, today)))) return;
    setCelebrating(true);
    await refresh();
  }
  return {
    tick,
    celebration: celebrating ? <CelebrationPlaceholder /> : null,
    message: saveError ? <p className="form-message">{saveError}</p> : null,
  };
}

export function TaskRow({
  item,
  today,
  onTick,
  onMoved,
}: {
  item: Item;
  today: ISODate;
  onTick: (id: string) => void;
  onMoved: () => Promise<void>;
}) {
  const overdue = item.due !== undefined && item.due < today;
  return (
    <li className="today-row">
      <button type="button" aria-label={`Done: ${item.title}`} onClick={() => onTick(item.id)}>
        Done
      </button>
      <span className="today-title">{item.title}</span>
      {overdue && <span className="overdue-sticker">OVERDUE</span>}
      <MoveToMenu itemId={item.id} today={today} onMoved={onMoved} label={item.title} />
    </li>
  );
}
