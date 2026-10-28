import { useContext } from "react";
import type { ISODate } from "../domain/types";
import { GoalCard } from "./GoalProgress";
import { GoalForm } from "./GoalForm";
import { ShellContext } from "./shellContext";
import { useHubData } from "./useHubData";

export function GoalsPage({ today }: { today: ISODate }) {
  const { items, goals, refresh, loaded, error } = useHubData(today);
  const shell = useContext(ShellContext);

  /** Re-read here, then tell the shell so other readers (e.g. an open quick-add) see the new goal. */
  async function saved() {
    await refresh();
    await shell?.refresh();
  }

  if (error) {
    return (
      <section className="goals-page">
        <h1>Goals</h1>
        <p>{error}</p>
      </section>
    );
  }
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
      <GoalForm today={today} onSaved={saved} />
    </section>
  );
}
