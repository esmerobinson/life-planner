import { tickDailyGoal } from "../data/repo";
import { countsItself, dailyStatus, isActive, isDaily } from "../domain/goalCounts";
import type { Goal, ISODate } from "../domain/types";
import { byArea } from "./ChooseGoalsSheet";
import { TickBox } from "./GoalTile";
import type { GoalSourcesView } from "./useGoalSources";
import { JournalRow, type TickState } from "./journal/JournalStrip";
import { useSaveError } from "./messages";
import { usePanel } from "./panelContext";
import { Streak } from "./Streak";

/**
 * Daily goals chosen for Home, as mint rows at the top of Today (goals-redesign-brief.md:
 * "this is how 'BPD practice every day' becomes a present goal"): the Journal rows' strip
 * (mint, the streak on the right). A goal that counts itself has the read-only tick, ticked
 * when something counted today; one without sources has a normal tick that logs today.
 * Tapping the row opens the goal.
 */
export function DailyGoalRows({
  goals, today, view, onChanged,
}: { goals: Goal[]; today: ISODate; view: GoalSourcesView; onChanged: () => Promise<void> }) {
  const panel = usePanel();
  const { attempt, saveError } = useSaveError();
  const daily = byArea(goals.filter((g) => isActive(g) && isDaily(g) && g.onHome === true));
  if (daily.length === 0) return null;
  return (
    <>
      {saveError && <p className="form-message">{saveError}</p>}
      <ul aria-label="Daily goals" className="strip-list daily-goal-rows">
        {daily.map((g) => {
          const st = dailyStatus(g, today, view.sources);
          const streak = <Streak n={st.streak} week={st.week} />;
          const open = () => panel?.open(g.id);
          if (countsItself(g)) {
            // Exercise cards can't be read while the journal is locked here: unknown, unless something else counted.
            const needsKey = g.countsFrom?.includes("exercise") ?? false;
            const tick: TickState = st.done ? "done" : !view.loaded ? "loading" : needsKey && view.exerciseLocked ? "locked" : "todo";
            return <JournalRow key={g.id} title={g.title} tick={tick} right={streak} onOpen={open} />;
          }
          return (
            <li key={g.id} className="strip journal-row journal-row-open" onClick={(e) => {
              if ((e.target as Element).closest("button, input")) return;
              open();
            }}>
              <TickBox
                checked={st.done}
                label={`${g.title} done today`}
                onChange={(next) => void attempt(() => tickDailyGoal(g.id, today, next)).then(async (ok) => {
                  if (ok) await onChanged();
                })}
              />
              <div className="strip-body">
                <button type="button" className="strip-title strip-open" onClick={open}>
                  {g.title}
                </button>
              </div>
              <div className="strip-actions">{streak}</div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
