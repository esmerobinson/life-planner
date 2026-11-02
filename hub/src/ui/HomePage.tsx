import { useContext, useState } from "react";
import { Link } from "react-router-dom";
import { useAddDefaults } from "./addContext";
import { isActive } from "../domain/goalCounts";
import { monthlyProgress } from "../domain/progress";
import type { Goal, ISODate, Item } from "../domain/types";
import { NAV } from "./areas";
import { byArea, ChooseGoalsSheet } from "./ChooseGoalsSheet";
import { GoalMiniCard } from "./GoalTile";
import { ShellContext } from "./shellContext";
import { useGoalSources } from "./useGoalSources";
import { FooterLinks } from "./Sidebar";
import { usePhone } from "./usePhone";
import { JournalCard } from "./JournalCard";
import { TodayPanel } from "./TodayPanel";
import { useHubData } from "./useHubData";

export function HomePage({ today }: { today: ISODate }) {
  useAddDefaults("task", "inbox"); // Home: Add opens as a to-do (in the inbox, as before)
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
      <JournalCard today={today} />
      <TodayPanel today={today} headingLevel={2} />
      <nav aria-label="More" className="phone-footer">
        <FooterLinks />
      </nav>
    </div>
  );
}

/**
 * The Home goals column: the active goals she chose ("Show on Home"), by area with Mind
 * first; when none are chosen, every active goal with a monthly target (the column before
 * choosing existed). Inactive goals never show.
 */
export function homeGoals(goals: Goal[], items: Item[], today: ISODate): { goals: Goal[]; chosen: boolean } {
  const live = goals.filter(isActive);
  const chosen = live.filter((g) => g.onHome === true);
  if (chosen.length > 0) return { goals: byArea(chosen), chosen: true };
  return { goals: live.filter((g) => monthlyProgress(g, items, today) !== null), chosen: false };
}

function DesktopHome({ today }: { today: ISODate }) {
  const { items, goals, loaded, error, refresh } = useHubData(today);
  const { sources } = useGoalSources(items);
  const shell = useContext(ShellContext);
  const [choosing, setChoosing] = useState(false);
  const shown = homeGoals(goals, items, today);
  const active = goals.filter(isActive);

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
        <JournalCard today={today} />
      </div>
      <aside className="home-goals" aria-label="Goals this month">
        <h2>Goals this month</h2>
        {loaded && active.length === 0 && (
          <p>
            No monthly targets yet. <Link to="/goals">Go to goals</Link>
          </p>
        )}
        {loaded && active.length > 0 && shown.goals.length === 0 && <p>Choose which goals show here.</p>}
        {shown.goals.length > 0 && (
          <ul className="goal-mini-list">
            {shown.goals.map((g) => (
              <GoalMiniCard key={g.id} goal={g} today={today} sources={sources} />
            ))}
          </ul>
        )}
        {loaded && active.length > 0 && (
          <p className="home-choose">
            <button type="button" className="quiet-link" aria-haspopup="dialog" onClick={() => setChoosing(true)}>
              Choose goals
            </button>
          </p>
        )}
      </aside>
      {choosing && (
        <ChooseGoalsSheet
          goals={goals}
          onChanged={async () => {
            await refresh();
            await shell?.refresh();
          }}
          onClose={() => setChoosing(false)}
        />
      )}
    </div>
  );
}
