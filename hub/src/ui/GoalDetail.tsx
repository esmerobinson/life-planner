import { useContext } from "react";
import { useParams } from "react-router-dom";
import { toggleMilestone, untickItem } from "../data/repo";
import { addDays, mondayOf } from "../domain/dates";
import { monthlyProgress } from "../domain/progress";
import type { ISODate, Item } from "../domain/types";
import { DoneSection } from "./DoneSection";
import { areaLabel, GoalProgress } from "./GoalProgress";
import { useSaveError } from "./messages";
import { ShellContext } from "./shellContext";
import { TaskRow, useTick } from "./TaskRow";
import { useHubData } from "./useHubData";

function group(items: Item[], today: ISODate): { name: string; items: Item[] }[] {
  const monday = mondayOf(today);
  const sunday = addDays(monday, 6);
  const out = { Today: [] as Item[], "This week": [] as Item[], Later: [] as Item[] };
  for (const it of items) {
    if (it.pinnedDate === today) out.Today.push(it);
    else if (it.weekOf === monday || (it.pinnedDate && it.pinnedDate >= monday && it.pinnedDate <= sunday)) {
      out["This week"].push(it);
    } else out.Later.push(it);
  }
  return Object.entries(out).map(([name, items]) => ({ name, items }));
}

export function GoalDetail({ today }: { today: ISODate }) {
  const { id } = useParams();
  const { items, goals, refresh, loaded, error } = useHubData(today);
  const { tick, celebration, message } = useTick(today, refresh);
  const { attempt, saveError } = useSaveError();
  const shell = useContext(ShellContext);
  const goal = goals.find((g) => g.id === id);

  if (!loaded) return null;
  if (error) return <p>{error}</p>;
  if (!goal) return <p>That goal does not exist.</p>;

  /** Write, then re-read here and tell the shell so every other page re-reads too. */
  async function save(fn: () => Promise<unknown>) {
    if (!(await attempt(fn))) return;
    await refresh();
    await shell?.refresh();
  }

  const month = monthlyProgress(goal, items, today);
  const open = items.filter((i) => i.goalId === goal.id && i.kind === "task" && i.status === "open");
  const groups = group(open, today).filter((g) => g.items.length > 0);

  return (
    <section className="goal-detail">
      <h1>{goal.title}</h1>
      <span className="goal-area">{areaLabel(goal.areaId)}</span>
      {goal.deadline && <p>{`Deadline ${goal.deadline}`}</p>}
      {goal.why?.split(/\n+/).filter(Boolean).map((t, n) => (
        <p key={"w" + n} className="goal-why">{t}</p>
      ))}
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
        <ul aria-label="Milestones">
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
          <ul aria-label={g.name}>
            {g.items.map((it) => (
              <TaskRow key={it.id} item={it} today={today} onTick={(i) => void tick(i)} onMoved={refresh} />
            ))}
          </ul>
        </div>
      ))}
      <DoneSection
        items={items.filter((i) => i.goalId === goal.id && i.kind === "task")}
        onUndo={(itemId) => void save(() => untickItem(itemId, today))}
      />
    </section>
  );
}
