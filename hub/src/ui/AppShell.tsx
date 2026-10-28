import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { PhoneTopBar, phoneTitle } from "./PhoneTopBar";
import { usePhone } from "./usePhone";
import { requestPersistence, type PersistenceStatus } from "../data/storage";
import { needsALook } from "../domain/attention";
import { todayISO } from "../domain/dates";
import { QuickAdd } from "./QuickAdd";
import { ShellContext } from "./shellContext";
import { Sidebar } from "./Sidebar";
import { UpdatePrompt } from "./UpdatePrompt";
import { DbClosedNotice } from "./DbClosedNotice";
import { db } from "../data/db";
import { migrateMilestones } from "../data/migrateMilestones";
import { PanelProvider } from "./panelContext";
import { SidePanel } from "./SidePanel";
import { useHubData } from "./useHubData";
import { syncController } from "../sync";

/** How often the shell re-reads the clock (a technical check, not a motion timing). */
const CLOCK_CHECK_MS = 60_000;

export function AppShell() {
  const [, setClock] = useState(0); // bumped on focus/visibility/interval so `today` is re-read
  const today = todayISO();
  const { items, goals, refresh } = useHubData(today);
  const [adding, setAdding] = useState(false);
  const [version, setVersion] = useState(0);
  const [persistence, setPersistence] = useState<PersistenceStatus | null>(null);
  const unsorted = items.filter((i) => i.areaId === "inbox" && i.status === "open").length;
  const look = needsALook(items, today);
  // Unsorted items are excluded from needsALook, so nothing is counted twice.
  const inboxCount = unsorted + look.overdue.length + look.dueSoon.length + look.stale.length;
  const inboxLabel = inboxCount > 0 ? `Inbox (${inboxCount})` : "Inbox";
  const phone = usePhone();
  const location = useLocation();

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
    // Legacy goal milestones become flagged tasks (idempotent; waits for the first sync
    // pull; writes nothing when there is nothing to convert). Run on start, after every
    // sync and after local changes such as a restore, so late arrivals are converted too.
    await migrateMilestones(todayISO()).catch(() => 0);
    await refresh();
    setVersion((v) => v + 1);
  }, [refresh]);

  useEffect(() => {
    void changed();
  }, [changed]);

  // Automatic sync (does nothing until an address and passphrase are saved on the Sync
  // page). Rows that arrive refresh every view the same way a local write does.
  useEffect(() => syncController.start({ onSynced: () => void changed() }), [changed]);

  const ctx = useMemo(() => ({ refresh: changed, version, today, persistence }), [changed, version, today, persistence]);

  return (
    <ShellContext.Provider value={ctx}>
      <PanelProvider>
      <div className={phone ? "app-shell is-phone" : "app-shell"}>
        {!phone && <Sidebar />}
        <main className={phone && phoneTitle(location.pathname) ? "app-content has-bar-title" : "app-content"}>
          {phone && <PhoneTopBar inboxLabel={inboxLabel} />}
          <UpdatePrompt />
          <DbClosedNotice db={db} />
          <div className="shell-actions">
            <button type="button" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
              Add
            </button>
            {/* Always shown (in the phone top bar on phone): on a fresh install it is the only way to reach Import. */}
            {!phone && <Link to="/inbox" className="btn-secondary shell-inbox">{inboxLabel}</Link>}
          </div>
          {adding && <QuickAdd today={today} onAdded={() => void changed()} />}
          <Outlet />
          <SidePanel items={items} goals={goals} today={today} onChanged={changed} />
        </main>
      </div>
      </PanelProvider>
    </ShellContext.Provider>
  );
}
