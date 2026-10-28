import { useEffect, useRef, useState } from "react";
import { createItem, deleteGoal, saveGoalNotes, untickItem, updateGoal, type GoalPatch } from "../data/repo";
import { MAX_GOAL_TEXT } from "../data/validate";
import { monthName, shortDate } from "../domain/display";
import { doneThisMonth, goalTaskSplit, milestoneProgress, monthlyProgress, monthsInARow } from "../domain/progress";
import type { AreaId, Goal, ISODate, Item } from "../domain/types";
import { GOAL_AREAS, NAV } from "./areas";
import { DoneStrip } from "./DoneSection";
import { areaLabel } from "./GoalProgress";
import { NotesBox } from "./ItemPanel";
import { useSaveError } from "./messages";
import { usePanel } from "./panelContext";
import { PanelTop } from "./PanelTop";
import { ProgressBar } from "./ProgressBar";
import type { EscapeHandler } from "./SidePanel";
import { TaskRow, useTick } from "./TaskRow";
import { AUTOSAVE_MS, useDraft } from "./useDraft";

/** How many completed tasks show before "Show all" (round-3 brief). */
export const COMPLETED_CAP = 10;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const pct = (r: number) => `${Math.round(Math.min(1, Math.max(0, r)) * 100)}%`;

interface Fields {
  title: string;
  areaId: AreaId;
  kind: Goal["kind"];
  deadline: string;
  target: string;
  cadence: string;
  why: string;
}

const fieldsOf = (g: Goal): Fields => ({
  title: g.title,
  areaId: g.areaId,
  kind: g.kind,
  deadline: g.deadline ?? "",
  target: g.monthlyTarget === undefined ? "" : String(g.monthlyTarget),
  cadence: g.cadence ?? "",
  why: g.why ?? "",
});

/**
 * A goal in the side panel (VISUAL-LANGUAGE.md "Goal view"; goal.html, top of tab B):
 * header (area tile, title, chips), the overall and this-month bars, three stat boxes,
 * why, the goal's tasks as "To come" and "Completed" (milestones are flagged tasks among
 * them), notes, and Delete goal at the bottom. Edit switches the properties into fields;
 * ticking tasks and typing notes work without it.
 */
export function GoalPanel({
  goal,
  items,
  today,
  phone,
  onChanged,
  escape,
}: {
  goal: Goal;
  items: Item[];
  today: ISODate;
  phone: boolean;
  onChanged: () => Promise<void>;
  escape: EscapeHandler;
}) {
  const panel = usePanel();
  const { attempt, saveError } = useSaveError();
  const { tick, celebration, message } = useTick(today, onChanged);
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<Fields>(() => fieldsOf(goal));
  const [formMessage, setFormMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLInputElement>(null);

  async function write(fn: () => Promise<unknown>): Promise<boolean> {
    const ok = await attempt(fn);
    if (ok) await onChanged();
    return ok;
  }

  const notes = useDraft(
    goal.notes ?? "",
    async (t) => {
      if (!(await write(() => saveGoalNotes(goal.id, t)))) throw new Error("not saved");
    },
    AUTOSAVE_MS,
  );

  useEffect(() => {
    escape.current = editing
      ? () => {
          setEditing(false);
          setFormMessage("");
          return true;
        }
      : adding
        ? () => {
            setAdding(false);
            return true;
          }
        : null;
    return () => {
      escape.current = null;
    };
  }, [editing, adding, escape]);

  useEffect(() => {
    if (asking) cancelRef.current?.focus();
  }, [asking]);
  useEffect(() => {
    if (adding) addRef.current?.focus();
  }, [adding]);

  function startEdit() {
    setFields(fieldsOf(goal));
    setFormMessage("");
    setEditing(true);
  }

  async function done() {
    if (busy) return;
    const f = fields;
    if (!f.title.trim()) return setFormMessage("Give the goal a title.");
    if (f.kind === "finite" && !f.deadline) return setFormMessage("A finite goal needs a deadline.");
    let monthlyTarget: number | undefined;
    if (f.target.trim() !== "") {
      monthlyTarget = Number(f.target);
      if (!Number.isInteger(monthlyTarget) || monthlyTarget < 1) {
        return setFormMessage("A monthly target is a whole number, 1 or more.");
      }
    }
    const patch: GoalPatch = {
      title: f.title.trim(),
      areaId: f.areaId,
      kind: f.kind,
      deadline: f.kind === "finite" ? f.deadline : undefined,
      monthlyTarget,
      cadence: f.cadence,
      why: f.why,
    };
    setFormMessage("");
    setBusy(true);
    try {
      if (await write(() => updateGoal(goal.id, patch, today))) setEditing(false);
    } finally {
      setBusy(false);
    }
  }

  async function addTask() {
    const title = newTitle.trim();
    if (!title) return;
    const ok = await write(() =>
      createItem({ kind: "task", title, areaId: goal.areaId, goalId: goal.id, priority: 2 }, today),
    );
    if (ok) setNewTitle("");
  }

  const nav = NAV.find((n) => n.id === goal.areaId);
  const overall = milestoneProgress(goal, items);
  const month = monthlyProgress(goal, items, today);
  const inARow = monthsInARow(goal, items, today);
  const { toCome, completed } = goalTaskSplit(goal, items);
  const shownDone = allDone ? completed : completed.slice(0, COMPLETED_CAP);
  const cadence = goal.cadence?.split(/\n+/).find((l) => l.trim());

  return (
    <div className="peek-body goal-peek">
      <PanelTop
        phone={phone}
        kicker="Goal"
        editing={editing}
        busy={busy}
        onEdit={startEdit}
        onDone={() => void done()}
        onCancel={() => {
          setEditing(false);
          setFormMessage("");
        }}
      />
      <div className="peek-content">
      {editing ? (
        <form
          className="form-grid"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void done();
          }}
        >
          <label className="form-field form-full">
            <span className="form-label">Title</span>
            <input type="text" value={fields.title} onChange={(e) => setFields({ ...fields, title: e.target.value })} />
          </label>
          <label className="form-field">
            <span className="form-label">Area</span>
            <select value={fields.areaId} onChange={(e) => setFields({ ...fields, areaId: e.target.value as AreaId })}>
              {GOAL_AREAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span className="form-label">Type</span>
            <select value={fields.kind} onChange={(e) => setFields({ ...fields, kind: e.target.value as Goal["kind"] })}>
              <option value="finite">Finish by a date</option>
              <option value="practice">Practice</option>
            </select>
          </label>
          {fields.kind === "finite" && (
            <label className="form-field">
              <span className="form-label">Deadline</span>
              <input type="date" value={fields.deadline} onChange={(e) => setFields({ ...fields, deadline: e.target.value })} />
            </label>
          )}
          <label className="form-field">
            <span className="form-label">Monthly target</span>
            <input type="number" min={1} step={1} value={fields.target} onChange={(e) => setFields({ ...fields, target: e.target.value })} />
          </label>
          <label className="form-field form-full">
            <span className="form-label">How often</span>
            <input
              type="text"
              maxLength={MAX_GOAL_TEXT}
              value={fields.cadence}
              onChange={(e) => setFields({ ...fields, cadence: e.target.value })}
            />
          </label>
          <label className="form-field form-full">
            <span className="form-label">Why it matters</span>
            <textarea maxLength={MAX_GOAL_TEXT} value={fields.why} onChange={(e) => setFields({ ...fields, why: e.target.value })} />
          </label>
          {formMessage && <p className="form-message form-full">{formMessage}</p>}
        </form>
      ) : (
        <div className="goal-peek-head">
          <span className="goal-peek-tile" style={{ background: nav?.tile }}>
            {nav && <img src={nav.icon} alt="" width={26} height={26} />}
          </span>
          <div className="goal-peek-name">
            <h2 className="goal-peek-title">{goal.title}</h2>
            <div className="goal-peek-chips">
              <span className="chip">{areaLabel(goal.areaId)}</span>
              <span className="chip">
                {goal.kind === "finite" && goal.deadline ? `By ${shortDate(goal.deadline, today)}` : "Practice"}
              </span>
              {cadence && <span className="chip">{cadence}</span>}
            </div>
          </div>
        </div>
      )}
      {saveError && <p className="form-message">{saveError}</p>}
      {celebration}
      {message}
      {(overall || month) && (
        <div className="goal-peek-bars">
          {overall && (
            <div>
              <div className="bar-label">
                <span>{overall.flagged ? "Overall · milestones" : "Overall · tasks"}</span>
                <span>{pct(overall.ratio)}</span>
              </div>
              <ProgressBar ratio={overall.ratio} label={`Overall ${overall.done}/${overall.total}`} />
            </div>
          )}
          {month && (
            <div>
              <div className="bar-label">
                <span>{`${monthName(today)}: ${month.done} of ${month.target} sessions`}</span>
                <span>{`${plural(inARow, "month")} in a row`}</span>
              </div>
              <ProgressBar ratio={month.ratio} label={`This month ${month.done}/${month.target}`} />
            </div>
          )}
        </div>
      )}
      <div className="goal-peek-stats">
        {overall && (
          <div className="goal-peek-stat">
            <b>{pct(overall.ratio)}</b>
            <span>overall</span>
          </div>
        )}
        <div className="goal-peek-stat">
          <b>{month ? `${month.done}/${month.target}` : doneThisMonth(goal, items, today)}</b>
          <span>this month</span>
        </div>
        <div className="goal-peek-stat">
          <b>{inARow}</b>
          <span>{`${inARow === 1 ? "month" : "months"} in a row`}</span>
        </div>
      </div>
      {!editing && goal.why && (
        <section>
          <h3 className="peek-sec">Why it matters</h3>
          <div className="goal-peek-box">
            {goal.why.split(/\n+/).filter(Boolean).map((t, n) => (
              <p key={n}>{t}</p>
            ))}
          </div>
        </section>
      )}
      <section aria-labelledby="goal-tasks-heading">
        <h3 className="peek-sec" id="goal-tasks-heading">
          Tasks for this goal
          <button type="button" className="peek-add" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
            + Add a task
          </button>
        </h3>
        {adding && (
          <form
            className="peek-add-row"
            onSubmit={(e) => {
              e.preventDefault();
              void addTask();
            }}
          >
            <input
              ref={addRef}
              type="text"
              aria-label="New task for this goal"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
            />
            <button type="submit" disabled={!newTitle.trim()}>
              Add
            </button>
          </form>
        )}
        <h4 className="peek-sub">To come</h4>
        {toCome.length === 0 ? (
          <p>No open tasks attached to this goal.</p>
        ) : (
          <ul aria-label="To come" className="strip-list">
            {toCome.map((it) => (
              <TaskRow key={it.id} item={it} today={today} onTick={tick} onMoved={onChanged} />
            ))}
          </ul>
        )}
        {completed.length > 0 && (
          <>
            <h4 className="peek-sub">Completed</h4>
            <ul aria-label="Completed" className="strip-list">
              {shownDone.map((it) => (
                <DoneStrip key={it.id} item={it} today={today} onUndo={(id) => void write(() => untickItem(id, today))} />
              ))}
            </ul>
            {shownDone.length < completed.length && (
              <p>
                <button type="button" className="btn-secondary" onClick={() => setAllDone(true)}>
                  Show all
                </button>
              </p>
            )}
          </>
        )}
      </section>
      <section>
        <h3 className="peek-sec">Notes</h3>
        <NotesBox value={notes.value} onChange={notes.set} onBlur={notes.flush} maxLength={MAX_GOAL_TEXT} />
      </section>
      {/* Delete goal: to the Bin (restorable there), after the same confirm step as Empty bin. */}
      {!asking ? (
        <p>
          <button type="button" className="btn-secondary" onClick={() => setAsking(true)}>
            Delete goal
          </button>
        </p>
      ) : (
        <div className="btn-group">
          <p id="goal-delete-question">Delete this goal? You can restore it from the Bin.</p>
          <button
            type="button"
            onClick={() =>
              void attempt(() => deleteGoal(goal.id, today)).then(async (ok) => {
                if (!ok) return;
                panel?.close();
                await onChanged();
              })
            }
          >
            Confirm
          </button>
          <button
            ref={cancelRef}
            type="button"
            className="btn-secondary"
            aria-describedby="goal-delete-question"
            onClick={() => setAsking(false)}
          >
            Cancel
          </button>
        </div>
      )}
      </div>
    </div>
  );
}
