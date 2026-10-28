import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { requestPersistence, type PersistenceStatus } from "../data/storage";
import { todayISO } from "../domain/dates";
import { QuickAdd } from "./QuickAdd";
import { ShellContext } from "./shellContext";
import { Sidebar } from "./Sidebar";
import { UpdatePrompt } from "./UpdatePrompt";
import { useHubData } from "./useHubData";

/** How often the shell re-reads the clock (a technical check, not a motion timing). */
const CLOCK_CHECK_MS = 60_000;

export function AppShell() {
  const [, setClock] = useState(0); // bumped on focus/visibility/interval so `today` is re-read
  const today = todayISO();
  const { items, refresh } = useHubData(today);
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);
  const [persistence, setPersistence] = useState<PersistenceStatus | null>(null);
  const inboxCount = items.filter((i) => i.areaId === "inbox" && i.status === "open").length;

  // Ask the browser once, on start, to keep this data.
  useEffect(() => {
    let live = true;
    void requestPersistence().then((s) => live && setPersistence(s));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const bump = () => setClock((c) => c + 1);
    const onVisible = () => {
      if (document.visibilityState !== "hidden") bump();
    };
    window.addEventListener("focus", bump);
    document.addEventListener("visibilitychange", onVisible);
    // A tab left focused across midnight gets no focus event; check the date periodically.
    const timer = setInterval(bump, CLOCK_CHECK_MS);
    return () => {
      window.removeEventListener("focus", bump);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);

  const changed = useCallback(async () => {
    await refresh();
    setVersion((v) => v + 1);
  }, [refresh]);

  const ctx = useMemo(() => ({ refresh: changed, version, today, persistence }), [changed, version, today, persistence]);

  return (
    <ShellContext.Provider value={ctx}>
      <div className="app-shell">
        <Sidebar />
        <main className="app-content">
          <UpdatePrompt />
          <div className="shell-actions">
            <button type="button" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
              Add
            </button>
            {/* Always shown: on a fresh install it is the only way to reach Import. */}
            <Link to="/inbox" className="btn-secondary">{inboxCount > 0 ? `Inbox (${inboxCount})` : "Inbox"}</Link>
            <Link to="/backup" className="btn-secondary">Backup</Link>
          </div>
          {adding && <QuickAdd today={today} onAdded={() => void changed()} />}
          <Outlet />
        </main>
      </div>
    </ShellContext.Provider>
  );
}
