import { useEffect, useRef, useState } from "react";
import {
  createItem, deleteGoal, saveGoalNotes, setGoalActive, setGoalOnHome, untickItem, updateGoal, type GoalPatch,
} from "../data/repo";
import { MAX_GOAL_NOTES, MAX_GOAL_TEXT } from "../data/validate";
import { monthName } from "../domain/display";
import { isActive, isDaily, pastMonths } from "../domain/goalCounts";
import { goalTaskSplit, nextGoalOrder } from "../domain/progress";
import type { AreaId, CountSource, Goal, ISODate, Item } from "../domain/types";
import { GOAL_AREAS, NAV } from "./areas";
import { tickedOffToday } from "../domain/triage";
import { DoneStrip } from "./DoneSection";
import { areaLabel } from "./GoalProgress";
import { GoalOverall, goalKindLabel, MonthDots, MonthGoalsBox } from "./GoalTile";
import { PageEditor } from "./PageEditor";
import { useSaveError } from "./messages";
import { usePanel } from "./panelContext";
import { PanelTop } from "./PanelTop";
import type { EscapeHandler } from "./SidePanel";
import { TaskRow, useTick } from "./TaskRow";
import { AUTOSAVE_MS, useDraft } from "./useDraft";
import { useGoalSources } from "./useGoalSources";

/** How many completed tasks show before "Show all" (round-3 brief). */
export const COMPLETED_CAP = 10;

/** The Type select: a daily goal is a practice with rhythm "daily". */
type TypeChoice = Goal["kind"] | "daily";

interface Fields {
  title: string;
  areaId: AreaId;
  kind: TypeChoice;
  deadline: string;
  target: string;
  cadence: string;
  why: string;
  /** "Counts from": the three kinds, and an area ("" for none). */
  journal: boolean;
  exercise: boolean;
  linked: boolean;
  countArea: AreaId | "";
}

const has = (g: Goal, s: string) => (g.countsFrom ?? []).some((c) => c === s);

const fieldsOf = (g: Goal): Fields => ({
  title: g.title,
  areaId: g.areaId,
  kind: isDaily(g) ? "daily" : g.kind,
  deadline: g.deadline ?? "",
  target: g.monthlyTarget === undefined ? "" : String(g.monthlyTarget),
  cadence: g.cadence ?? "",
  why: g.why ?? "",
  journal: has(g, "journal"),
  exercise: has(g, "exercise"),
  linked: has(g, "linked"),
  countArea: (g.countsFrom ?? []).flatMap((c) => (typeof c === "string" ? [] : [c.area]))[0] ?? "",
});

/** The "Counts from" fields as the goal's list, keeping any further areas it already had. */
function sourcesOf(f: Fields, g: Goal): CountSource[] {
  const out: CountSource[] = [];
  if (f.journal) out.push("journal");
  if (f.exercise) out.push("exercise");
  if (f.linked) out.push("linked");
  const areas = (g.countsFrom ?? []).filter((c): c is { area: AreaId } => typeof c !== "string");
  if (f.countArea) out.push({ area: f.countArea }, ...areas.slice(1).filter((a) => a.area !== f.countArea));
  return out;
}

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
  const { sources } = useGoalSources(items);
  const { attempt, saveError } = useSaveError();
  const { tick, celebration, message } = useTick(today, onChanged);
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<Fields>(() => fieldsOf(goal));
  const [snapshot, setSnapshot] = useState<Fields>(() => fieldsOf(goal));
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
    const now = fieldsOf(goal);
    setFields(now);
    setSnapshot(now);
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
    // Only what was changed in Edit is written, so a change synced in meanwhile is kept (review M-3).
    const was = snapshot;
    const patch: GoalPatch = {};
    if (f.title.trim() !== was.title) patch.title = f.title.trim();
    if (f.areaId !== was.areaId) patch.areaId = f.areaId;
    if (f.kind !== was.kind) {
      // Practice drops the deadline in the repo; Daily is a practice that counts days.
      patch.kind = f.kind === "daily" ? "practice" : f.kind;
      patch.rhythm = f.kind === "daily" ? "daily" : undefined;
    }
    if (f.kind === "finite" && (f.kind !== was.kind || f.deadline !== was.deadline)) patch.deadline = f.deadline;
    if (f.target.trim() !== was.target) patch.monthlyTarget = monthlyTarget;
    if (f.cadence !== was.cadence) patch.cadence = f.cadence;
    if (f.why !== was.why) patch.why = f.why;
    const sourcesNow = sourcesOf(f, goal);
    if (
      f.journal !== was.journal || f.exercise !== was.exercise || f.linked !== was.linked || f.countArea !== was.countArea
    ) {
      patch.countsFrom = sourcesNow;
    }
    setFormMessage("");
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
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
      createItem(
        { kind: "task", title, areaId: goal.areaId, goalId: goal.id, priority: 2, order: nextGoalOrder(goal, items) },
        today,
      ),
    );
    if (ok) setNewTitle("");
  }

  const nav = NAV.find((n) => n.id === goal.areaId);
  const past = pastMonths(goal, today, sources);
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
            <select value={fields.kind} onChange={(e) => setFields({ ...fields, kind: e.target.value as TypeChoice })}>
              <option value="finite">Finish by a date</option>
              <option value="practice">Practice</option>
              <option value="daily">Daily</option>
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
          <fieldset className="form-field form-full goal-sources">
            <legend className="form-label">Counts from</legend>
            <label className="form-check">
              <input type="checkbox" checked={fields.journal} onChange={(e) => setFields({ ...fields, journal: e.target.checked })} />
              Journal
            </label>
            <label className="form-check">
              <input type="checkbox" checked={fields.exercise} onChange={(e) => setFields({ ...fields, exercise: e.target.checked })} />
              Exercise
            </label>
            <label className="form-check">
              <input type="checkbox" checked={fields.linked} onChange={(e) => setFields({ ...fields, linked: e.target.checked })} />
              Linked to-dos
            </label>
            <select
              aria-label="Counts an area"
              value={fields.countArea}
              onChange={(e) => setFields({ ...fields, countArea: e.target.value as AreaId | "" })}
            >
              <option value="">No area</option>
              {GOAL_AREAS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </fieldset>
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
              <span className="chip">{goalKindLabel(goal, today)}</span>
              {cadence && <span className="chip">{cadence}</span>}
            </div>
            <div className="goal-peek-home goal-peek-switches">
              <button
                type="button"
                aria-pressed={isActive(goal)}
                onClick={() => void write(() => setGoalActive(goal.id, !isActive(goal)))}
              >
                Active
              </button>
              <button
                type="button"
                aria-pressed={goal.onHome === true}
                onClick={() => void write(() => setGoalOnHome(goal.id, goal.onHome !== true))}
              >
                Show on Home
              </button>
            </div>
          </div>
        </div>
      )}
      {saveError && <p className="form-message">{saveError}</p>}
      {celebration}
      {message}
      <div className="goal-peek-bars">
        <GoalOverall goal={goal} items={items} today={today} sources={sources} />
        <MonthDots goal={goal} today={today} sources={sources} />
      </div>
      <MonthGoalsBox goal={goal} today={today} sources={sources} onChanged={onChanged} editing={editing} />
      {past.length > 0 && (
        <section aria-labelledby="goal-past-heading">
          <h3 className="peek-sec" id="goal-past-heading">
            Past months
          </h3>
          <ul className="goal-past">
            {past.map((p) => (
              <li key={p.month}>
                <span>{`${monthName(`${p.month}-01`)} ${p.month.slice(0, 4)}`}</span>
                <span>
                  {p.hit === null
                    ? `— · — / ${p.summary.of}` // not known here: the journal is locked (review M1)
                    : `${p.hit ? "Hit" : "Missed"} · ${p.summary.n} / ${p.summary.of}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
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
              <TaskRow
                key={it.id}
                item={it}
                today={today}
                onTick={tick}
                onUntick={(id) => void write(() => untickItem(id, today))}
                crossed={tickedOffToday(it, today)}
                onMoved={onChanged}
              />
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
        <PageEditor value={notes.value} onChange={notes.set} onBlur={notes.flush} today={today} maxLength={MAX_GOAL_NOTES} />
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
