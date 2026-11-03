import { setSessionDone } from "../data/repo";
import { countdown, projectLine, todayLine } from "../domain/projects";
import type { ISODate, Item } from "../domain/types";
import { dueLine } from "../domain/display";
import { TickBox } from "./GoalTile";
import { useSaveError } from "./messages";

/** A session box's accessible name: "Session 3", or "Session 3: Market stalls" when named. */
export const sessionBoxLabel = (title: string | undefined, index: number) =>
  title ? `Session ${index + 1}: ${title}` : `Session ${index + 1}`;

/**
 * The small line under a project's title (2C). On an area list: "Next: <title>" (or
 * "Session 3 of 4") and the due line with the days left; on Today: "Session 3 of 4 today ·
 * <title>" and the plain due line. The due part turns red when late, as on every strip; a
 * day it is pinned to follows, as on a to-do.
 */
export function ProjectLine({ item, today, onToday }: { item: Item; today: ISODate; onToday: boolean }) {
  const line = onToday ? todayLine(item, today) : projectLine(item, today);
  const on = dueLine(item, today).on;
  return (
    <div className="strip-meta">
      <span>{line.lead}</span>
      {line.due && (
        <>
          {" · "}
          <span className={line.late ? "strip-late" : undefined}>{line.due}</span>
        </>
      )}
      {on && ` · ${on}`}
    </div>
  );
}

/** One small tick box per session (the goal-step boxes), ticked ones filled; each ticks that session. */
export function SessionBoxes({ item, today, onChanged }: { item: Item; today: ISODate; onChanged: () => void | Promise<void> }) {
  const { attempt, saveError } = useSaveError();
  async function set(sessionId: string, done: boolean) {
    if (await attempt(() => setSessionDone(item.id, sessionId, done, today))) await onChanged();
  }
  return (
    <>
      <div className="session-boxes" role="group" aria-label={`Sessions: ${item.title}`}>
        {(item.sessions ?? []).map((s, i) => (
          <TickBox
            key={s.id}
            small
            checked={s.doneOn !== undefined}
            label={sessionBoxLabel(s.title, i)}
            onChange={(next) => void set(s.id, next)}
          />
        ))}
      </div>
      {saveError && <span className="form-message">{saveError}</span>}
    </>
  );
}

/** The thin countdown bar along the strip's bottom edge (2C): it empties towards the deadline. */
export function ProjectEdge({ item, today }: { item: Item; today: ISODate }) {
  const left = countdown(item, today);
  if (left === null) return null;
  return (
    <span className="project-edge" aria-hidden="true">
      <span className="project-edge-bar">
        <span className="project-edge-fill" style={{ width: `${left * 100}%` }} />
      </span>
    </span>
  );
}
