import { useMemo, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { todayISO } from "../domain/dates";
import { QuickAdd } from "./QuickAdd";
import { ShellContext } from "./shellContext";
import { Sidebar } from "./Sidebar";
import { useHubData } from "./useHubData";

export function AppShell() {
  const [today] = useState(() => todayISO());
  const { items, refresh } = useHubData(today);
  const [adding, setAdding] = useState(false);
  const inboxCount = items.filter((i) => i.areaId === "inbox" && i.status === "open").length;
  const ctx = useMemo(() => ({ refresh }), [refresh]);

  return (
    <ShellContext.Provider value={ctx}>
      <div className="app-shell">
        <Sidebar />
        <main className="app-content">
          <div className="shell-actions">
            <button type="button" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
              Add
            </button>
            {inboxCount > 0 && <Link to="/inbox">{`Inbox (${inboxCount})`}</Link>}
          </div>
          {adding && <QuickAdd today={today} onAdded={() => void refresh()} />}
          <Outlet />
        </main>
      </div>
    </ShellContext.Provider>
  );
}
