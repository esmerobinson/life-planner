import { useContext, useEffect, useRef, useState } from "react";
import { createItem, listGoals } from "../data/repo";
import type { AreaId, Goal, ISODate, Priority, Weekday } from "../domain/types";
import { AREA_CHOICES } from "./areas";
import { SAVE_ERROR } from "./messages";
import { ShellContext } from "./shellContext";

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function QuickAdd({ today, onAdded }: { today: ISODate; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"task" | "idea">("task");
  const [areaId, setAreaId] = useState<AreaId>("inbox");
  const [goalId, setGoalId] = useState("");
  const [priority, setPriority] = useState<Priority>(2);
  const [due, setDue] = useState("");
  const [recur, setRecur] = useState<Weekday[]>([]);
  const [message, setMessage] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
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

  const areaGoals = goals.filter((g) => g.areaId === areaId);

  function toggleDay(d: Weekday) {
    setRecur((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setMessage("A title is needed.");
      return;
    }
    setMessage("");
    inFlight.current = true;
    setSaving(true);
    try {
      await save(trimmed);
    } catch {
      setMessage(SAVE_ERROR);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  async function save(trimmed: string) {
    await createItem(
      {
        kind,
        title: trimmed,
        areaId,
        priority,
        links: [],
        ...(goalId ? { goalId } : {}),
        ...(kind === "task" && due ? { due } : {}),
        ...(kind === "task" && recur.length
          ? { recur: WEEKDAYS.filter((d) => recur.includes(d)) }
          : {}),
      },
      today,
    );
    setTitle("");
    setKind("task");
    setAreaId("inbox");
    setGoalId("");
    setPriority(2);
    setDue("");
    setRecur([]);
    onAdded();
  }

  return (
    <form className="quick-add" onSubmit={(e) => void submit(e)}>
      <label>
        Title
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as "task" | "idea")}>
          <option value="task">Task</option>
          <option value="idea">Idea</option>
        </select>
      </label>
      <label>
        Area
        <select
          value={areaId}
          onChange={(e) => {
            setAreaId(e.target.value as AreaId);
            setGoalId("");
          }}
        >
          {AREA_CHOICES.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Goal
        <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
          <option value="">None</option>
          {areaGoals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
      </label>
      <label>
        Priority
        <select value={priority} onChange={(e) => setPriority(Number(e.target.value) as Priority)}>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
        </select>
      </label>
      {kind === "task" && (
        <>
          <label>
            Due
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <fieldset>
            <legend>Repeats on</legend>
            {WEEKDAYS.map((d) => (
              <label key={d}>
                <input type="checkbox" checked={recur.includes(d)} onChange={() => toggleDay(d)} />
                {d}
              </label>
            ))}
          </fieldset>
        </>
      )}
      {message && <p className="form-message">{message}</p>}
      <button type="submit" disabled={saving}>
        Add item
      </button>
    </form>
  );
}
