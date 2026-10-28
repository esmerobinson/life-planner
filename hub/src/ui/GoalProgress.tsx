import { Link } from "react-router-dom";
import { monthName, shortDate } from "../domain/display";
import { monthlyProgress, nextStep, overallProgress, tickedOff } from "../domain/progress";
import type { Goal, ISODate, Item } from "../domain/types";
import { AREA_CHOICES, NAV } from "./areas";
import { usePanel } from "./panelContext";
import { ProgressBar } from "./ProgressBar";

export function areaLabel(id: string): string {
  return AREA_CHOICES.find((a) => a.id === id)?.label ?? id;
}

/** The month count at the top of an area page (4A): ticked off this month vs last month's total. */
export function MonthProgress({ areaId, items, today }: { areaId: string; items: Item[]; today: ISODate }) {
  const t = tickedOff(areaId, items, today);
  const month = monthName(today);
  const text = t.thisMonth > 0 ? `${t.thisMonth} ticked off in ${month}` : `Nothing ticked off yet in ${month}`;
  return (
    <section className="month-progress" aria-label="Ticked off this month">
      <div className="bar-label">
        <span>
          <b>{text}</b>
        </span>
        <span>{`last month ${t.lastMonth}`}</span>
      </div>
      <ProgressBar ratio={t.ratio} label={`${t.thisMonth} ticked off in ${month}, last month ${t.lastMonth}`} />
    </section>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * A goal as a list entry (3A): area tile, title, chips (area; "By <date>" or "Practice"),
 * the Overall bar (finite, once it has linked tasks), this month's bar (with a monthly
 * target) and the next step. The title link covers the whole card and opens the goal in
 * the side panel (`?open=<id>`).
 */
export function GoalCard({ goal, items, today }: { goal: Goal; items: Item[]; today: ISODate }) {
  const panel = usePanel();
  const nav = NAV.find((n) => n.id === goal.areaId);
  const month = monthlyProgress(goal, items, today);
  const overall = overallProgress(goal, items, today);
  const next = nextStep(goal, items, today);
  const pct = (r: number) => `${Math.round(Math.min(1, Math.max(0, r)) * 100)}%`;
  const streak = overall.kind === "evidence" && overall.monthsInARow > 0 ? overall.monthsInARow : 0;
  return (
    <li className="goal-card">
      <div className="goal-head">
        <span className="goal-tile" style={{ background: nav?.tile }}>
          {nav && <img src={nav.icon} alt="" width={24} height={24} />}
        </span>
        <div>
          <h3 className="goal-title">
            <Link
              to={panel ? panel.href(goal.id) : { search: `?open=${encodeURIComponent(goal.id)}` }}
              onClick={(e) => {
                if (!panel || e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                panel.open(goal.id);
              }}
            >
              {goal.title}
            </Link>
          </h3>
          <div>
            <span className="chip">{areaLabel(goal.areaId)}</span>{" "}
            <span className="chip">
              {goal.kind === "finite" && goal.deadline ? `By ${shortDate(goal.deadline, today)}` : "Practice"}
            </span>
          </div>
        </div>
      </div>
      {overall.kind === "milestones" && overall.total > 0 && (
        <div>
          <div className="bar-label">
            <span>Overall</span>
            <span>{pct(overall.ratio)}</span>
          </div>
          <ProgressBar ratio={overall.ratio} label={`Overall ${overall.done}/${overall.total}`} />
        </div>
      )}
      {month && (
        <div>
          <div className="bar-label">
            <span>{`${monthName(today)}: ${month.done} of ${month.target}`}</span>
            <span>{streak > 0 ? `${plural(streak, "month")} in a row` : pct(month.ratio)}</span>
          </div>
          <ProgressBar ratio={month.ratio} label={`This month ${month.done}/${month.target}`} />
        </div>
      )}
      {next && (
        <div className="goal-next">
          <b>Next:</b> {next.title}
        </div>
      )}
    </li>
  );
}
