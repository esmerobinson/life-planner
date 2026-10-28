import { useState } from "react";
import { itemToGoal, updateItem } from "../data/repo";
import type { AreaId, ISODate, Item, Priority } from "../domain/types";
import { AREA_CHOICES } from "./areas";
import { SAVE_ERROR } from "./messages";

const FILE_AREAS = AREA_CHOICES.filter((a) => a.id !== "inbox");

/** The reason line for an item that needs a decision: `check` tag plus a first notes line "Check: ...". */
function checkReason(item: Item): string | null {
  if (!item.tags?.includes("check")) return null;
  const first = (item.notes ?? "").split(/\r?\n/)[0].trim();
  return /^check:/i.test(first) ? first : null;
}

export function InboxRow({
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

  /** Runs one write, shows the calm message on failure, refreshes on success. Returns whether it worked. */
  async function run(write: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false;
    setMessage("");
    setBusy(true);
    try {
      await write();
    } catch {
      setMessage(SAVE_ERROR);
      setBusy(false);
      return false;
    }
    setBusy(false);
    await onFiled();
    return true;
  }

  async function file() {
    if (!areaId) {
      setMessage("Choose an area first.");
      return;
    }
    // An idea never keeps a due date.
    const keepDue = item.kind === "idea" ? undefined : due || undefined;
    await run(() => updateItem(item.id, { areaId, goalId: goalId || undefined, priority, due: keepDue }, today));
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
    ).then((ok) => {
      if (ok && kind === "idea") setDue("");
    });
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
          {item.kind !== "idea" && (
            <label className="form-field">
              <span className="form-label">Due</span>
              <input
                type="date"
                aria-label={`Due for ${item.title}`}
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
          )}
          <button type="button" aria-label={`File ${item.title}`} disabled={busy} onClick={() => void file()}>
            File it
          </button>
        </div>
      </details>
      {message && <span className="form-message">{message}</span>}
    </li>
  );
}

