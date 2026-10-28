import { NavLink } from "react-router-dom";
import { NAV } from "./areas";

const GROUPS: { group: 1 | 2 | 3; name: string }[] = [
  { group: 1, name: "Overview" },
  { group: 2, name: "Areas" },
  { group: 3, name: "Reflect" },
];

export function Sidebar() {
  return (
    <aside className="sidebar">
      <nav className="sidebar-nav" aria-label="Main">
        {GROUPS.map(({ group, name }) => (
          <div key={group} role="group" aria-label={name} className="sidebar-group">
            {NAV.filter((n) => n.group === group).map((n) => (
              <NavLink key={n.id} to={n.path} end={n.path === "/"} className="sidebar-item">
                <span className="sidebar-tile" style={{ background: n.tile }}>
                  <img src={n.icon} alt="" width={24} height={24} />
                </span>
                <span>{n.label}</span>
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <NavLink to="/backup">Backup</NavLink>
      </div>
    </aside>
  );
}
