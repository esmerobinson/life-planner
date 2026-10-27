import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { todayISO } from "../domain/dates";
import { QuickAdd } from "./QuickAdd";
import { ShellContext } from "./shellContext";
import { Sidebar } from "./Sidebar";
import { useHubData } from "./useHubData";

export function AppShell() {
  const [, setClock] = useState(0); // bumped on focus/visibility so `today` is re-read
  const today = todayISO();
  const { items, refresh } = useHubData(today);
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);
  const inboxCount = items.filter((i) => i.areaId === "inbox" && i.status === "open").length;

  useEffect(() => {
    const bump = () => setClock((c) => c + 1);
    const onVisible = () => {
      if (document.visibilityState !== "hidden") bump();
    };
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const changed = useCallback(async () => {
    await refresh();
    setVersion((v) => v + 1);
  }, [refresh]);

  const ctx = useMemo(() => ({ refresh: changed, version, today }), [changed, version, today]);

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
          {adding && <QuickAdd today={today} onAdded={() => void changed()} />}
          <Outlet />
        </main>
      </div>
    </ShellContext.Provider>
  );
}
