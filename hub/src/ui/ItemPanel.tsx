import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { saveItemNotes, updateItem } from "../data/repo";
import { dayLabel } from "../domain/display";
import type { AreaId, Goal, ISODate, Item, Priority } from "../domain/types";
import { GOAL_AREAS } from "./areas";
import { areaLabel } from "./GoalProgress";
import { FLAG_GLYPH } from "./IconPopover";
import { useSaveError } from "./messages";
import { usePanel } from "./panelContext";
import { PanelTop } from "./PanelTop";
import type { EscapeHandler } from "./SidePanel";
import { AUTOSAVE_MS, useDraft } from "./useDraft";

const TYPE_LABEL: Record<Item["kind"], string> = { task: "To-do", idea: "Idea" };

interface Fields {
  kind: Item["kind"];
  areaId: AreaId;
  due: string;
  goalId: string;
  priority: Priority;
  milestone: boolean;
}

const fieldsOf = (it: Item): Fields => ({
  kind: it.kind,
  areaId: it.areaId,
  due: it.due ?? "",
  goalId: it.goalId ?? "",
  priority: it.priority,
  milestone: it.milestone === true,
});

/**
 * A task or idea in the side panel: the title (always editable, saved on blur), the
 * properties (Type, Area, Due, Goal, Priority; Milestone when it has a goal), editable
 * after Edit, then the notes page (always typeable, saved as you pause). An Inbox item has
 * no type until it is sorted, so it shows no Type and its area changes only through Sort.
 */
export function ItemPanel({
  item,
  goals,
  today,
  phone,
  onChanged,
  escape,
}: {
  item: Item;
  goals: Goal[];
  today: ISODate;
  phone: boolean;
  onChanged: () => Promise<void>;
  escape: EscapeHandler;
}) {
  const panel = usePanel();
  const { attempt, saveError } = useSaveError();
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<Fields>(() => fieldsOf(item));
  const [busy, setBusy] = useState(false);
  const inbox = item.areaId === "inbox";

  async function write(fn: () => Promise<unknown>) {
    const ok = await attempt(fn);
    if (ok) await onChanged();
    if (!ok) throw new Error("not saved");
  }

  const title = useDraft(item.title, async (t) => {
    if (!t.trim()) return; // a blank title is not saved; the stored one comes back on reopen
    await write(() => updateItem(item.id, { title: t.trim() }, today));
  });
  const notes = useDraft(item.notes ?? "", (t) => write(() => saveItemNotes(item.id, t, today)), AUTOSAVE_MS);

  // Escape while editing discards the field changes instead of closing the panel.
  useEffect(() => {
    escape.current = editing
      ? () => {
          setEditing(false);
          return true;
        }
      : null;
    return () => {
      escape.current = null;
    };
  }, [editing, escape]);

  function startEdit() {
    setFields(fieldsOf(item));
    setEditing(true);
  }

  async function done() {
    if (busy) return;
    const f = fields;
    const patch: Partial<Item> = { priority: f.priority };
    const isTask = inbox || f.kind === "task";
    if (!inbox) {
      patch.kind = f.kind;
      patch.areaId = f.areaId;
    }
    if (isTask) {
      patch.due = f.due || undefined;
      patch.goalId = f.goalId || undefined;
      patch.milestone = f.goalId && f.milestone ? true : undefined;
    } else {
      // An idea has no due date, repeat or day on Today (as Change to → Idea does).
      Object.assign(patch, { due: undefined, recur: undefined, pinnedDate: undefined, hiddenOn: undefined, milestone: undefined });
    }
    setBusy(true);
    try {
      await write(() => updateItem(item.id, patch, today));
      setEditing(false);
    } catch {
      // The save message shows; stay in Edit mode with the changes.
    } finally {
      setBusy(false);
    }
  }

  const goal = goals.find((g) => g.id === item.goalId);
  const isTask = inbox || item.kind === "task";
  const showGoal = editing ? inbox || fields.kind === "task" : isTask;

  return (
    <div className="peek-body">
      <PanelTop
        phone={phone}
        editing={editing}
        busy={busy}
        onEdit={startEdit}
        onDone={() => void done()}
        onCancel={() => setEditing(false)}
      />
      <div className="peek-content">
      <input
        className="peek-title"
        aria-label="Title"
        value={title.value}
        onChange={(e) => title.set(e.target.value)}
        onBlur={title.flush}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {saveError && <p className="form-message">{saveError}</p>}
      <div className="peek-props">
        {!inbox && (
          <>
            <span className="peek-key">Type</span>
            {editing ? (
              <select
                aria-label="Type"
                value={fields.kind}
                onChange={(e) => setFields({ ...fields, kind: e.target.value as Item["kind"] })}
              >
                <option value="task">To-do</option>
                <option value="idea">Idea</option>
              </select>
            ) : (
              <span>
                <span className="chip">{TYPE_LABEL[item.kind]}</span>
              </span>
            )}
          </>
        )}
        <span className="peek-key">Area</span>
        {editing && !inbox ? (
          <select
            aria-label="Area"
            value={fields.areaId}
            onChange={(e) => setFields({ ...fields, areaId: e.target.value as AreaId })}
          >
            {GOAL_AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        ) : (
          <span>
            <span className="chip">{inbox ? "Inbox" : areaLabel(item.areaId)}</span>
          </span>
        )}
        {showGoal && (
          <>
            <span className="peek-key">Due</span>
            {editing ? (
              <input type="date" aria-label="Due" value={fields.due} onChange={(e) => setFields({ ...fields, due: e.target.value })} />
            ) : (
              <span>{item.due ? dayLabel(item.due, today) : "None"}</span>
            )}
            <span className="peek-key">Goal</span>
            {editing ? (
              <select aria-label="Goal" value={fields.goalId} onChange={(e) => setFields({ ...fields, goalId: e.target.value })}>
                <option value="">None</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            ) : goal ? (
              <span>
                <button type="button" className="chip chip-link" onClick={() => panel?.open(goal.id)}>
                  {goal.title}
                </button>
              </span>
            ) : (
              <span>None</span>
            )}
            {(editing ? fields.goalId : goal) && (
              <>
                <span className="peek-key">Milestone</span>
                {editing ? (
                  <label className="form-check">
                    <input
                      type="checkbox"
                      checked={fields.milestone}
                      onChange={(e) => setFields({ ...fields, milestone: e.target.checked })}
                    />
                    <span className="flag" aria-hidden="true">
                      {FLAG_GLYPH}
                    </span>
                    Milestone
                  </label>
                ) : (
                  <span>
                    {item.milestone ? (
                      <>
                        <span className="flag" aria-hidden="true">
                          {FLAG_GLYPH}
                        </span>
                        Yes
                      </>
                    ) : (
                      "No"
                    )}
                  </span>
                )}
              </>
            )}
            <span className="peek-key">Priority</span>
            {editing ? (
              <select
                aria-label="Priority"
                value={fields.priority}
                onChange={(e) => setFields({ ...fields, priority: Number(e.target.value) as Priority })}
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            ) : (
              <span>{item.priority}</span>
            )}
          </>
        )}
      </div>
      <NotesBox value={notes.value} onChange={notes.set} onBlur={notes.flush} />
      </div>
    </div>
  );
}

/**
 * The notes page for round 3a: a plain textarea that grows with its text (round 3b swaps
 * in the Notion-like editor). Markdown is kept exactly as typed.
 */
export function NotesBox({
  value,
  onChange,
  onBlur,
  maxLength,
  label = "Notes",
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  maxLength?: number;
  label?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      className="peek-notes"
      aria-label={label}
      placeholder="Start typing…"
      value={value}
      maxLength={maxLength}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  );
}
