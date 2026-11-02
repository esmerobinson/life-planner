import { useContext, useState } from "react";
import { Link } from "react-router-dom";
import { setGoalOnHome } from "../data/repo";
import { monthlyProgress } from "../domain/progress";
import type { Goal, ISODate, Item } from "../domain/types";
import { GOAL_AREAS_BY_SIDEBAR, NAV } from "./areas";
import { areaLabel, GoalCard } from "./GoalProgress";
import { useSaveError } from "./messages";
import { ShellContext } from "./shellContext";
import { FooterLinks } from "./Sidebar";
import { usePhone } from "./usePhone";
import { JournalCard } from "./JournalCard";
import { TodayPanel } from "./TodayPanel";
import { useHubData } from "./useHubData";

export function HomePage({ today }: { today: ISODate }) {
  return usePhone() ? <PhoneHome today={today} /> : <DesktopHome today={today} />;
}

/**
 * Phone Home (mockup-phone.html tab A, VISUAL-LANGUAGE.md "Phone layout"): the app grid
 * of every sidebar destination except Home, the Journal card (Esme: on the first screen,
 * 2026-10-28), then Today's list, then the quiet footer
 * links (the sidebar's own list). The "Esmeworld" title is in the shell's top bar.
 */
function PhoneHome({ today }: { today: ISODate }) {
  return (
    <div className="phone-home">
      <nav aria-label="Main">
        <ul className="phone-apps">
          {NAV.filter((n) => n.id !== "home").map((n) => (
            <li key={n.id}>
              <Link to={n.path} className="phone-app">
                <span className="phone-app-tile" style={{ background: n.tile }}>
                  <img src={n.icon} alt="" />
                </span>
                <span>{n.label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <JournalCard />
      <TodayPanel today={today} headingLevel={2} />
      <nav aria-label="More" className="phone-footer">
        <FooterLinks />
      </nav>
    </div>
  );
}

/** Goals in sidebar area order (then any other area), keeping their order within an area. */
function bySidebar(goals: Goal[]): Goal[] {
  const rank = (g: Goal) => {
    const n = GOAL_AREAS_BY_SIDEBAR.findIndex((a) => a.id === g.areaId);
    return n === -1 ? GOAL_AREAS_BY_SIDEBAR.length : n;
  };
  return goals.map((g, i) => ({ g, i })).sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i).map((x) => x.g);
}

/**
 * The Home goals column: the goals she chose ("Show on Home"), in sidebar area order; when
 * none are chosen, every goal with a monthly target (the column before choosing existed).
 */
export function homeGoals(goals: Goal[], items: Item[], today: ISODate): { goals: Goal[]; chosen: boolean } {
  const chosen = goals.filter((g) => g.onHome === true);
  if (chosen.length > 0) return { goals: bySidebar(chosen), chosen: true };
  return { goals: goals.filter((g) => monthlyProgress(g, items, today) !== null), chosen: false };
}

function DesktopHome({ today }: { today: ISODate }) {
  const { items, goals, loaded, error, refresh } = useHubData(today);
  const shell = useContext(ShellContext);
  const [choosing, setChoosing] = useState(false);
  const shown = homeGoals(goals, items, today);

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
        <JournalCard />
      </div>
      <aside className="home-goals" aria-label="Goals this month">
        <h2>Goals this month</h2>
        {choosing ? (
          <ChooseGoals
            goals={goals}
            onChanged={async () => {
              await refresh();
              await shell?.refresh();
            }}
            onDone={() => setChoosing(false)}
          />
        ) : (
          <>
            {loaded && shown.goals.length === 0 && (
              <p>
                No monthly targets yet. <Link to="/goals">Go to goals</Link>
              </p>
            )}
            {shown.goals.length > 0 && (
              <ul className="goal-list">
                {shown.goals.map((g) => (
                  <GoalCard key={g.id} goal={g} items={items} today={today} />
                ))}
              </ul>
            )}
            {loaded && goals.length > 0 && (
              <p className="home-choose">
                <button type="button" className="quiet-link" onClick={() => setChoosing(true)}>
                  Choose goals
                </button>
              </p>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

/**
 * "Choose goals": every live goal, grouped by area in sidebar order, with a box to tick
 * for the ones that show on Home. Each tick saves at once; Done goes back to the cards.
 */
function ChooseGoals({
  goals,
  onChanged,
  onDone,
}: {
  goals: Goal[];
  onChanged: () => Promise<void>;
  onDone: () => void;
}) {
  const { attempt, saveError } = useSaveError();
  const sorted = bySidebar(goals);
  const areas = [...new Set(sorted.map((g) => g.areaId))];
  async function toggle(g: Goal, on: boolean) {
    if (await attempt(() => setGoalOnHome(g.id, on))) await onChanged();
  }
  return (
    <div className="choose-goals">
      <p>Tick the goals to show here.</p>
      {areas.map((areaId) => (
        <fieldset key={areaId}>
          <legend>{areaLabel(areaId)}</legend>
          {sorted
            .filter((g) => g.areaId === areaId)
            .map((g) => (
              <label key={g.id} className="form-check">
                <input type="checkbox" checked={g.onHome === true} onChange={(e) => void toggle(g, e.target.checked)} />
                {g.title}
              </label>
            ))}
        </fieldset>
      ))}
      {saveError && <p className="form-message">{saveError}</p>}
      <div className="form-actions">
        <button type="button" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
