import type { Item } from "../domain/types";

/** Collapsed list of done items, most recently completed first, each with Undo. */
export function DoneSection({ items, onUndo }: { items: Item[]; onUndo: (id: string) => void }) {
  const done = items
    .filter((i) => i.status === "done")
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  return (
    <details>
      <summary>Done</summary>
      {done.length === 0 ? (
        <p>Nothing done yet.</p>
      ) : (
        <ul aria-label="Done">
          {done.map((it) => (
            <li key={it.id} className="today-row">
              <span className="today-title">{it.title}</span>
              <button type="button" className="btn-secondary" aria-label={`Undo: ${it.title}`} onClick={() => onUndo(it.id)}>
                Undo
              </button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
