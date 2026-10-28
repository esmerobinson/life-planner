import { useState } from "react";
import { shortDate } from "../domain/display";
import type { ISODate, Item } from "../domain/types";

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
              <li key={it.id} className="strip">
                <input
                  type="checkbox"
                  className="tick"
                  aria-label={`Mark done: ${it.title}`}
                  checked
                  onChange={() => onUndo(it.id)}
                />
                <div className="strip-body">
                  <div className="strip-title">{it.title}</div>
                </div>
                <span className="strip-meta">{it.completedAt ? shortDate(it.completedAt, today) : ""}</span>
              </li>
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
