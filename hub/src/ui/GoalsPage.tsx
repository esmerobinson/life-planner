import { useContext, useState } from "react";
import { isActive } from "../domain/goalCounts";
import type { ISODate } from "../domain/types";
import { useAddDefaults } from "./addContext";
import { GOAL_AREAS_MIND_FIRST } from "./areas";
import { ChooseGoalsSheet } from "./ChooseGoalsSheet";
import { areaLabel } from "./GoalProgress";
import { GoalForm } from "./GoalForm";
import { GoalTile } from "./GoalTile";
import { ShellContext } from "./shellContext";
import { SuggestedGoals } from "./SuggestedGoals";
import { useGoalSources } from "./useGoalSources";
import { useHubData } from "./useHubData";
import { usePhone } from "./usePhone";

/**
 * The Goals page (VISUAL-LANGUAGE.md "Goals redesign"; mockup-goals-choices.html section 1
 * tab A): the Suggested goals card until dismissed, the Active / Inactive toggle, then the
 * goals as colour-band tiles in a grid, grouped by area with Mind first. On a phone, "Choose
 * goals" (which goals show on Home) opens from here.
 */
export function GoalsPage({ today }: { today: ISODate }) {
  const { items, goals, refresh, loaded, error } = useHubData(today);
  const { sources } = useGoalSources(items);
  const shell = useContext(ShellContext);
  const phone = usePhone();
  const [showInactive, setShowInactive] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const listed = goals.filter((g) => isActive(g) !== showInactive);
  // Add opens as a goal in the first area section shown (Mind when none).
  const firstShown = GOAL_AREAS_MIND_FIRST.find((a) => listed.some((g) => g.areaId === a.id));
  useAddDefaults("goal", (firstShown ?? GOAL_AREAS_MIND_FIRST[0]).id);

  /** Re-read here, then tell the shell so other readers (e.g. an open quick-add) see the change. */
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
  // Mind first, then sidebar order; then any other area a goal names (e.g. from a hand-made backup), so no goal is hidden.
  const known = new Set<string>(GOAL_AREAS_MIND_FIRST.map((a) => a.id));
  const others = [...new Set(listed.map((g) => g.areaId).filter((id) => !known.has(id)))];
  const groups = [...GOAL_AREAS_MIND_FIRST, ...others.map((id) => ({ id, label: areaLabel(id) }))];

  return (
    <section className="goals-page">
      <h1>Goals</h1>
      {loaded && <SuggestedGoals goals={goals} today={today} onChanged={saved} />}
      <div className="goals-toggle" role="group" aria-label="Show">
        <button type="button" aria-pressed={!showInactive} onClick={() => setShowInactive(false)}>
          Active
        </button>
        <button type="button" aria-pressed={showInactive} onClick={() => setShowInactive(true)}>
          Inactive
        </button>
      </div>
      {phone && loaded && goals.some(isActive) && (
        <p className="home-choose">
          <button type="button" className="quiet-link" onClick={() => setChoosing(true)}>
            Choose goals
          </button>
        </p>
      )}
      {loaded && goals.length === 0 && <p>No goals yet.</p>}
      {loaded && goals.length > 0 && listed.length === 0 && <p>{showInactive ? "No inactive goals." : "No active goals."}</p>}
      {groups.map((area) => {
        const mine = listed.filter((g) => g.areaId === area.id);
        if (mine.length === 0) return null;
        return (
          <section key={area.id} className="goals-area">
            <h2>{area.label}</h2>
            <ul aria-label={`${area.label} goals`} className="goal-grid">
              {mine.map((g) => (
                <GoalTile key={g.id} goal={g} items={items} today={today} sources={sources} onChanged={saved} />
              ))}
            </ul>
          </section>
        );
      })}
      <GoalForm today={today} onSaved={saved} />
      {choosing && <ChooseGoalsSheet goals={goals} onChanged={saved} onClose={() => setChoosing(false)} />}
    </section>
  );
}
