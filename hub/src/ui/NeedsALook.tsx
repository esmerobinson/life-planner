import { useState } from "react";
import { updateItem } from "../data/repo";
import { needsALook } from "../domain/attention";
import type { ISODate, Item } from "../domain/types";
import { useSaveError } from "./messages";
import { TaskRow, useTick } from "./TaskRow";

type Kind = "overdue" | "dueSoon" | "stale";

/**
 * One row (compact strips, 2026-11-02): the title and due line only; its area is in the
 * side panel, and why it is here is the group heading. The tray keeps the date controls.
 */
function Row({
  item,
  today,
  onTick,
  onChanged,
}: {
  item: Item;
  today: ISODate;
  onTick: (id: string) => Promise<boolean>;
  onChanged: () => Promise<void>;
}) {
  const [due, setDue] = useState(item.due ?? "");
  const { attempt, saveError } = useSaveError();

  async function saveDate() {
    // An empty date clears the due date (undefined removes the field).
    const ok = await attempt(() => updateItem(item.id, { due: due === "" ? undefined : due }, today));
    if (ok) await onChanged();
  }

  return (
    <TaskRow
      item={item}
      today={today}
      onTick={onTick}
      onMoved={onChanged}
      tray={
        <>
          <label className="form-field">
            <span className="form-label">Change due date</span>
            <input
              type="date"
              aria-label={`Change due date for ${item.title}`}
              value={due}
              onChange={(e) => setDue(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn-secondary"
            aria-label={`Save date for ${item.title}`}
            onClick={() => void saveDate()}
          >
            Save date
          </button>
          {saveError && <span className="form-message">{saveError}</span>}
        </>
      }
    />
  );
}

const GROUPS: { kind: Kind; heading: string }[] = [
  { kind: "overdue", heading: "Overdue" },
  { kind: "dueSoon", heading: "Due soon" },
  { kind: "stale", heading: "Not looked at in a while" },
];

export function NeedsALook({
  items,
  today,
  onChanged,
}: {
  items: Item[];
  today: ISODate;
  onChanged: () => Promise<void>;
}) {
  const found = needsALook(items, today);
  const { tick, celebration, message } = useTick(today, onChanged);
  const total = found.overdue.length + found.dueSoon.length + found.stale.length;
  return (
    <div className="needs-a-look">
      {celebration}
      {message}
      {total === 0 && <p>Nothing needs a look.</p>}
      {GROUPS.map(({ kind, heading }) =>
        found[kind].length === 0 ? null : (
          <section key={kind}>
            <h3>{heading}</h3>
            <ul aria-label={heading} className="strip-list">
              {found[kind].map((it) => (
                <Row key={it.id} item={it} today={today} onTick={tick} onChanged={onChanged} />
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
