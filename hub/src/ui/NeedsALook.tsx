import { useState } from "react";
import { updateItem } from "../data/repo";
import { needsALook } from "../domain/attention";
import { daysBetween } from "../domain/dates";
import type { ISODate, Item } from "../domain/types";
import { AREA_CHOICES } from "./areas";
import { useSaveError } from "./messages";
import { TaskRow, useTick } from "./TaskRow";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

type Kind = "overdue" | "dueSoon" | "stale";

/** Why a row is here, beyond its due line: overdue and due-soon rows say it in the due line (2D). */
function reason(kind: Kind, it: Item, today: ISODate): string | null {
  if (kind !== "stale") return null;
  return `Not looked at for ${plural(daysBetween(it.touchedAt, today), "day")}. What do you want to do with this?`;
}

function Row({
  item,
  kind,
  today,
  onTick,
  onChanged,
}: {
  item: Item;
  kind: Kind;
  today: ISODate;
  onTick: (id: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [due, setDue] = useState(item.due ?? "");
  const { attempt, saveError } = useSaveError();
  const area = AREA_CHOICES.find((a) => a.id === item.areaId)?.label ?? item.areaId;

  async function saveDate() {
    // An empty date clears the due date (undefined removes the field).
    const ok = await attempt(() => updateItem(item.id, { due: due === "" ? undefined : due }, today));
    if (ok) await onChanged();
  }

  const why = reason(kind, item, today);
  return (
    <TaskRow
      item={item}
      today={today}
      onTick={onTick}
      onMoved={onChanged}
      meta={
        <div className="strip-meta">
          <span>{area}</span>
          {why && (
            <>
              {" · "}
              <span>{why}</span>
            </>
          )}
        </div>
      }
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
                <Row key={it.id} item={it} kind={kind} today={today} onTick={(id) => void tick(id)} onChanged={onChanged} />
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
