import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  archiveItem, deleteItem, fileItem, getItem, putItemBack, saveItemNotes, type SortType,
} from "../data/repo";
import type { AreaId, ISODate, Item } from "../domain/types";
import { GOAL_AREAS_BY_SIDEBAR, NAV } from "./areas";
import { CelebrationPlaceholder } from "./CelebrationPlaceholder";
import { UndoLine } from "./DeleteButton";
import { inboxSource } from "./inboxSource";
import { useSaveError } from "./messages";
import { ShellContext } from "./shellContext";
import { useHubData } from "./useHubData";

const tileOf = (navId: string) => NAV.find((n) => n.id === navId)!;

/** Step 1's three types (VISUAL-LANGUAGE.md, "Chosen layout for the sort card"): Today, Vision board and Goals tiles. */
const TYPES: { type: SortType; label: string; nav: string }[] = [
  { type: "task", label: "To-do", nav: "today" },
  { type: "idea", label: "Idea", nav: "vision" },
  { type: "goal", label: "Goal", nav: "goals" },
];
const typeLabel = (t: SortType) => TYPES.find((x) => x.type === t)!.label;

/** Step 2's app grid: every area but the Inbox, in sidebar order. */
const AREAS = GOAL_AREAS_BY_SIDEBAR.map((a) => ({ ...a, ...pick(tileOf(a.id)) }));
function pick(n: { icon: string; tile: string }) {
  return { icon: n.icon, tile: n.tile };
}

/** "from Obsidian · daily notes", "from Google Tasks", ... (null when the source is unknown). */
export function sourceLine(item: Item): string | null {
  const s = inboxSource(item);
  if (s === "Daily notes") return "from Obsidian · daily notes";
  if (s === "Old task lists") return "from Obsidian · old task lists";
  if (s === "Projects") return "from Obsidian · project notes";
  if (s === "Google Tasks") return "from Google Tasks";
  if (s === "Backlog") return "from the backlog";
  if (item.source?.kind === "obsidian") return "from Obsidian";
  return null;
}

/** The queue: inbox items oldest first, skipped ones at the end in skip order, an undone one first. */
function orderQueue(inbox: Item[], skipped: string[], front: string | null): Item[] {
  const byAge = [...inbox].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || (a.updatedAt ?? 0) - (b.updatedAt ?? 0) || a.id.localeCompare(b.id),
  );
  const later = new Set(skipped);
  const queue = [
    ...byAge.filter((i) => !later.has(i.id)),
    ...skipped.map((id) => byAge.find((i) => i.id === id)).filter((i): i is Item => i !== undefined),
  ];
  const f = front ? queue.findIndex((i) => i.id === front) : -1;
  if (f > 0) queue.unshift(...queue.splice(f, 1));
  return queue;
}

type Last = { message: string; undo?: () => Promise<void> };
type Action = { kind: "file"; type: SortType; areaId: AreaId } | { kind: "archive" } | { kind: "delete" } | { kind: "skip" };

export function SortPage({ today }: { today: ISODate }) {
  const { items, refresh, loaded, error } = useHubData(today);
  const shell = useContext(ShellContext);
  const navigate = useNavigate();
  const [skipped, setSkipped] = useState<string[]>([]);
  const [front, setFront] = useState<string | null>(null);
  const [last, setLast] = useState<Last | null>(null);
  const { attempt, saveError } = useSaveError();
  const busy = useRef(false);
  const acted = useRef(false); // after the first action, each new card takes focus

  const inbox = items.filter((i) => i.areaId === "inbox" && i.status === "open");
  const queue = orderQueue(inbox, skipped, front);
  const current = queue[0];

  const changed = useCallback(async () => {
    await refresh();
    await shell?.refresh();
  }, [refresh, shell]);

  /** Runs one action on the current item (its notes already saved). */
  async function act(item: Item, a: Action) {
    if (busy.current) return;
    busy.current = true;
    try {
      if (a.kind === "skip") {
        setSkipped((s) => [...s.filter((id) => id !== item.id), item.id]);
        setFront((f) => (f === item.id ? null : f));
        setLast({ message: "Skipped (it comes back at the end)" });
        acted.current = true;
        return;
      }
      const before: { row?: Item } = {};
      const ok = await attempt(async () => {
        before.row = await getItem(item.id);
        if (a.kind === "file") await fileItem(item.id, a.type, a.areaId, today);
        else if (a.kind === "archive") await archiveItem(item.id, today);
        else await deleteItem(item.id, today);
      });
      if (!ok) return;
      const message =
        a.kind === "file"
          ? `Filed as ${typeLabel(a.type)} in ${AREAS.find((x) => x.id === a.areaId)!.label}`
          : a.kind === "archive"
            ? "Archived"
            : "Moved to the Bin";
      const was = before.row;
      // A goal cannot be taken back (sync never deletes rows), so Goal has no Undo.
      const undoable = was !== undefined && !(a.kind === "file" && a.type === "goal");
      const undo = async () => {
        if (!was || !(await attempt(() => putItemBack(was, today)))) return;
        setFront(was.id);
        setSkipped((s) => s.filter((id) => id !== was.id));
        setLast(null);
        await changed();
      };
      setFront((f) => (f === item.id ? null : f));
      setLast(undoable ? { message, undo } : { message });
      acted.current = true;
      await changed();
    } finally {
      busy.current = false;
    }
  }

  // Escape on the "All sorted" screen (the card handles it while there is one).
  useEffect(() => {
    if (current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") navigate("/inbox");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [current, navigate]);

  if (error) {
    return (
      <section className="sort-page">
        <h1 className="sort-heading">Sort one by one</h1>
        <p>{error}</p>
      </section>
    );
  }

  return (
    <section className="sort-page">
      <h1 className="sort-heading">Sort one by one</h1>
      <div className="sort-stage">
        {loaded && current && (
          <SortCard
            key={current.id}
            item={current}
            today={today}
            focusOnStart={acted.current}
            onAct={(a) => act(current, a)}
            onLeave={() => navigate("/inbox")}
            attempt={attempt}
          />
        )}
        {loaded && !current && (
          <div className="sort-card sort-done">
            <div className="sort-title">All sorted</div>
            <CelebrationPlaceholder />
            <Link to="/inbox" className="btn-secondary">
              Back to the Inbox
            </Link>
          </div>
        )}
        {saveError && <p className="form-message">{saveError}</p>}
        {current && <div className="sort-count">{`1 of ${queue.length}`}</div>}
        <UndoLine message={last?.message} onUndo={last?.undo && (() => void last.undo!())} />
      </div>
    </section>
  );
}

function SortCard({
  item,
  today,
  focusOnStart,
  onAct,
  onLeave,
  attempt,
}: {
  item: Item;
  today: ISODate;
  focusOnStart: boolean;
  onAct: (a: Action) => Promise<void>;
  onLeave: () => void;
  attempt: (fn: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [chosen, setChosen] = useState<SortType | null>(null);
  const [draft, setDraft] = useState(item.notes ?? "");
  const draftRef = useRef(draft);
  const saved = useRef(item.notes ?? "");
  const notesBox = useRef<HTMLTextAreaElement>(null);
  const firstOfStep = useRef<HTMLButtonElement>(null);
  const started = useRef(false);
  const line = sourceLine(item);

  /** Saves the notes if they changed. Returns false if the save failed (the action then waits). */
  async function saveNotes(): Promise<boolean> {
    const text = draftRef.current;
    if (text === saved.current) return true;
    const ok = await attempt(() => saveItemNotes(item.id, text, today));
    if (ok) saved.current = text;
    return ok;
  }

  async function run(a: Action) {
    if (!(await saveNotes())) return;
    await onAct(a);
  }

  // Auto-grow the notes box to fit its text.
  useLayoutEffect(() => {
    const box = notesBox.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight}px`;
  }, [draft]);

  // Keyboard focus follows the step (and lands on a new card after an action).
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      if (!focusOnStart) return;
    }
    firstOfStep.current?.focus();
  }, [chosen, focusOnStart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === "TEXTAREA" || t.tagName === "INPUT" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "Escape") {
        // In the notes box, Escape just leaves the box (which saves it).
        if (typing) (t as HTMLElement).blur();
        else void saveNotes().then((ok) => ok && onLeave());
        return;
      }
      if (typing) return;
      const i = ["1", "2", "3"].indexOf(e.key);
      if (i !== -1) {
        e.preventDefault();
        setChosen(TYPES[i].type);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <section className="sort-card" aria-label="Item to sort">
      <div>
        <div className="sort-title">{item.title}</div>
        {line && <div className="sort-source">{line}</div>}
      </div>
      <textarea
        ref={notesBox}
        className="sort-notes"
        aria-label="Notes"
        placeholder="Add a note…"
        rows={1}
        value={draft}
        onChange={(e) => {
          draftRef.current = e.target.value;
          setDraft(e.target.value);
        }}
        onBlur={() => void saveNotes()}
      />
      {chosen === null ? (
        <div>
          <div className="sort-q" id="sort-q-type">
            What is it?
          </div>
          <div className="sort-types" role="group" aria-labelledby="sort-q-type">
            {TYPES.map((t, i) => {
              const n = tileOf(t.nav);
              return (
                <button key={t.type} ref={i === 0 ? firstOfStep : undefined} type="button" className="sort-type" onClick={() => setChosen(t.type)}>
                  <span className="sort-tile" style={{ background: n.tile }}>
                    <img src={n.icon} alt="" />
                  </span>
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <>
          <button ref={firstOfStep} type="button" className="link-button sort-back" onClick={() => setChosen(null)}>
            {`← ${typeLabel(chosen)} · change`}
          </button>
          <div>
            <div className="sort-q" id="sort-q-area">
              Which area?
            </div>
            <div className="sort-apps" role="group" aria-labelledby="sort-q-area">
              {AREAS.map((a) => (
                <button key={a.id} type="button" className="sort-app" onClick={() => void run({ kind: "file", type: chosen, areaId: a.id })}>
                  <span className="sort-tile" style={{ background: a.tile }}>
                    <img src={a.icon} alt="" />
                  </span>
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
      <div className="sort-foot">
        <button type="button" className="btn-secondary" onClick={() => void run({ kind: "archive" })}>
          Archive
        </button>
        <button type="button" className="btn-secondary" onClick={() => void run({ kind: "delete" })}>
          Delete
        </button>
        <span className="sort-grow" />
        <button type="button" className="btn-secondary" onClick={() => void run({ kind: "skip" })}>
          Skip →
        </button>
      </div>
    </section>
  );
}
