import { useContext, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { deleteGoal, toggleMilestone, untickItem, updateGoal } from "../data/repo";
import { groupGoalTasks, monthlyProgress } from "../domain/progress";
import type { ISODate } from "../domain/types";
import { DoneSection } from "./DoneSection";
import { GoalEditForm } from "./GoalEditForm";
import { areaLabel, GoalProgress } from "./GoalProgress";
import { useSaveError } from "./messages";
import { ShellContext } from "./shellContext";
import { TaskRow, useTick } from "./TaskRow";
import { useHubData } from "./useHubData";

export function GoalDetail({ today }: { today: ISODate }) {
  const { id } = useParams();
  const { items, goals, refresh, loaded, error } = useHubData(today);
  const { tick, celebration, message } = useTick(today, refresh);
  const { attempt, saveError } = useSaveError();
  const shell = useContext(ShellContext);
  const goal = goals.find((g) => g.id === id);
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);

  if (!loaded) return null;
  if (error) return <p>{error}</p>;
  if (!goal) return <p>That goal does not exist.</p>;

  /** Re-read here and tell the shell so every other page re-reads too. */
  async function changed() {
    await refresh();
    await shell?.refresh();
  }

  /** Write, then re-read everywhere. */
  async function save(fn: () => Promise<unknown>) {
    if (!(await attempt(fn))) return;
    await changed();
  }

  const month = monthlyProgress(goal, items, today);
  const groups = groupGoalTasks(goal, items, today).filter((g) => g.items.length > 0);

  return (
    <section className="goal-detail">
      <h1>{goal.title}</h1>
      <span className="goal-area">{areaLabel(goal.areaId)}</span>
      {goal.deadline && <p>{`Deadline ${goal.deadline}`}</p>}
      {goal.why?.split(/\n+/).filter(Boolean).map((t, n) => (
        <p key={"w" + n} className="goal-why">{t}</p>
      ))}
      {goal.notes && <p className="goal-notes">{goal.notes}</p>}
      {goal.cadence?.split(/\n+/).filter(Boolean).map((t, n) => (
        <p key={"c" + n} className="goal-cadence">{t}</p>
      ))}
      {celebration}
      {message}
      {saveError && <p className="form-message">{saveError}</p>}
      <GoalProgress goal={goal} items={items} today={today} />
      {month && (
        <p>
          {month.done >= month.target
            ? "Target reached"
            : `${month.target - month.done} more to reach this month's target`}
        </p>
      )}
      {goal.kind === "finite" && goal.milestones.length > 0 && (
        <ul aria-label="Milestones" className="plain-list">
          {goal.milestones.map((m) => (
            <li key={m.id}>
              <label>
                <input
                  type="checkbox"
                  checked={m.done}
                  onChange={() => void save(() => toggleMilestone(goal.id, m.id))}
                />
                {m.title}
              </label>
            </li>
          ))}
        </ul>
      )}
      {groups.length === 0 && <p>No open tasks attached to this goal.</p>}
      {groups.map((g) => (
        <div key={g.name}>
          <h2>{g.name}</h2>
          <ul aria-label={g.name} className="strip-list">
            {g.items.map((it) => (
              <TaskRow key={it.id} item={it} today={today} onTick={tick} onMoved={changed} />
            ))}
          </ul>
        </div>
      ))}
      <DoneSection
        items={items.filter((i) => i.goalId === goal.id && i.kind === "task" && i.areaId !== "inbox")}
        today={today}
        onUndo={(itemId) => void save(() => untickItem(itemId, today))}
      />
      <GoalEditForm
        key={`${goal.id}|${goal.title}|${goal.areaId}|${goal.deadline}|${goal.monthlyTarget}`}
        goal={goal}
        onSave={(patch) => save(() => updateGoal(goal.id, patch, today))}
      />
      {/* Delete goal: to the Bin (restorable there), after the same confirm step as Empty bin. */}
      {!asking ? (
        <button type="button" className="btn-secondary" onClick={() => setAsking(true)}>
          Delete goal
        </button>
      ) : (
        <div className="btn-group">
          <p>Delete this goal? You can restore it from the Bin.</p>
          <button
            type="button"
            onClick={() =>
              void attempt(() => deleteGoal(goal.id, today)).then(async (ok) => {
                if (!ok) return;
                await shell?.refresh();
                navigate("/goals");
              })
            }
          >
            Confirm
          </button>
          <button type="button" className="btn-secondary" onClick={() => setAsking(false)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
