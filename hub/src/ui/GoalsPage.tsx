import type { ISODate } from "../domain/types";
import { GoalCard } from "./GoalProgress";
import { GoalForm } from "./GoalForm";
import { useHubData } from "./useHubData";

export function GoalsPage({ today }: { today: ISODate }) {
  const { items, goals, refresh, loaded } = useHubData(today);
  return (
    <section className="goals-page">
      <h1>Goals</h1>
      {loaded && goals.length === 0 && <p>No goals yet.</p>}
      {goals.length > 0 && (
        <ul aria-label="Goals" className="goal-list">
          {goals.map((g) => (
            <GoalCard key={g.id} goal={g} items={items} today={today} />
          ))}
        </ul>
      )}
      <GoalForm today={today} onSaved={refresh} />
    </section>
  );
}
