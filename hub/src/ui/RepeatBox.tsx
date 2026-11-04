import { Link } from "react-router-dom";
import { HABIT_WORDS, isHabit, stoppedRepeat } from "../domain/habits";
import type { ISODate, Item } from "../domain/types";
import { areaLabel } from "./GoalProgress";
import { useRepeatActions } from "./useRepeatActions";

/** Where an area's name links to: its page (the Inbox has its own). */
export const areaPath = (areaId: string) => (areaId === "inbox" ? "/inbox" : `/area/${areaId}`);

/**
 * Near the top of a repeating item's side panel: what it repeats on and where it lives
 * ("Repeats Mondays, Wednesdays and Fridays · in Body", the area a link), then Stop repeating
 * and Delete. After Stop repeating the days are put away, so the panel says what it used to
 * repeat on and offers Repeat again. Ticking it never stops the repeat; only these do.
 */
export function RepeatBox({ item, today, onChanged }: { item: Item; today: ISODate; onChanged: () => Promise<void> }) {
  const actions = useRepeatActions(today, onChanged);
  const open = item.status === "open" || item.status === "done";
  const parked = open ? stoppedRepeat(item) : undefined;
  if (!(open && isHabit(item)) && !parked) return null;

  return (
    <div className="repeat-box">
      {isHabit(item) ? (
        <>
          <p>
            {HABIT_WORDS.repeatsLine(item.recur)} · in <Link to={areaPath(item.areaId)}>{areaLabel(item.areaId)}</Link>
          </p>
          <div className="btn-group">
            <button type="button" className="btn-secondary" onClick={() => void actions.stop(item)}>
              Stop repeating
            </button>
            <button type="button" className="btn-secondary" onClick={() => void actions.remove(item)}>
              Delete
            </button>
          </div>
        </>
      ) : (
        <>
          <p>{`Used to repeat ${HABIT_WORDS.schedule(parked)}`}</p>
          <div className="btn-group">
            <button type="button" className="btn-secondary" onClick={() => void actions.again(item)}>
              Repeat again
            </button>
          </div>
        </>
      )}
      {actions.saveError && <p className="form-message">{actions.saveError}</p>}
    </div>
  );
}
