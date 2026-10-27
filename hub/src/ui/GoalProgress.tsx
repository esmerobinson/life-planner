import { Link } from "react-router-dom";
import { monthlyProgress, overallProgress } from "../domain/progress";
import type { Goal, ISODate, Item } from "../domain/types";
import { AREA_CHOICES } from "./areas";
import { ProgressBar } from "./ProgressBar";

export function areaLabel(id: string): string {
  return AREA_CHOICES.find((a) => a.id === id)?.label ?? id;
}

/** The two progress displays: this month, and the overall arc. */
export function GoalProgress({ goal, items, today }: { goal: Goal; items: Item[]; today: ISODate }) {
  const month = monthlyProgress(goal, items, today);
  const overall = overallProgress(goal, items, today);
  return (
    <div className="goal-progress">
      {month ? (
        <div>
          <span>This month</span> <span>{`${month.done}/${month.target}`}</span>
          <ProgressBar ratio={month.ratio} label={`This month ${month.done}/${month.target}`} />
        </div>
      ) : (
        <p>Set a monthly target to see progress this month.</p>
      )}
      {overall.kind === "milestones" ? (
        <div>
          <span>Overall</span> <span>{`${overall.done}/${overall.total}`}</span>
          <ProgressBar ratio={overall.ratio} label={`Overall ${overall.done}/${overall.total}`} />
          {overall.total === 0 && <p>Add milestones to see the overall arc.</p>}
        </div>
      ) : (
        <p>{`${overall.thisYear} this year, ${overall.monthsInARow} months in a row, ${overall.streakDays} day streak`}</p>
      )}
    </div>
  );
}

export function GoalCard({ goal, items, today }: { goal: Goal; items: Item[]; today: ISODate }) {
  return (
    <li className="goal-card">
      <h3>
        <Link to={`/goals/${goal.id}`}>{goal.title}</Link>
      </h3>
      <span className="goal-area">{areaLabel(goal.areaId)}</span>
      <GoalProgress goal={goal} items={items} today={today} />
    </li>
  );
}
