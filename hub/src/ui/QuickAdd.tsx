import { useContext, useEffect, useRef, useState } from "react";
import { createGoal, createItem, listGoals } from "../data/repo";
import { MAX_GOAL_NOTES, MAX_NOTES_TEXT } from "../data/validate";
import type { AreaId, Goal, ISODate, Priority, Weekday } from "../domain/types";
import { BASE_ADD_DEFAULTS, type AddDefaults, type AddType } from "./addContext";
import { AREA_CHOICES, GOAL_AREAS, GOAL_AREAS_BY_SIDEBAR } from "./areas";
import { useGrow } from "./ItemPanel";
import { SAVE_ERROR } from "./messages";
import { ShellContext } from "./shellContext";

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** A goal is never in the inbox: the first area in the sidebar stands in. */
const goalArea = (a: AreaId): AreaId => (a === "inbox" ? GOAL_AREAS_BY_SIDEBAR[0].id : a);

/**
 * The Add form. It opens pre-set from the page Add was pressed on (`defaults`, see
 * addContext.ts); type and area can still be changed. Notes are saved with the item (or
 * the goal) as its page.
 */
export function QuickAdd({
  today,
  onAdded,
  defaults = BASE_ADD_DEFAULTS,
}: {
  today: ISODate;
  onAdded: () => void;
  defaults?: AddDefaults;
}) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<AddType>(defaults.type);
  const [areaId, setAreaId] = useState<AreaId>(defaults.type === "goal" ? goalArea(defaults.areaId) : defaults.areaId);
  const [goalId, setGoalId] = useState("");
  const [priority, setPriority] = useState<Priority>(2);
  const [due, setDue] = useState("");
  const [recur, setRecur] = useState<Weekday[]>([]);
  const [notes, setNotes] = useState("");
  const [goalKind, setGoalKind] = useState<Goal["kind"]>("finite");
  const [deadline, setDeadline] = useState("");
  const [target, setTarget] = useState("");
  const [message, setMessage] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const notesRef = useGrow(notes);
  // Re-read goals when the shell reports a change (e.g. a goal created on /goals).
  const version = useContext(ShellContext)?.version ?? 0;

  useEffect(() => {
    let live = true;
    listGoals().then(
      (g) => {
        if (live) setGoals(g);
      },
      () => {}, // the goal list just stays as it was; saving still works without a goal
    );
    return () => {
      live = false;
    };
  }, [version]);

  const isGoal = type === "goal";
  const areaGoals = goals.filter((g) => g.areaId === areaId);
  const notesCap = isGoal ? MAX_GOAL_NOTES : MAX_NOTES_TEXT;

  function toggleDay(d: Weekday) {
    setRecur((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  }

  function changeType(next: AddType) {
    setType(next);
    if (next === "goal") {
      setAreaId((a) => goalArea(a));
      setGoalId("");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setMessage("A title is needed.");
      return;
    }
    let monthlyTarget: number | undefined;
    if (isGoal) {
      if (goalKind === "finite" && !deadline) return setMessage("A finite goal needs a deadline.");
      if (target.trim() !== "") {
        monthlyTarget = Number(target);
        if (!Number.isInteger(monthlyTarget) || monthlyTarget < 1) {
          return setMessage("A monthly target is a whole number, 1 or more.");
        }
      }
    }
    if (notes.length > notesCap) {
      return setMessage(`Notes are at most ${notesCap.toLocaleString("en-GB")} characters here.`);
    }
    setMessage("");
    inFlight.current = true;
    setSaving(true);
    try {
      await save(trimmed, monthlyTarget);
    } catch {
      setMessage(SAVE_ERROR);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  async function save(trimmed: string, monthlyTarget: number | undefined) {
    const page = notes.trim() ? { notes } : {};
    if (isGoal) {
      await createGoal(
        {
          title: trimmed,
          areaId,
          kind: goalKind,
          ...(goalKind === "finite" ? { deadline } : {}),
          ...(monthlyTarget !== undefined ? { monthlyTarget } : {}),
          ...page,
        },
        today,
      );
    } else {
      await createItem(
        {
          kind: type,
          title: trimmed,
          areaId,
          priority,
          links: [],
          ...page,
          ...(goalId ? { goalId } : {}),
          ...(type === "task" && due ? { due } : {}),
          ...(type === "task" && recur.length ? { recur: WEEKDAYS.filter((d) => recur.includes(d)) } : {}),
        },
        today,
      );
    }
    // Ready for the next one, pre-set as the form opened.
    setTitle("");
    setType(defaults.type);
    setAreaId(defaults.type === "goal" ? goalArea(defaults.areaId) : defaults.areaId);
    setGoalId("");
    setPriority(2);
    setDue("");
    setRecur([]);
    setNotes("");
    setGoalKind("finite");
    setDeadline("");
    setTarget("");
    onAdded();
  }

  return (
    <form className="quick-add form-grid" onSubmit={(e) => void submit(e)}>
      <label className="form-field form-full">
        <span className="form-label">Title</span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="form-field">
        <span className="form-label">Type</span>
        <select value={type} onChange={(e) => changeType(e.target.value as AddType)}>
          <option value="task">To-do</option>
          <option value="idea">Idea</option>
          <option value="goal">Goal</option>
        </select>
      </label>
      <label className="form-field">
        <span className="form-label">Area</span>
        <select
          value={areaId}
          onChange={(e) => {
            setAreaId(e.target.value as AreaId);
            setGoalId("");
          }}
        >
          {(isGoal ? GOAL_AREAS : AREA_CHOICES).map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      {isGoal ? (
        <>
          <label className="form-field">
            <span className="form-label">Kind of goal</span>
            <select value={goalKind} onChange={(e) => setGoalKind(e.target.value as Goal["kind"])}>
              <option value="finite">Finish by a date</option>
              <option value="practice">Practice</option>
            </select>
          </label>
          {goalKind === "finite" && (
            <label className="form-field">
              <span className="form-label">Deadline</span>
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </label>
          )}
          <label className="form-field">
            <span className="form-label">Monthly target</span>
            <input type="number" min={1} step={1} value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
        </>
      ) : (
        <>
          <label className="form-field">
            <span className="form-label">Goal</span>
            <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">None</option>
              {areaGoals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span className="form-label">Priority</span>
            <select value={priority} onChange={(e) => setPriority(Number(e.target.value) as Priority)}>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
        </>
      )}
      {type === "task" && (
        <>
          <label className="form-field">
            <span className="form-label">Due</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <fieldset className="form-full">
            <legend>Repeats on</legend>
            <div className="form-checks">
            {WEEKDAYS.map((d) => (
              <label key={d} className="form-check">
                <input type="checkbox" checked={recur.includes(d)} onChange={() => toggleDay(d)} />
                {d}
              </label>
            ))}
            </div>
          </fieldset>
        </>
      )}
      <label className="form-field form-full">
        <span className="form-label">Notes</span>
        <textarea
          ref={notesRef}
          rows={2}
          className="quick-add-notes"
          maxLength={notesCap}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {message && <p className="form-message form-full">{message}</p>}
      <div className="form-actions form-full">
        <button type="submit" disabled={saving}>
          Add item
        </button>
      </div>
    </form>
  );
}
