import { Link } from "react-router-dom";
import { monthlyProgress } from "../domain/progress";
import type { ISODate } from "../domain/types";
import { GoalProgress } from "./GoalProgress";
import { JournalCardStub } from "./JournalCardStub";
import { TodayPanel } from "./TodayPanel";
import { useHubData } from "./useHubData";

export function HomePage({ today }: { today: ISODate }) {
  const { items, goals, loaded } = useHubData(today);
  const withTargets = goals.filter((g) => monthlyProgress(g, items, today) !== null);

  return (
    <div className="home-page">
      <div className="home-centre">
        <TodayPanel today={today} />
        <JournalCardStub />
      </div>
      <aside className="home-goals" aria-label="Goals this month">
        <h2>Goals this month</h2>
        {loaded && withTargets.length === 0 && (
          <p>
            No monthly targets yet. <Link to="/goals">Go to goals</Link>
          </p>
        )}
        {withTargets.length > 0 && (
          <ul className="goal-list">
            {withTargets.map((g) => (
              <li key={g.id} className="goal-card">
                <h3>
                  <Link to={`/goals/${g.id}`}>{g.title}</Link>
                </h3>
                <GoalProgress goal={g} items={items} today={today} />
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
