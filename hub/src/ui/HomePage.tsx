import { Link } from "react-router-dom";
import { monthlyProgress } from "../domain/progress";
import type { ISODate } from "../domain/types";
import { NAV } from "./areas";
import { GoalCard } from "./GoalProgress";
import { FooterLinks } from "./Sidebar";
import { usePhone } from "./usePhone";
import { JournalCardStub } from "./JournalCardStub";
import { TodayPanel } from "./TodayPanel";
import { useHubData } from "./useHubData";

export function HomePage({ today }: { today: ISODate }) {
  return usePhone() ? <PhoneHome today={today} /> : <DesktopHome today={today} />;
}

/**
 * Phone Home (mockup-phone.html tab A, VISUAL-LANGUAGE.md "Phone layout"): the app grid
 * of every sidebar destination except Home, then Today's list, then the quiet footer
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
      <TodayPanel today={today} headingLevel={2} />
      <nav aria-label="More" className="phone-footer">
        <FooterLinks />
      </nav>
    </div>
  );
}

function DesktopHome({ today }: { today: ISODate }) {
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
