import { useContext, useEffect, useRef, useState } from "react";
import {
  archiveItems,
  createItem,
  itemToGoal,
  listItems,
  restoreItem,
  updateItem,
  updateItems,
} from "../data/repo";
import type { AreaId, ISODate, Item, Priority } from "../domain/types";
import { AREA_CHOICES, GOAL_AREAS } from "./areas";
import { INBOX_SOURCES, inboxSource, type InboxSource } from "./inboxSource";
import { NeedsALook } from "./NeedsALook";
import { SAVE_ERROR, useSaveError } from "./messages";
import { ShellContext } from "./shellContext";
import { useHubData } from "./useHubData";

const FILE_AREAS = AREA_CHOICES.filter((a) => a.id !== "inbox");

/** The reason line for an item that needs a decision: `check` tag plus a first notes line "Check: ...". */
function checkReason(item: Item): string | null {
  if (!item.tags?.includes("check")) return null;
  const first = (item.notes ?? "").split(/\r?\n/)[0].trim();
  return /^check:/i.test(first) ? first : null;
}

function InboxRow({
  item,
  today,
  goals,
  onFiled,
  selected,
  onToggle,
}: {
  item: Item;
  today: ISODate;
  goals: { id: string; title: string; areaId: AreaId }[];
  onFiled: () => void | Promise<void>;
  selected: boolean;
  onToggle: () => void;
}) {
  const [areaId, setAreaId] = useState<AreaId | "">("");
  const [goalId, setGoalId] = useState("");
  const [priority, setPriority] = useState<Priority>(item.priority);
  const [due, setDue] = useState(item.due ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const reason = checkReason(item);

  /** Runs one write, shows the calm message on failure, refreshes on success. */
  async function run(write: () => Promise<unknown>) {
    if (busy) return;
    setMessage("");
    setBusy(true);
    try {
      await write();
    } catch {
      setMessage(SAVE_ERROR);
      setBusy(false);
      return;
    }
    setBusy(false);
    await onFiled();
  }

  async function file() {
    if (!areaId) {
      setMessage("Choose an area first.");
      return;
    }
    await run(() =>
      updateItem(item.id, { areaId, goalId: goalId || undefined, priority, due: due || undefined }, today),
    );
  }

  function setKind(kind: "task" | "idea") {
    if (item.kind === kind) return;
    // An idea has no due date or repeat; remove them explicitly.
    void run(() =>
      updateItem(
        item.id,
        kind === "idea"
          ? { kind, due: undefined, recur: undefined, pinnedDate: undefined, hiddenOn: undefined }
          : { kind },
        today,
      ),
    );
    if (kind === "idea") setDue("");
  }

  return (
    <li className="inbox-row form-row">
      <input
        type="checkbox"
        aria-label={`Select ${item.title}`}
        checked={selected}
        onChange={onToggle}
      />
      <span className="inbox-title">{item.title}</span>
      {item.tags?.map((t) => (
        <span key={t} className="inbox-tag">
          #{t}
        </span>
      ))}
      {reason && <p className="inbox-check">{reason}</p>}
      <div className="btn-group" role="group" aria-label={`File ${item.title} in`}>
        {FILE_AREAS.map((a) => (
          <button
            key={a.id}
            type="button"
            className="btn-secondary"
            aria-label={`File ${item.title} in ${a.label}`}
            disabled={busy}
            onClick={() => void run(() => updateItem(item.id, { areaId: a.id }, today))}
          >
            {a.label}
          </button>
        ))}
      </div>
      <details>
        <summary>More options</summary>
        <div className="form-row">
          <span>This is a:</span>
          <div className="btn-group" role="group" aria-label="This is a:">
            <button
              type="button"
              aria-pressed={item.kind === "task"}
              disabled={busy}
              onClick={() => setKind("task")}
            >
              To-do
            </button>
            <button
              type="button"
              aria-pressed={item.kind === "idea"}
              disabled={busy}
              onClick={() => setKind("idea")}
            >
              Idea
            </button>
          </div>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => void run(() => itemToGoal(item.id, areaId || "admin", today))}
          >
            Make it a goal
          </button>
        </div>
        <div className="form-row">
          <label className="form-field">
            <span className="form-label">Area</span>
            <select
              aria-label={`Area for ${item.title}`}
              value={areaId}
              onChange={(e) => {
                setAreaId(e.target.value as AreaId);
                setGoalId("");
              }}
            >
              <option value="">Choose</option>
              {FILE_AREAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span className="form-label">Goal</span>
            <select
              aria-label={`Goal for ${item.title}`}
              value={goalId}
              onChange={(e) => setGoalId(e.target.value)}
            >
              <option value="">None</option>
              {goals
                .filter((g) => g.areaId === areaId)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
            </select>
          </label>
          <label className="form-field">
            <span className="form-label">Priority</span>
            <select
              aria-label={`Priority for ${item.title}`}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value) as Priority)}
            >
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
          <label className="form-field">
            <span className="form-label">Due</span>
            <input
              type="date"
              aria-label={`Due for ${item.title}`}
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <button type="button" aria-label={`File ${item.title}`} onClick={() => void file()}>
            File it
          </button>
        </div>
      </details>
      {message && <span className="form-message">{message}</span>}
    </li>
  );
}

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
        <ul aria-label="Inbox items">
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
          <ul aria-label="Archived from the inbox">
            {archived.map((it) => (
              <li key={it.id} className="today-row">
                <span className="today-title">{it.title}</span>
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
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
