import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { PhoneTopBar, phoneTitle } from "./PhoneTopBar";
import { usePhone } from "./usePhone";
import { requestPersistence, type PersistenceStatus } from "../data/storage";
import { needsALook } from "../domain/attention";
import { todayISO } from "../domain/dates";
import { AddDefaultsContext, BASE_ADD_DEFAULTS, OpenAddContext, type AddDefaults } from "./addContext";
import { AddButton } from "./AddButton";
import { UndoLine } from "./DeleteButton";
import { ShellUndoContext, type UndoNote } from "./undoContext";
import { draftHasContent, QuickAdd, type AddDraft } from "./QuickAdd";
import { CHECK_DATE_EVENT, ShellContext } from "./shellContext";
import { Sidebar } from "./Sidebar";
import { UpdatePrompt } from "./UpdatePrompt";
import { DbClosedNotice } from "./DbClosedNotice";
import { db } from "../data/db";
import { migrateMilestones } from "../data/migrateMilestones";
import { PanelProvider } from "./panelContext";
import { SidePanel } from "./SidePanel";
import { isSearchShortcut, SearchDialog } from "./SearchDialog";
import { useHubData } from "./useHubData";
import { syncController } from "../sync";
import { useReminderScheduler } from "../reminders/scheduler";
import { useNativeNavigate } from "../reminders/nativeNavigate";

/** How often the shell re-reads the clock (a technical check, not a motion timing). */
const CLOCK_CHECK_MS = 60_000;

export function AppShell() {
  const [, setClock] = useState(0); // bumped on focus/visibility/interval so `today` is re-read
  const today = todayISO();
  const { items, goals, refresh } = useHubData(today);
  const [adding, setAdding] = useState(false);
  // Where Add opens pre-set, as the current page says (addContext.ts); read when it opens.
  const [addDefaults, setAddDefaults] = useState<AddDefaults | null>(null);
  const [addOpened, setAddOpened] = useState(0);
  const addButton = useRef<HTMLButtonElement>(null);
  const addDraft = useRef<AddDraft | null>(null);
  const [version, setVersion] = useState(0);
  const [persistence, setPersistence] = useState<PersistenceStatus | null>(null);
  const unsorted = items.filter((i) => i.areaId === "inbox" && i.status === "open").length;
  const look = needsALook(items, today);
  // An unsorted item with a deadline is in both: count it once.
  const lookCount = [...look.overdue, ...look.dueSoon, ...look.stale].filter((i) => i.areaId !== "inbox").length;
  const inboxCount = unsorted + lookCount;
  const inboxLabel = inboxCount > 0 ? `Inbox (${inboxCount})` : "Inbox";
  const phone = usePhone();
  const location = useLocation();
  // The Mac app's reminders follow every change (does nothing elsewhere).
  useReminderScheduler();
  useNativeNavigate();

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
    window.addEventListener(CHECK_DATE_EVENT, bump);
    document.addEventListener("visibilitychange", onVisible);
    // A tab left focused across midnight gets no focus event; check the date periodically.
    const timer = setInterval(bump, CLOCK_CHECK_MS);
    return () => {
      window.removeEventListener("focus", bump);
      window.removeEventListener(CHECK_DATE_EVENT, bump);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, []);

  const changed = useCallback(async () => {
    // Legacy goal milestones become flagged tasks (idempotent; waits for the first sync
    // pull; writes nothing when there is nothing to convert). Run on start, after every
    // sync and after local changes such as a restore, so late arrivals are converted too.
    await migrateMilestones(todayISO()).catch((e: unknown) => {
      // Retried on the next change; leave a trace rather than fail silently (review M-6).
      console.warn("Milestone migration did not run:", e);
      return 0;
    });
    await refresh();
    setVersion((v) => v + 1);
  }, [refresh]);

  useEffect(() => {
    void changed();
  }, [changed]);

  // Automatic sync (does nothing until an address and passphrase are saved on the Sync
  // page). Rows that arrive refresh every view the same way a local write does.
  useEffect(() => syncController.start({ onSynced: () => void changed() }), [changed]);

  // The shell's Undo line (fix round 1, I-2): e.g. after a project lost its sessions.
  const [undoNote, setUndoNote] = useState<UndoNote | null>(null);
  useEffect(() => setUndoNote(null), [location.pathname]); // a new page: the line goes
  const undoNow = useCallback(async () => {
    const note = undoNote;
    if (!note) return;
    if (!(await note.undo())) return;
    setUndoNote(null);
    await changed();
  }, [undoNote, changed]);

  // "+ Add a book" (and the like): Add opens pre-set as asked, not as the page says.
  const [addOverride, setAddOverride] = useState<AddDefaults | null>(null);
  const toggleAdd = useCallback((open: boolean) => {
    if (open) setAddOpened((n) => n + 1); // a fresh form, pre-set from this page
    setAddOverride(null);
    setAdding(open);
  }, []);
  const openAddWith = useCallback((d: AddDefaults) => {
    setAddOpened((n) => n + 1);
    setAddOverride(d);
    setAdding(true);
  }, []);

  // ⌘K search (3A): ⌘K on a Mac, Ctrl+K elsewhere, from any page; the phone's 🔍 too.
  const [searching, setSearching] = useState(false);
  const openSearch = useCallback(() => {
    setAdding(false); // one pop-up at a time
    setSearching(true);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return;
      e.preventDefault();
      openSearch();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openSearch]);

  const ctx = useMemo(() => ({ refresh: changed, version, today, persistence }), [changed, version, today, persistence]);

  return (
    <ShellContext.Provider value={ctx}>
      <AddDefaultsContext.Provider value={setAddDefaults}>
      <OpenAddContext.Provider value={openAddWith}>
      <ShellUndoContext.Provider value={setUndoNote}>
      <PanelProvider>
      <div className={phone ? "app-shell is-phone" : "app-shell"}>
        {!phone && <Sidebar />}
        <main className={phone && phoneTitle(location.pathname) ? "app-content has-bar-title" : "app-content"}>
          {phone && <PhoneTopBar inboxLabel={inboxLabel} onSearch={openSearch} />}
          <UpdatePrompt />
          <DbClosedNotice db={db} />
          {/* Always shown (in the phone top bar on phone): on a fresh install it is the only way to reach Import.
              It floats right, so the page's h1 is the first thing on the page (1C: Add left this row). */}
          {!phone && (
            <div className="shell-actions">
              <Link to="/inbox" className="btn-secondary shell-inbox">{inboxLabel}</Link>
            </div>
          )}
          <Outlet />
          <SidePanel items={items} goals={goals} today={today} onChanged={changed} />
          {searching && (
            <SearchDialog items={items} goals={goals} today={today} phone={phone} onClose={() => setSearching(false)} />
          )}
          {/* Only while there is something to undo: an always-there status region would be a
              second "status" on pages that have their own. */}
          {undoNote && (
            <div className="shell-undo has-note">
              <UndoLine message={undoNote.message} onUndo={() => void undoNow()} takeFocus />
            </div>
          )}
          <AddButton open={adding} onToggle={toggleAdd} phone={phone} buttonRef={addButton}>
            {(close) => (
              <QuickAdd
                key={addOpened}
                today={today}
                autoFocus
                defaults={addOverride ?? addDefaults ?? BASE_ADD_DEFAULTS}
                // A click outside, Escape or the button keep what was typed for the next open (I-5);
                // Cancel and a successful add start afresh. Opened as asked ("+ Add a book"): fresh.
                initial={!addOverride && addDraft.current && draftHasContent(addDraft.current) ? addDraft.current : undefined}
                onDraft={(d) => {
                  // A fresh form opened as asked ("+ Add a book") must not wipe a draft kept from
                  // before until something is typed in it (review M-12).
                  if (addOverride && !draftHasContent(d)) return;
                  addDraft.current = d;
                }}
                onCancel={() => {
                  addDraft.current = null;
                  close();
                }}
                onAdded={() => {
                  addDraft.current = null;
                  close(); // saved: the form goes away and focus goes back to "+" (a failed save never reaches here)
                  void changed();
                }}
              />
            )}
          </AddButton>
        </main>
      </div>
      </PanelProvider>
      </ShellUndoContext.Provider>
      </OpenAddContext.Provider>
      </AddDefaultsContext.Provider>
    </ShellContext.Provider>
  );
}
