import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
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
import { clearQuickDraft, QuickCapture, setQuickDraftText, type QuickDraft } from "./QuickCapture";
import { DEFAULT_SESSIONS } from "../domain/projects";
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
import { togetherRunner } from "../together/runner";
import { FarmProvider } from "../farm/FarmContext";
import { Nook } from "../farm/Nook";
import { ErrorGuard } from "./ErrorGuard";
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
  const navigate = useNavigate();
  // Home with the quick add open (her home-screen "Add" bookmark, /add).
  const atAdd = location.pathname === "/add";
  // Esme's Rio is a full-window game (Esme, 2026-11-17): none of the app's own chrome round it.
  const game = location.pathname === "/farm" || location.pathname === "/farm/";
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
  // The Together link copies after each finished sync run (only on a device signed in to it).
  useEffect(() => togetherRunner.start(syncController), []);

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
  // The phone's + opens the one-box quick add (Esme, 2026-11-17); "More options" (and "+ Add a
  // book" and the like, and the + on a computer) the full form.
  const [addMode, setAddMode] = useState<"quick" | "full">("full");
  // The full form opened by More options: it starts from the quick box's text, and keeps the
  // quick draft in step until it adds or is cancelled.
  const [handover, setHandover] = useState<AddDraft | null>(null);
  const fromQuick = useRef(false);
  const toggleAdd = useCallback(
    (open: boolean) => {
      if (open) {
        setAddOpened((n) => n + 1); // a fresh form, pre-set from this page
        setAddMode(phone ? "quick" : "full");
        setHandover(null);
        fromQuick.current = false;
      }
      setAddOverride(null);
      setAdding(open);
      // Closed on /add: Home is what was under it.
      if (!open && atAdd) navigate("/", { replace: true });
    },
    [phone, atAdd, navigate],
  );
  const openAddWith = useCallback((d: AddDefaults) => {
    setAddOpened((n) => n + 1);
    setAddMode("full");
    setHandover(null);
    fromQuick.current = false;
    setAddOverride(d);
    setAdding(true);
  }, []);
  // /add: the quick add opens by itself (no tap: on an iPhone the keyboard then waits for a tap on the box).
  useEffect(() => {
    if (!atAdd) return;
    setAddOpened((n) => n + 1);
    setAddMode("quick");
    setHandover(null);
    fromQuick.current = false;
    setAddOverride(null);
    setAdding(true);
  }, [atAdd]);
  // On /add, "Add to Home Screen" saves an icon that opens /add (its own manifest and name).
  useEffect(() => {
    if (!atAdd) return;
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
    const title = document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-title"]');
    const was = { href: link?.getAttribute("href"), title: title?.getAttribute("content") };
    link?.setAttribute("href", "/manifest-add.webmanifest");
    title?.setAttribute("content", ADD_BOOKMARK_NAME);
    return () => {
      if (link && was.href) link.setAttribute("href", was.href);
      if (title && was.title) title.setAttribute("content", was.title);
    };
  }, [atAdd]);
  /** More options: the full form, starting from what was typed, its title focused in the same tap. */
  const moreOptions = useCallback((d: QuickDraft) => {
    const base = addDefaults ?? BASE_ADD_DEFAULTS;
    flushSync(() => {
      fromQuick.current = true;
      setHandover(d.text.trim() ? { ...blankDraft(base), title: d.text } : null);
      setAddOpened((n) => n + 1);
      setAddMode("full");
    });
    document.querySelector<HTMLElement>(".add-sheet [data-focus-first], .add-pop [data-focus-first]")?.focus();
  }, [addDefaults]);

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
      <FarmProvider items={items} goals={goals} today={today}>
      {/* /farm is the game: a fixed screen beside the sidebar (rio/GameScreen.tsx, game-screen.css). */}
      <div className={`app-shell${phone ? " is-phone" : ""}${game ? " is-game" : ""}`}>
        {!phone && !game && <Sidebar />}
        <main className={phone && phoneTitle(location.pathname) ? "app-content has-bar-title" : "app-content"}>
          {phone && !game && <PhoneTopBar inboxLabel={inboxLabel} onSearch={openSearch} />}
          <UpdatePrompt />
          <DbClosedNotice db={db} />
          {/* Always shown (in the phone top bar on phone): on a fresh install it is the only way to reach Import.
              It floats right, so the page's h1 is the first thing on the page (1C: Add left this row). */}
          {!phone && !game && (
            <div className="shell-actions">
              <Link to="/inbox" className="btn-secondary shell-inbox">{inboxLabel}</Link>
            </div>
          )}
          {/* A page that throws while drawing shows this instead; the sidebar and every other page stay (bug #46). */}
          <ErrorGuard resetOn={location.pathname} name="page" fallback={<PageProblem />}>
            <Outlet />
          </ErrorGuard>
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
          {!game && <AddButton open={adding} onToggle={toggleAdd} phone={phone} buttonRef={addButton}>
            {(close) =>
              addMode === "quick" ? (
                <QuickCapture key={addOpened} today={today} autoFocus onAdded={() => void changed()} onMore={moreOptions} />
              ) : (
              <QuickAdd
                key={addOpened}
                today={today}
                autoFocus
                defaults={addOverride ?? addDefaults ?? BASE_ADD_DEFAULTS}
                // A click outside, Escape or the button keep what was typed for the next open (I-5);
                // Cancel and a successful add start afresh. Opened as asked ("+ Add a book"): fresh.
                // Opened by More options: what the quick box had.
                initial={handover ?? (!addOverride && addDraft.current && draftHasContent(addDraft.current) ? addDraft.current : undefined)}
                onDraft={(d) => {
                  // The quick box's text follows the title, so closing and reopening loses nothing.
                  if (fromQuick.current) setQuickDraftText(d.title);
                  // A fresh form opened as asked ("+ Add a book") must not wipe a draft kept from
                  // before until something is typed in it (review M-12).
                  if (addOverride && !draftHasContent(d)) return;
                  addDraft.current = d;
                }}
                onCancel={() => {
                  addDraft.current = null;
                  if (fromQuick.current) clearQuickDraft();
                  close();
                }}
                onAdded={() => {
                  addDraft.current = null;
                  if (fromQuick.current) clearQuickDraft();
                  close(); // saved: the form goes away and focus goes back to "+" (a failed save never reaches here)
                  void changed();
                }}
              />
              )
            }
          </AddButton>}
          {/* The nook belongs to the game too: in the full-window game it stands bottom left, as on the phone. */}
          {(phone || game) && <ErrorGuard name="nook"><Nook phone /></ErrorGuard>}
        </main>
      </div>
      </FarmProvider>
      </PanelProvider>
      </ShellUndoContext.Provider>
      </OpenAddContext.Provider>
      </AddDefaultsContext.Provider>
    </ShellContext.Provider>
  );
}

/** The home-screen bookmark's name (WORDING PROVISIONAL, for Esme / Design). */
const ADD_BOOKMARK_NAME = "Add";

/** An empty full-form draft, pre-set as the page says (More options fills in the title). */
function blankDraft(d: AddDefaults): AddDraft {
  return {
    title: "", type: d.type, areaId: d.areaId, goalId: "", priority: 2, due: "", recur: [], notes: "",
    goalKind: "finite", deadline: "", target: "", sessionCount: String(DEFAULT_SESSIONS), time: "",
  };
}

/** Wording provisional (for Esme / Design). */
function PageProblem() {
  return (
    <div role="alert">
      <p>This page hit a problem. Everything you wrote is saved.</p>
      <button type="button" className="btn-secondary" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}
