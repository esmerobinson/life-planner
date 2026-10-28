import { useContext } from "react";
import type { ISODate } from "../domain/types";
import { GOAL_AREAS_BY_SIDEBAR } from "./areas";
import { areaLabel, GoalCard } from "./GoalProgress";
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
  // Sidebar areas first; then any other area a goal names (e.g. from a hand-made backup), so no goal is hidden.
  const known = new Set<string>(GOAL_AREAS_BY_SIDEBAR.map((a) => a.id));
  const others = [...new Set(goals.map((g) => g.areaId).filter((id) => !known.has(id)))];
  const groups = [...GOAL_AREAS_BY_SIDEBAR, ...others.map((id) => ({ id, label: areaLabel(id) }))];

  return (
    <section className="goals-page">
      <h1>Goals</h1>
      {loaded && goals.length === 0 && <p>No goals yet.</p>}
      {groups.map((area) => {
        const mine = goals.filter((g) => g.areaId === area.id);
        if (mine.length === 0) return null;
        return (
          <section key={area.id}>
            <h2>{area.label}</h2>
            <ul aria-label={`${area.label} goals`} className="goal-list">
              {mine.map((g) => (
                <GoalCard key={g.id} goal={g} items={items} today={today} />
              ))}
            </ul>
          </section>
        );
      })}
      <GoalForm today={today} onSaved={saved} />
    </section>
  );
}
