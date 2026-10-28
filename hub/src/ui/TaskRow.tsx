import { useEffect, useState, type ReactNode } from "react";
import { tickItem } from "../data/repo";
import { dueLine } from "../domain/display";
import type { ISODate, Item } from "../domain/types";
import { CelebrationPlaceholder } from "./CelebrationPlaceholder";
import { useSaveError } from "./messages";
import { MoveToMenu } from "./MoveToMenu";
import { ScheduleMenu } from "./ScheduleMenu";

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

/** The small line under a task's title (2D): due date, red with how late when overdue; and the pinned day. */
export function DueLine({ item, today }: { item: Item; today: ISODate }) {
  const line = dueLine(item, today);
  if (!line.due && !line.on) return null;
  return (
    <div className="strip-meta">
      {line.due && <span className={line.late ? "strip-late" : undefined}>{line.due}</span>}
      {line.due && line.on && " · "}
      {line.on && <span>{line.on}</span>}
    </div>
  );
}

/**
 * One task (or idea) as a strip: tick box on the left (Done; tasks only), title with the
 * due line under it, and the Schedule for (tasks only) and Move to icons on the right.
 * `meta` adds lines under the title, `extra` sits before the icons, `tray` is a second
 * line under the title for a page's own controls.
 */
export function TaskRow({
  item,
  today,
  onTick,
  onMoved,
  meta,
  extra,
  tray,
  lead,
  className,
}: {
  item: Item;
  today: ISODate;
  onTick?: (id: string) => void;
  onMoved: () => void | Promise<void>;
  meta?: ReactNode;
  extra?: ReactNode;
  tray?: ReactNode;
  /** Sits in the tick box's place when there is no tick box (the Inbox's Select checkbox). */
  lead?: ReactNode;
  className?: string;
}) {
  const isTask = item.kind === "task";
  const tick = isTask && onTick !== undefined;
  const first = tick || lead !== undefined;
  return (
    <li className={["strip", first ? "" : "no-tick", className ?? ""].filter(Boolean).join(" ")}>
      {!tick && lead}
      {tick && (
        <input
          type="checkbox"
          className="tick"
          aria-label={`Mark done: ${item.title}`}
          checked={false}
          onChange={() => onTick(item.id)}
        />
      )}
      <div className="strip-body">
        <div className="strip-title">{item.title}</div>
        {isTask && <DueLine item={item} today={today} />}
        {meta}
      </div>
      <div className="strip-actions">
        {extra}
        {isTask && (
          <ScheduleMenu
            itemId={item.id}
            pinnedDate={item.pinnedDate}
            today={today}
            onScheduled={onMoved}
            label={item.title}
          />
        )}
        <MoveToMenu
          itemId={item.id}
          areaId={item.areaId}
          kind={item.kind}
          today={today}
          onMoved={onMoved}
          label={item.title}
        />
      </div>
      {tray && <div className="strip-tray">{tray}</div>}
    </li>
  );
}
