import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { tickItem } from "../data/repo";
import { dueLine } from "../domain/display";
import { HABIT_WORDS, isHabit } from "../domain/habits";
import type { ISODate, Item } from "../domain/types";
import { CelebrationPlaceholder } from "./CelebrationPlaceholder";
import { FLAG_GLYPH, REPEAT_GLYPH } from "./IconPopover";
import { useSaveError } from "./messages";
import { MoveToMenu } from "./MoveToMenu";
import { usePanel } from "./panelContext";
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

/** Interactive things inside a strip body that must not also open the panel. */
const OWN_CLICK = "button, a, input, select, textarea, summary, label";

/**
 * A strip's title: the repeat symbol for a habit, the flag for a milestone, then the
 * title. Inside the app shell it is a button that opens the side panel.
 */
export function StripTitle({ item, untyped = false }: { item: Item; untyped?: boolean }) {
  const panel = usePanel();
  const body = (
    <>
      {!untyped && isHabit(item) && (
        <span className="strip-glyph" aria-hidden="true">
          {REPEAT_GLYPH}
        </span>
      )}
      {!untyped && item.milestone && (
        <span className="strip-glyph" title="Milestone">
          {FLAG_GLYPH}
          <span className="visually-hidden">Milestone: </span>
        </span>
      )}
      {item.title}
    </>
  );
  return panel ? (
    <button type="button" className="strip-title strip-open" onClick={() => panel.open(item.id)}>
      {body}
    </button>
  ) : (
    <div className="strip-title">{body}</div>
  );
}

/** Clicking anywhere in a strip's body (not its own controls) opens the panel too. */
export function useOpenOnBodyClick(id: string) {
  const panel = usePanel();
  return panel
    ? (e: MouseEvent<HTMLDivElement>) => {
        if ((e.target as Element).closest(OWN_CLICK)) return;
        panel.open(id);
      }
    : undefined;
}

/**
 * One task (or idea) as a strip: tick box on the left (Done; tasks only), title with the
 * due line under it, and the Schedule for (tasks only) and Move to icons on the right.
 * Clicking the title (or anywhere in the body) opens it in the side panel.
 * `meta` adds lines under the title, `extra` sits before the icons, `tray` is a second
 * line under the title for a page's own controls, `trail` sits after the icons.
 * `untyped` is for Inbox items, which have no type until they are sorted: no tick box,
 * and nothing that depends on the stored kind (the calendar shows, Move to has no
 * "Change to").
 * `crossed`: ticked off today and kept in place (a habit done today; a to-do done today on
 * the Today list): ticked box, struck-through title; unticking calls `onUntick`.
 * A habit (recurring to-do) shows the repeat symbol and its schedule, or "Done for today".
 */
export function TaskRow({
  item,
  today,
  onTick,
  onUntick,
  crossed = false,
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
  /** Unticks a crossed-off strip. */
  onUntick?: (id: string) => void | Promise<unknown>;
  crossed?: boolean;
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
  // Shows the box ticked until the refresh removes (or crosses off) the row.
  const [ticked, setTicked] = useState(false);
  useEffect(() => {
    if (!crossed) setTicked(false);
  }, [crossed]);
  const openOnClick = useOpenOnBodyClick(item.id);
  const isTask = untyped || item.kind === "task";
  const habit = !untyped && isHabit(item);
  const tick = !untyped && isTask && onTick !== undefined;
  const checked = crossed || ticked;
  return (
    <li className={["strip", tick ? "" : "no-tick", crossed ? "crossed" : "", className ?? ""].filter(Boolean).join(" ")}>
      {tick && (
        <input
          type="checkbox"
          className="tick"
          aria-label={crossed ? `Done: ${item.title}` : `Mark done: ${item.title}`}
          checked={checked}
          onChange={async () => {
            if (crossed) {
              await onUntick?.(item.id);
              return;
            }
            if (ticked) return;
            setTicked(true);
            if ((await onTick(item.id)) === false) setTicked(false);
          }}
        />
      )}
      <div className={openOnClick ? "strip-body openable" : "strip-body"} onClick={openOnClick}>
        <StripTitle item={item} untyped={untyped} />
        {isTask && !crossed && <DueLine item={item} today={today} />}
        {habit && <div className="strip-meta">{crossed ? HABIT_WORDS.doneForToday : HABIT_WORDS.schedule(item.recur)}</div>}
        {meta}
      </div>
      <div className="strip-actions">
        {extra}
        {isTask && !habit && !crossed && (
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
          untyped={untyped}
          today={today}
          onMoved={onMoved}
          label={item.title}
          onTodayList={onTodayList}
          milestone={!untyped && item.kind === "task" && item.goalId ? item.milestone === true : undefined}
        />
        {trail}
      </div>
      {tray && <div className="strip-tray">{tray}</div>}
    </li>
  );
}
