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
  /** Returns whether the tick saved. */
  async function tick(id: string): Promise<boolean> {
    if (!(await attempt(() => tickItem(id, today)))) return false;
    setCelebrating(true);
    await refresh();
    return true;
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
 * line under the title for a page's own controls, `trail` sits after the icons.
 * `untyped` is for Inbox items, which have no type until they are sorted: no tick box,
 * and nothing that depends on the stored kind (the calendar shows, Move to has no
 * "Change to").
 */
export function TaskRow({
  item,
  today,
  onTick,
  onMoved,
  meta,
  extra,
  tray,
  trail,
  untyped = false,
  className,
  onTodayList,
}: {
  item: Item;
  today: ISODate;
  /** Marks it done; resolving to false (the save failed) unticks the box again. */
  onTick?: (id: string) => void | Promise<boolean | void>;
  onMoved: () => void | Promise<void>;
  meta?: ReactNode;
  extra?: ReactNode;
  tray?: ReactNode;
  trail?: ReactNode;
  untyped?: boolean;
  className?: string;
  /** This strip is on the Today list (offers Remove from today). */
  onTodayList?: boolean;
}) {
  // Shows the box ticked until the refresh removes the row (React would otherwise snap it back).
  const [ticked, setTicked] = useState(false);
  const isTask = untyped || item.kind === "task";
  const tick = !untyped && isTask && onTick !== undefined;
  return (
    <li className={["strip", tick ? "" : "no-tick", className ?? ""].filter(Boolean).join(" ")}>
      {tick && (
        <input
          type="checkbox"
          className="tick"
          aria-label={`Mark done: ${item.title}`}
          checked={ticked}
          onChange={async () => {
            if (ticked) return;
            setTicked(true);
            if ((await onTick(item.id)) === false) setTicked(false);
          }}
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
          kind={untyped ? undefined : item.kind}
          today={today}
          onMoved={onMoved}
          label={item.title}
          onTodayList={onTodayList}
        />
        {trail}
      </div>
      {tray && <div className="strip-tray">{tray}</div>}
    </li>
  );
}
