import { NavLink } from "react-router-dom";
import { NAV } from "./areas";
import { useSyncState } from "../sync";

const GROUPS: { group: 1 | 2 | 3; name: string }[] = [
  { group: 1, name: "Overview" },
  { group: 2, name: "Areas" },
  { group: 3, name: "Reflect" },
];

/**
 * The quiet links under the main nav (Backup, Sync, ...). One list for both layouts: the
 * sidebar footer on desktop and the bottom of the phone Home, so a link added here shows
 * in both.
 */
export function FooterLinks() {
  const sync = useSyncState();
  return (
    <>
      <NavLink to="/backup">Backup</NavLink>{" "}
      <NavLink to="/sync">{sync.status === "needs-passphrase" ? "Sync (needs passphrase)" : "Sync"}</NavLink>
    </>
  );
}

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
        <FooterLinks />
      </div>
    </aside>
  );
}
