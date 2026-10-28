import { useState } from "react";
import type { GoalPatch } from "../data/repo";
import type { AreaId, Goal } from "../domain/types";
import { GOAL_AREAS } from "./areas";

/** Edit a goal's title, area, deadline and monthly target. Existing form classes only. */
export function GoalEditForm({ goal, onSave }: { goal: Goal; onSave: (patch: GoalPatch) => Promise<void> }) {
  const [title, setTitle] = useState(goal.title);
  const [areaId, setAreaId] = useState<AreaId>(goal.areaId);
  const [deadline, setDeadline] = useState(goal.deadline ?? "");
  const [target, setTarget] = useState(goal.monthlyTarget === undefined ? "" : String(goal.monthlyTarget));
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) return setMessage("Give the goal a title.");
    if (goal.kind === "finite" && !deadline) return setMessage("A finite goal needs a deadline.");
    let monthlyTarget: number | undefined;
    if (target.trim() !== "") {
      monthlyTarget = Number(target);
      if (!Number.isInteger(monthlyTarget) || monthlyTarget < 1) {
        return setMessage("A monthly target is a whole number, 1 or more.");
      }
    }
    setMessage("");
    setBusy(true);
    try {
      await onSave({ title: title.trim(), areaId, deadline: deadline || undefined, monthlyTarget });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="goal-edit">
      <h2>Edit</h2>
      <form className="form-grid" noValidate onSubmit={(e) => void submit(e)}>
        <label className="form-field form-full">
          <span className="form-label">Title</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="form-field">
          <span className="form-label">Area</span>
          <select value={areaId} onChange={(e) => setAreaId(e.target.value as AreaId)}>
            {GOAL_AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span className="form-label">Deadline</span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
        <label className="form-field">
          <span className="form-label">Monthly target</span>
          <input type="number" min={1} value={target} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <div className="form-actions form-full">
          <button type="submit" disabled={busy}>
            Save goal
          </button>
        </div>
      </form>
      {message && <p className="form-message">{message}</p>}
    </section>
  );
}
