import { useState } from "react";
import { createGoal } from "../data/repo";
import type { AreaId, ISODate } from "../domain/types";
import { GOAL_AREAS } from "./areas";
import { SAVE_ERROR } from "./messages";

export function GoalForm({ today, onSaved }: { today: ISODate; onSaved: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [areaId, setAreaId] = useState<AreaId>("writing");
  const [kind, setKind] = useState<"finite" | "practice">("finite");
  const [deadline, setDeadline] = useState("");
  const [target, setTarget] = useState("");
  const [milestones, setMilestones] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!title.trim()) return setMessage("Give the goal a title.");
    if (kind === "finite" && !deadline) return setMessage("A finite goal needs a deadline.");
    let monthlyTarget: number | undefined;
    if (target.trim() !== "") {
      monthlyTarget = Number(target);
      if (!Number.isInteger(monthlyTarget) || monthlyTarget < 1) {
        return setMessage("A monthly target is a whole number, 1 or more.");
      }
    }
    setBusy(true);
    try {
      await createGoal(
        {
          title: title.trim(),
          areaId,
          kind,
          deadline: kind === "finite" ? deadline : undefined,
          monthlyTarget,
          milestones:
            kind === "finite"
              ? milestones
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(Boolean)
                  .map((t) => ({ id: crypto.randomUUID(), title: t, done: false }))
              : [],
        },
        today,
      );
      setTitle("");
      setDeadline("");
      setTarget("");
      setMilestones("");
      setMessage("");
      await onSaved();
    } catch {
      setMessage(SAVE_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="goal-form form-grid" onSubmit={(e) => void submit(e)}>
      <h2 className="form-full">New goal</h2>
      <label className="form-field form-full">
        <span className="form-label">Goal title</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
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
        <span className="form-label">Kind</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as "finite" | "practice")}>
          <option value="finite">Finite</option>
          <option value="practice">Practice</option>
        </select>
      </label>
      {kind === "finite" && (
        <label className="form-field">
          <span className="form-label">Deadline</span>
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        </label>
      )}
      <label className="form-field">
        <span className="form-label">Monthly target</span>
        <input type="number" min={1} step={1} value={target} onChange={(e) => setTarget(e.target.value)} />
      </label>
      {kind === "finite" && (
        <label className="form-field form-full">
          <span className="form-label">Milestones</span>
          <textarea value={milestones} placeholder="One per line" onChange={(e) => setMilestones(e.target.value)} />
        </label>
      )}
      {message && <p role="alert" className="form-full">{message}</p>}
      <div className="form-actions form-full">
        <button type="submit" disabled={busy}>
          Add goal
        </button>
      </div>
    </form>
  );
}
