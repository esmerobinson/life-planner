import { useState } from "react";
import { shortDate } from "../domain/display";
import type { ISODate, Item } from "../domain/types";
import { StripTitle, useOpenOnBodyClick } from "./TaskRow";

/** A done item as a strip: ticked box (untick brings it back), struck-through title, done date. */
export function DoneStrip({ item: it, today, onUndo }: { item: Item; today: ISODate; onUndo: (id: string) => void }) {
  const openOnClick = useOpenOnBodyClick(it.id);
  return (
    <li className="strip crossed">
      <input type="checkbox" className="tick" aria-label={`Done: ${it.title}`} checked onChange={() => onUndo(it.id)} />
      <div className={openOnClick ? "strip-body openable" : "strip-body"} onClick={openOnClick}>
        <StripTitle item={it} />
      </div>
      <span className="strip-meta">{it.completedAt ? shortDate(it.completedAt, today) : ""}</span>
    </li>
  );
}

/** How many done items the fold-out lists before "Show all". */
export const DONE_CAP = 50;

/**
 * The done fold-out (4A): closed by default, "Done (N)", done items as strips with a
 * ticked box, newest first, each with its done date. Unticking brings one back.
 */
export function DoneSection({
  items,
  today,
  onUndo,
}: {
  items: Item[];
  today: ISODate;
  onUndo: (id: string) => void;
}) {
  const [all, setAll] = useState(false);
  const done = items
    .filter((i) => i.status === "done")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const shown = all ? done : done.slice(0, DONE_CAP);
  return (
    <details className="done-fold">
      <summary>{`Done (${done.length})`}</summary>
      {done.length === 0 ? (
        <p>Nothing done yet.</p>
      ) : (
        <>
          <ul aria-label="Done" className="strip-list">
            {shown.map((it) => (
              <DoneStrip key={it.id} item={it} today={today} onUndo={onUndo} />
            ))}
          </ul>
          {shown.length < done.length && (
            <p>
              <button type="button" className="btn-secondary" onClick={() => setAll(true)}>
                Show all
              </button>
            </p>
          )}
          <p className="done-note">Untick to bring one back.</p>
        </>
      )}
    </details>
  );
}
