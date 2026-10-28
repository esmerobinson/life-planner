import { useContext, useEffect, useRef, useState } from "react";
import { archiveItems, createItem, listItems, restoreItem, updateItems } from "../data/repo";
import type { AreaId, ISODate, Item } from "../domain/types";
import { GOAL_AREAS } from "./areas";
import { InboxRow } from "./InboxRow";
import { INBOX_SOURCES, inboxSource, type InboxSource } from "./inboxSource";
import { NeedsALook } from "./NeedsALook";
import { useSaveError } from "./messages";
import { ShellContext } from "./shellContext";
import { useHubData } from "./useHubData";

export function InboxPage({ today }: { today: ISODate }) {
  const { items, goals, refresh, loaded, error } = useHubData(today);
  const shell = useContext(ShellContext);
  const inbox = items.filter((i) => i.areaId === "inbox" && i.status === "open");

  const sourcesPresent = INBOX_SOURCES.filter((s) => inbox.some((i) => inboxSource(i) === s));
  const [from, setFrom] = useState<InboxSource | "All">("All");
  // The filter only exists when there is more than one source; a source that emptied falls back to All.
  const showFilter = sourcesPresent.length > 1;
  const effectiveFrom = showFilter && from !== "All" && sourcesPresent.includes(from) ? from : "All";
  // Reset (not just hide) a filter whose source has emptied, so it does not return when items do.
  const stale = from !== "All" && loaded && !sourcesPresent.includes(from);
  useEffect(() => {
    if (stale) setFrom("All");
  }, [stale]);
  const shown = effectiveFrom === "All" ? inbox : inbox.filter((i) => inboxSource(i) === effectiveFrom);

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moveArea, setMoveArea] = useState<AreaId | "">("");
  const { attempt, saveError } = useSaveError();
  const shownPicked = shown.filter((i) => picked.has(i.id));
  const [moving, setMoving] = useState(false);
  const movingRef = useRef(false);
  const [result, setResult] = useState("");
  const [archived, setArchived] = useState<Item[]>([]);

  const [draft, setDraft] = useState("");
  const draftRef = useRef("");
  const captureBox = useRef<HTMLInputElement>(null);
  const captureChain = useRef<Promise<void>>(Promise.resolve());

  // Drop ticks for items no longer shown (filtered out, moved or archived), so a stale or hidden id is never acted on.
  const shownKey = shown.map((i) => i.id).join("|");
  useEffect(() => {
    if (!loaded) return;
    const ids = new Set(shownKey ? shownKey.split("|") : []);
    setPicked((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [shownKey, loaded]);

  // Archived inbox items are not in useHubData; re-read whenever the open items change.
  useEffect(() => {
    let live = true;
    listItems({ status: "archived", areaId: "inbox" }).then(
      (a) => live && setArchived(a),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [items]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function changed() {
    await refresh();
    await shell?.refresh();
  }

  /** Runs one bulk write under the in-flight guard. Returns the write's result, or undefined on failure. */
  async function bulk<T>(write: () => Promise<T>): Promise<T | undefined> {
    if (movingRef.current) return undefined;
    movingRef.current = true;
    setMoving(true);
    setResult("");
    try {
      let out: T | undefined;
      const ok = await attempt(async () => {
        out = await write();
      });
      if (!ok) return undefined;
      setPicked(new Set());
      await changed();
      return out;
    } finally {
      movingRef.current = false;
      setMoving(false);
    }
  }

  async function moveSelected() {
    if (!moveArea || shownPicked.length === 0) return;
    await bulk(() => updateItems(shownPicked.map((i) => i.id), { areaId: moveArea }, today));
  }

  async function archiveSelected() {
    if (shownPicked.length === 0) return;
    const n = await bulk(() => archiveItems(shownPicked.map((i) => i.id), today));
    if (n !== undefined) {
      setResult(`Archived ${n}. You can restore them under Archived from the inbox, below.`);
    }
  }

  /** Quick capture. The box is cleared at once so rapid entries never wait on a write; writes run in order. */
  function capture() {
    const title = draftRef.current.trim();
    if (!title) return;
    draftRef.current = "";
    setDraft("");
    captureBox.current?.focus();
    captureChain.current = captureChain.current.then(async () => {
      const ok = await attempt(() => createItem({ kind: "task", title, areaId: "inbox", priority: 2 }, today));
      if (!ok) {
        // Give the thought back so it is not lost.
        if (!draftRef.current) {
          draftRef.current = title;
          setDraft(title);
        }
        return;
      }
      await changed();
    });
  }

  if (error) {
    return (
      <section className="inbox-page">
        <h1>Inbox</h1>
        <p>{error}</p>
      </section>
    );
  }

  return (
    <section className="inbox-page">
      <h1>Inbox</h1>
      <form
        className="inbox-capture form-row"
        onSubmit={(e) => {
          e.preventDefault();
          capture();
        }}
      >
        <label className="form-field">
          <span className="form-label">Add to inbox</span>
          <input
            ref={captureBox}
            type="text"
            aria-label="Add to inbox"
            value={draft}
            onChange={(e) => {
              draftRef.current = e.target.value;
              setDraft(e.target.value);
            }}
          />
        </label>
        <button type="submit" className="btn-secondary" aria-label="Add this to the inbox">
          Add
        </button>
      </form>
      {saveError && <p className="form-message">{saveError}</p>}
      <h2>To sort</h2>
      {loaded && inbox.length === 0 && <p>Nothing waiting in the inbox.</p>}
      {showFilter && (
        <div className="btn-group" role="group" aria-label="From">
          {(["All", ...sourcesPresent] as const).map((s) => (
            <button key={s} type="button" aria-pressed={effectiveFrom === s} onClick={() => setFrom(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      {inbox.length > 0 && (
        <div className="inbox-bulk form-row">
          <label className="form-check">
            <input
              type="checkbox"
              aria-label="Select all shown"
              checked={shown.length > 0 && shownPicked.length === shown.length}
              onChange={(e) => setPicked(e.target.checked ? new Set(shown.map((i) => i.id)) : new Set())}
            />
            Select all shown
          </label>
          <label className="form-field">
            <span className="form-label">Move selected to</span>
            <select
              aria-label="Move selected to"
              value={moveArea}
              onChange={(e) => setMoveArea(e.target.value as AreaId | "")}
            >
              <option value="">Choose</option>
              {GOAL_AREAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={moving || !moveArea || shownPicked.length === 0}
            onClick={() => void moveSelected()}
          >
            Move selected
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={moving || shownPicked.length === 0}
            onClick={() => void archiveSelected()}
          >
            Archive selected
          </button>
        </div>
      )}
      {result && <p>{result}</p>}
      {shown.length > 0 && (
        <ul aria-label="Inbox items" className="strip-list">
          {shown.map((it) => (
            <InboxRow key={it.id} item={it} today={today} goals={goals}
              onFiled={changed}
              selected={picked.has(it.id)}
              onToggle={() => toggle(it.id)}
            />
          ))}
        </ul>
      )}
      <h2>Needs a look</h2>
      {loaded && <NeedsALook items={items} today={today} onChanged={changed} />}
      {archived.length > 0 && (
        <details>
          <summary>{`Archived from the inbox (${archived.length})`}</summary>
          <ul aria-label="Archived from the inbox" className="strip-list">
            {archived.map((it) => (
              <li key={it.id} className="strip no-tick">
                <div className="strip-body">
                  <div className="strip-title">{it.title}</div>
                </div>
                <div className="strip-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-label={`Restore: ${it.title}`}
                    onClick={() =>
                      void attempt(() => restoreItem(it.id, today)).then(async (ok) => {
                        if (ok) await changed();
                      })
                    }
                  >
                    Restore
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
