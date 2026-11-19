import { liveQuery } from "dexie";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { db } from "../../data/db";
import { dayLabel, shortDate } from "../../domain/display";
import type { AreaId, Item } from "../../domain/types";
import { DEFAULT_FILES_ROOT, didLog, logWeeks, type LogEntry } from "../../domain/whatIDid";
import { chooseFilesRoot, hasFileBridge, loadFilesRoot, resetFilesRoot } from "../../native/files";
import { AREA_CHOICES } from "../areas";
import { DATA_ERROR } from "../messages";
import { usePanel } from "../panelContext";
import { useShellToday } from "../shellContext";
import { areaName, FileList } from "./DidBox";
import { PhotoStrip } from "./DidPhotos";
import { DID_WORDS as W } from "./words";

/** The search parameter that marks one entry (⌘K search opens the log at it). */
export const ENTRY_PARAM = "entry";

/** Every to-do with a note, live (any device's change, offline too). */
function useDidItems(): { items: Item[] | null; error: boolean } {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const sub = liveQuery(() => db.items.filter((i) => (i.did?.length ?? 0) > 0 || (i.didPhotos?.length ?? 0) > 0).toArray()).subscribe({
      next: (rows) => {
        setItems(rows);
        setError(false);
      },
      error: () => setError(true),
    });
    return () => sub.unsubscribe();
  }, []);
  return { items, error };
}

/**
 * The "What I did" log (Esme, 19 Nov 2026), from the footer links: every note by week, Monday to
 * Sunday, newest first; each entry its date, the to-do (a project's session), its area and
 * project, the note and the kept files. Filter by area. Works offline (it reads this device's
 * copy). The to-do's name opens it in the side panel. On the Mac, where files go (there is no
 * Settings page yet, so the setting is at the bottom here; provisional, for Design).
 */
export function WhatIDidPage() {
  const today = useShellToday();
  const { items, error } = useDidItems();
  const [area, setArea] = useState<AreaId | null>(null);
  const [params] = useSearchParams();
  const target = params.get(ENTRY_PARAM);
  const panel = usePanel();

  const log = useMemo(() => didLog(items ?? [], areaName), [items]);
  const areas = AREA_CHOICES.filter((a) => log.some((e) => e.area === a.id));
  const shown = area ? log.filter((e) => e.area === area) : log;
  const weeks = logWeeks(shown);

  // Opened from search: that entry comes into view, marked.
  useEffect(() => {
    if (!target || !items) return;
    document.getElementById(`did-${target}`)?.scrollIntoView?.({ block: "center" });
  }, [target, items]);

  return (
    <section className="did-page">
      <h1>{W.page}</h1>
      <p className="choose-muted">{W.pageLine}</p>
      {error && <p className="form-message">{DATA_ERROR}</p>}
      {items && log.length === 0 && <p>{W.empty}</p>}
      {areas.length > 0 && (
        <div className="did-filter" role="group" aria-label={W.filter}>
          <button type="button" aria-pressed={area === null} onClick={() => setArea(null)}>
            {W.allAreas}
          </button>
          {areas.map((a) => (
            <button key={a.id} type="button" aria-pressed={area === a.id} onClick={() => setArea(a.id)}>
              {a.label}
            </button>
          ))}
        </div>
      )}
      {items && log.length > 0 && shown.length === 0 && <p>{W.emptyFiltered}</p>}
      {weeks.map((w) => {
        const range = W.week(shortDate(w.monday, today), shortDate(w.sunday, today));
        return (
          <section key={w.monday} aria-label={`Week of ${range}`}>
            <h2>{range}</h2>
            <ul className="strip-list">
              {w.entries.map((e) => (
                <Entry key={e.key} e={e} today={today} marked={e.key === target} onOpen={panel ? () => panel.open(e.itemId) : undefined} />
              ))}
            </ul>
          </section>
        );
      })}
      {hasFileBridge() && <FolderSetting />}
    </section>
  );
}

function Entry({ e, today, marked, onOpen }: { e: LogEntry; today: string; marked: boolean; onOpen?: () => void }) {
  return (
    <li id={`did-${e.key}`} className={marked ? "strip no-tick did-entry is-target" : "strip no-tick did-entry"}>
      <div className="strip-body">
        <div className="strip-meta">{dayLabel(e.on, today)}</div>
        {onOpen ? (
          <button type="button" className="strip-title strip-open" onClick={onOpen}>
            {e.todo}
          </button>
        ) : (
          <div className="strip-title">{e.todo}</div>
        )}
        <div className="strip-meta">
          {e.areaLabel}
          {e.project && ` · ${W.project(e.project)}`}
        </div>
        {e.note && <p className="did-note">{e.note}</p>}
        <PhotoStrip ids={e.photos} />
        {e.files.length > 0 && <FileList files={e.files} />}
      </div>
    </li>
  );
}

/**
 * Where kept files go: the Mac app keeps it (review M1), the Desktop until she chooses another
 * folder in the Mac's own folder picker.
 */
function FolderSetting() {
  const [root, setRoot] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void loadFilesRoot().then((r) => live && setRoot(r));
    return () => {
      live = false;
    };
  }, []);

  return (
    <section className="did-setting" aria-label={W.settingHeading}>
      <h2>{W.settingHeading}</h2>
      {root && <p>{W.settingLine(root)}</p>}
      <p className="choose-muted">{W.firstTime}</p>
      <div className="form-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            const picked = await chooseFilesRoot();
            if (picked) setRoot(picked);
          }}
        >
          {W.chooseFolder}
        </button>
        {root !== null && root !== DEFAULT_FILES_ROOT && (
          <button type="button" className="btn-secondary" onClick={async () => setRoot(await resetFilesRoot())}>
            {W.useDesktop}
          </button>
        )}
      </div>
    </section>
  );
}
