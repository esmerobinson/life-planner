import { useState } from "react";
import { updateItem } from "../data/repo";
import type { ISODate, Item, Priority } from "../domain/types";
import { DeleteButton } from "./DeleteButton";
import { SAVE_ERROR } from "./messages";
import { TaskRow } from "./TaskRow";

/** The reason line for an item that needs a decision: `check` tag plus a first notes line "Check: ...". */
function checkReason(item: Item): string | null {
  if (!item.tags?.includes("check")) return null;
  const first = (item.notes ?? "").split(/\r?\n/)[0].trim();
  return /^check:/i.test(first) ? first : null;
}

/**
 * One Inbox item as a strip. It has no type yet (sorting gives it one, in Sort one by
 * one): no tick box, no to-do or idea label. On the right: Schedule for, Move to ("Sort
 * this…", Archive, Delete) and Delete.
 *
 * TEMPORARY: "More options" keeps the goal, priority and due controls the Inbox had before
 * Sort one by one (same markup), the only place they can be set on an existing item until
 * the side panel round replaces them.
 */
export function InboxRow({
  item,
  today,
  goals,
  onFiled,
  onDelete,
  busy,
}: {
  item: Item;
  today: ISODate;
  goals: { id: string; title: string }[];
  onFiled: () => void | Promise<void>;
  onDelete: () => void;
  busy?: boolean;
}) {
  const reason = checkReason(item);
  const [goalId, setGoalId] = useState(item.goalId ?? "");
  const [priority, setPriority] = useState<Priority>(item.priority);
  const [due, setDue] = useState(item.due ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    if (saving) return;
    setMessage("");
    setSaving(true);
    try {
      await updateItem(item.id, { goalId: goalId || undefined, priority, due: due || undefined }, today);
    } catch {
      setMessage(SAVE_ERROR);
      return;
    } finally {
      setSaving(false);
    }
    await onFiled();
  }

  return (
    <TaskRow
      item={item}
      today={today}
      onMoved={onFiled}
      className="inbox-row"
      untyped
      meta={
        (item.tags?.length || reason) && (
          <div className="strip-meta">
            {item.tags?.map((t) => (
              <span key={t} className="inbox-tag">
                #{t}{" "}
              </span>
            ))}
            {reason && <p className="inbox-check">{reason}</p>}
          </div>
        )
      }
      trail={<DeleteButton label={item.title} onDelete={onDelete} disabled={busy} />}
      tray={
        <>
          <details>
            <summary>More options</summary>
            <div className="form-row">
              <label className="form-field">
                <span className="form-label">Goal</span>
                <select aria-label={`Goal for ${item.title}`} value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                  <option value="">None</option>
                  {goals.map((g) => (
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
              <label className="form-field">
                <span className="form-label">Due</span>
                <input type="date" aria-label={`Due for ${item.title}`} value={due} onChange={(e) => setDue(e.target.value)} />
              </label>
              <button type="button" aria-label={`Save ${item.title}`} disabled={saving} onClick={() => void save()}>
                Save
              </button>
            </div>
          </details>
          {message && <span className="form-message">{message}</span>}
        </>
      }
    />
  );
}
