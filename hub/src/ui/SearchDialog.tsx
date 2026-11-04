import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../data/db";
import type { Goal, ISODate, Item } from "../domain/types";
import { loadJournalKey } from "../journal/keyStore";
import { loadJournalDocs } from "../search/journalSearch";
import {
  buildIndex, GROUP_CAP, GROUP_LABEL, highlight, queryWords, searchIndex, searchJournal, type Hit, type JournalDoc, type ResultGroup,
} from "../search/search";
import { NAV } from "./areas";
import { usePanel } from "./panelContext";

/** Typing settles this long before the results update (a technical wait, not a look or motion). */
export const SEARCH_DEBOUNCE_MS = 120;

/** ⌘K on a Mac, Ctrl+K elsewhere. */
export function isSearchShortcut(e: KeyboardEvent | globalThis.KeyboardEvent): boolean {
  if (e.key.toLowerCase() !== "k" || e.altKey || e.shiftKey) return false;
  const mac = /Mac|iPhone|iPad|iPod/.test(navigator.platform || "");
  return mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

/** The magnifier, line-drawn like the calendar and arrow icons (the search mockup's glyph). */
export const SEARCH_GLYPH = (
  <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </svg>
);

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

type JournalState = { state: "loading" } | { state: "locked" } | { state: "error" } | { state: "ok"; docs: JournalDoc[] };

/** Bold runs for the query words (the mockup's <mark>: bold, no colour). */
function Marked({ text, words }: { text: string; words: string[] }) {
  return (
    <>
      {highlight(text, words).map((r, i) => (r.bold ? <mark key={i}>{r.text}</mark> : <Fragment key={i}>{r.text}</Fragment>))}
    </>
  );
}

/** The area's sidebar tile (the Inbox has none: an undecided magenta placeholder). */
function ResultTile({ tile }: { tile: string }) {
  const nav = NAV.find((n) => n.id === tile);
  if (!nav) return <span className="sidebar-tile search-tile-placeholder" aria-hidden="true" />;
  return (
    <span className="sidebar-tile" style={{ background: nav.tile }} aria-hidden="true">
      <img src={nav.icon} alt="" width={24} height={24} />
    </span>
  );
}

/**
 * ⌘K search (Esme's pick, option 3A): a search box over the page (the Choose goals pop-up),
 * full screen on the phone. As she types (settled for SEARCH_DEBOUNCE_MS) it shows to-dos,
 * projects, ideas, books, goals and page notes, grouped by type with the matching words in
 * bold, at most GROUP_CAP per group. ↑ ↓ move the highlight, Enter (or a click) opens the
 * item's or goal's side panel, or the Journal tab. Escape (or Back on the phone, or a click on
 * the shade) closes it and focus goes back.
 *
 * Journal entries show only while the journal is unlocked (this device's confirmed key): they
 * are opened when search opens, kept in this component's memory only, and dropped when it
 * closes. Morning pages under 28 days old are never opened.
 */
export function SearchDialog({
  items, goals, today, phone, onClose,
}: { items: Item[]; goals: Goal[]; today: ISODate; phone: boolean; onClose: () => void }) {
  const panel = usePanel();
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);
  const [journal, setJournal] = useState<JournalState>({ state: "loading" });
  const sheet = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    opener.current = document.activeElement;
    input.current?.focus();
    return () => {
      const back = opener.current as HTMLElement | null;
      if (back && back.isConnected && typeof back.focus === "function") back.focus();
    };
  }, []);

  // The journal, opened once per search (in memory only; nothing is written).
  useEffect(() => {
    let live = true;
    (async () => {
      const jk = await loadJournalKey(db);
      if (!jk) return { state: "locked" } as const;
      return { state: "ok", docs: await loadJournalDocs(jk, today) } as const;
    })().then(
      (s) => live && setJournal(s),
      () => live && setJournal({ state: "error" }),
    );
    return () => {
      live = false;
    };
  }, [today]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const index = useMemo(() => buildIndex(items, goals, today), [items, goals, today]);
  const words = useMemo(() => queryWords(query), [query]);
  const groups: ResultGroup[] = useMemo(() => searchIndex(index, query), [index, query]);
  const journalHits = useMemo(() => {
    if (journal.state !== "ok") return null;
    const hits = searchJournal(journal.docs, query, today);
    return { total: hits.length, hits: hits.slice(0, GROUP_CAP) };
  }, [journal, query, today]);
  const flat: Hit[] = useMemo(() => [...groups.flatMap((g) => g.hits), ...(journalHits?.hits ?? [])], [groups, journalHits]);
  useEffect(() => setSel(0), [query]);
  const selected = flat.length ? flat[Math.min(sel, flat.length - 1)] : undefined;
  const optionId = (h: Hit) => `search-opt-${h.tile}-${h.id}`.replace(/[^A-Za-z0-9_-]/g, "-");

  // Keep the highlighted row in view as the arrows move it.
  useEffect(() => {
    if (!selected) return;
    document.getElementById(optionId(selected))?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);

  function open(h: Hit) {
    onClose();
    if ("panel" in h.open) panel?.open(h.open.panel);
    else navigate(h.open.path);
  }

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!flat.length) return;
      e.preventDefault();
      const n = flat.length;
      setSel((s) => (Math.min(s, n - 1) + (e.key === "ArrowDown" ? 1 : -1) + n) % n);
      return;
    }
    if (e.key === "Enter" && e.target === input.current) {
      e.preventDefault();
      if (query === text) {
        if (selected) open(selected);
        return;
      }
      // Enter before the typing settled: the first result for what is typed now.
      const first =
        searchIndex(index, text)[0]?.hits[0] ??
        (journal.state === "ok" ? searchJournal(journal.docs, text, today)[0] : undefined);
      if (first) open(first);
      return;
    }
    if (e.key !== "Tab" || !sheet.current) return;
    const all = [...sheet.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (all.length === 0) return;
    const first = all[0]!;
    const last = all[all.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const option = (h: Hit) => {
    const on = h === selected;
    return (
      <div
        key={`${h.tile}:${h.id}`}
        id={optionId(h)}
        role="option"
        aria-selected={on}
        className={on ? "strip no-tick openable search-option is-selected" : "strip no-tick openable search-option"}
        onMouseDown={(e) => e.preventDefault() /* keep focus in the box */}
        onClick={() => open(h)}
      >
        <ResultTile tile={h.tile} />
        <div className="strip-body">
          <div className="strip-title">
            <Marked text={h.title} words={words} />
          </div>
          {h.sub && (
            <div className="strip-meta">
              <Marked text={h.sub} words={words} />
            </div>
          )}
          <div className="strip-meta">{h.meta}</div>
        </div>
        <span className="search-enter" aria-hidden="true">
          {on ? "↵" : ""}
        </span>
      </div>
    );
  };

  const group = (id: string, label: string, count: number | null, body: ReactNode) => (
    <div key={id} role="group" aria-labelledby={`search-group-${id}`} className="search-group">
      <div className="search-group-h">
        <span id={`search-group-${id}`}>{label}</span>
        {count !== null && <span aria-hidden="true">{count}</span>}
      </div>
      {body}
    </div>
  );

  const box = (
    <input
      ref={input}
      type="search"
      className="search-in"
      role="combobox"
      aria-label="Search"
      aria-expanded={flat.length > 0}
      aria-controls="search-results"
      aria-autocomplete="list"
      aria-activedescendant={selected ? optionId(selected) : undefined}
      placeholder="Search everything"
      autoComplete="off"
      spellCheck={false}
      value={text}
      onChange={(e) => setText(e.target.value)}
    />
  );

  const nothing = words.length > 0 && groups.length === 0 && !journalHits?.total;

  return (
    <div
      className="choose-shade search-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheet}
        className={phone ? "choose-sheet search-sheet is-full" : "choose-sheet search-sheet"}
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onKeyDown={onKey}
      >
        {phone ? (
          <div className="search-top">
            <button type="button" className="phone-back" aria-label="Back" onClick={onClose}>
              ←
            </button>
            {box}
          </div>
        ) : (
          box
        )}
        <div id="search-results" role="listbox" aria-label="Results" className="search-results">
          {words.length === 0 ? (
            <p className="search-muted">Type to search to-dos, ideas, books, goals, notes and your journal.</p>
          ) : (
            <>
              {nothing && <p className="search-muted">{`Nothing matches "${query.trim()}".`}</p>}
              {groups.map((g) => group(g.group, GROUP_LABEL[g.group], g.total, g.hits.map(option)))}
              {group(
                "journal",
                GROUP_LABEL.journal,
                journalHits ? journalHits.total : null,
                <>
                  {journal.state === "locked" && (
                    <p className="search-locked">Journal results appear when your journal is unlocked.</p>
                  )}
                  {journal.state === "error" && <p className="search-locked">Journal results could not be opened on this device.</p>}
                  {journal.state === "loading" && <p className="search-muted">Opening your journal…</p>}
                  {journalHits && (journalHits.hits.length ? journalHits.hits.map(option) : <p className="search-muted">No journal entries match.</p>)}
                  <p className="search-muted">Morning pages from the last 4 weeks are never searched.</p>
                </>,
              )}
            </>
          )}
        </div>
        {!phone && <p className="search-hint">↑ ↓ to move · return to open · esc to close</p>}
      </div>
    </div>
  );
}
