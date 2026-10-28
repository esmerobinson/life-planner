import { Link } from "react-router-dom";
import { monthlyProgress } from "../domain/progress";
import type { ISODate } from "../domain/types";
import { GoalCard } from "./GoalProgress";
import { JournalCardStub } from "./JournalCardStub";
import { TodayPanel } from "./TodayPanel";
import { useHubData } from "./useHubData";

export function HomePage({ today }: { today: ISODate }) {
  const { items, goals, loaded, error } = useHubData(today);
  const withTargets = goals.filter((g) => monthlyProgress(g, items, today) !== null);

  // One line for the whole page; the Today panel would otherwise repeat it.
  if (error) {
    return (
      <div className="home-page">
        <p>{error}</p>
      </div>
    );
  }

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
              <GoalCard key={g.id} goal={g} items={items} today={today} />
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}
