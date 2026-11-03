import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isActive } from "../domain/goalCounts";
import { saveItemNotes, updateItem } from "../data/repo";
import { needsALook } from "../domain/attention";
import { daysBetween } from "../domain/dates";
import { dayLabel } from "../domain/display";
import type { AreaId, Goal, ISODate, Item, Priority } from "../domain/types";
import { GOAL_AREAS } from "./areas";
import { areaLabel } from "./GoalProgress";
import { FLAG_GLYPH } from "./IconPopover";
import { useSaveError } from "./messages";
import { usePanel } from "./panelContext";
import { PanelTop } from "./PanelTop";
import type { EscapeHandler } from "./SidePanel";
import { PageEditor } from "./PageEditor";
import { ProjectSummary, SessionList } from "./ProjectPanel";
import { DEFAULT_SESSIONS, isProject, newSessions } from "../domain/projects";
import { AUTOSAVE_MS, useDraft } from "./useDraft";

/** The Type property: a project is a to-do with sessions, shown as its own type. */
type PanelKind = Item["kind"] | "project";
const TYPE_LABEL: Record<PanelKind, string> = { task: "To-do", project: "Project", idea: "Idea" };
const kindOf = (it: Item): PanelKind => (isProject(it) ? "project" : it.kind);

interface Fields {
  kind: PanelKind;
  areaId: AreaId;
  due: string;
  goalId: string;
  priority: Priority;
  milestone: boolean;
}

const fieldsOf = (it: Item): Fields => ({
  kind: kindOf(it),
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
  const [snapshot, setSnapshot] = useState<Fields>(() => fieldsOf(item));
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
    const now = fieldsOf(item);
    setFields(now);
    setSnapshot(now);
    setEditing(true);
  }

  async function done() {
    if (busy) return;
    // Only what was changed in Edit is written, so a change synced in meanwhile is kept (review M-3).
    const f = fields;
    const was = snapshot;
    const patch: Partial<Item> = {};
    if (f.priority !== was.priority) patch.priority = f.priority;
    if (!inbox && f.kind !== was.kind) {
      // Project <-> to-do: the sessions come or go (a project does not repeat); an idea has none.
      // A done to-do made a project is open again: a project is done only when its sessions are (I-1).
      if (f.kind === "project") {
        Object.assign(patch, { kind: "task", sessions: item.sessions ?? newSessions(DEFAULT_SESSIONS), recur: undefined });
        if (item.status === "done") Object.assign(patch, { status: "open", completedAt: undefined });
      } else patch.kind = f.kind;
      if (was.kind === "project" && f.kind !== "project") patch.sessions = undefined;
    }
    if (!inbox && f.areaId !== was.areaId) patch.areaId = f.areaId;
    if (inbox || f.kind !== "idea") {
      if (f.due !== was.due) patch.due = f.due || undefined;
      if (f.goalId !== was.goalId) patch.goalId = f.goalId || undefined;
      const flag = Boolean(f.goalId && f.milestone);
      if (flag !== was.milestone) patch.milestone = flag ? true : undefined;
    } else if (patch.kind === "idea") {
      // An idea has no due date, repeat or day on Today (as Change to → Idea does).
      Object.assign(patch, { due: undefined, recur: undefined, pinnedDate: undefined, hiddenOn: undefined, milestone: undefined });
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
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
  // Days untouched, when it is in Needs a look's "Not looked at in a while" group.
  const stale = needsALook([item], today).stale.length > 0 ? daysBetween(item.touchedAt, today) : null;
  const isTask = inbox || item.kind === "task";
  const showGoal = editing ? inbox || fields.kind !== "idea" : isTask;
  const project = isProject(item);
  // A project's due date is its deadline (2C).
  const dueKey = (editing ? fields.kind === "project" : project) ? "Deadline" : "Due";

  return (
    <div className="peek-body">
      <PanelTop
        phone={phone}
        kicker={project ? "Project" : undefined}
        editing={editing}
        busy={busy}
        onEdit={startEdit}
        onDone={() => void done()}
        onCancel={() => setEditing(false)}
      />
      <div className="peek-content">
      <TitleBox value={title.value} onChange={title.set} onBlur={title.flush} />
      {saveError && <p className="form-message">{saveError}</p>}
      <div className="peek-props">
        {!inbox && (
          <>
            <span className="peek-key">Type</span>
            {editing ? (
              <select
                aria-label="Type"
                value={fields.kind}
                onChange={(e) => setFields({ ...fields, kind: e.target.value as PanelKind })}
              >
                <option value="task">To-do</option>
                <option value="project">Project</option>
                <option value="idea">Idea</option>
              </select>
            ) : (
              <span>
                <span className="chip">{TYPE_LABEL[kindOf(item)]}</span>
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
        {/* The stale reason left the Needs-a-look strip (compact strips); read-only here. */}
        {stale !== null && (
          <>
            <span className="peek-key">Needs a look</span>
            <span>{`Not looked at for ${stale} ${stale === 1 ? "day" : "days"}. What do you want to do with this?`}</span>
          </>
        )}
        {/* Tags no longer show on the strip (compact strips); read-only here, as chips. */}
        {item.tags && item.tags.length > 0 && (
          <>
            <span className="peek-key">Tags</span>
            <span className="peek-tags">
              {item.tags.map((t) => (
                <span key={t} className="chip">{`#${t}`}</span>
              ))}
            </span>
          </>
        )}
        {showGoal && (
          <>
            <span className="peek-key">{dueKey}</span>
            {editing ? (
              <input type="date" aria-label={dueKey} value={fields.due} onChange={(e) => setFields({ ...fields, due: e.target.value })} />
            ) : (
              <span>{item.due ? dayLabel(item.due, today) : "None"}</span>
            )}
            {project && (
              <>
                <span className="peek-key">Sessions</span>
                <span>{item.sessions!.length}</span>
              </>
            )}
            <span className="peek-key">Goal</span>
            {editing ? (
              <select aria-label="Goal" value={fields.goalId} onChange={(e) => setFields({ ...fields, goalId: e.target.value })}>
                <option value="">None</option>
                {goals.filter((g) => isActive(g) || g.id === item.goalId).map((g) => (
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
      {project && (
        <>
          <ProjectSummary item={item} today={today} onChanged={onChanged} />
          <SessionList item={item} today={today} write={write} />
        </>
      )}
      <PageEditor value={notes.value} onChange={notes.set} onBlur={notes.flush} today={today} />
      </div>
    </div>
  );
}

/** A textarea that is always as tall as its text (also when the panel is resized). */
export function useGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);
  return ref;
}

/** The task title: typed straight into, wraps like the heading it is, saved on blur or Enter. */
function TitleBox({ value, onChange, onBlur }: { value: string; onChange: (v: string) => void; onBlur: () => void }) {
  const ref = useGrow(value);
  return (
    <textarea
      ref={ref}
      rows={1}
      className="peek-title"
      aria-label="Title"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.currentTarget.blur();
      }}
    />
  );
}
