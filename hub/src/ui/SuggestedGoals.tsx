import { useState } from "react";
import { addSuggestedGoal } from "../data/repo";
import { SUGGESTED_GOALS } from "../domain/suggestedGoals";
import type { Goal, ISODate } from "../domain/types";
import { NAV } from "./areas";
import { useSaveError } from "./messages";

/** Where this device remembers that the card was dismissed. */
export const SUGGESTED_DISMISSED_KEY = "esmeworld:suggested-goals-dismissed";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(SUGGESTED_DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * "Suggested goals" (goals-redesign-brief.md): at the top of the Goals page until dismissed,
 * "Add your three goals" with her three goals set up to count themselves; one tap adds each
 * (she can edit it after). Nothing is created without her tap. Gone once all three are added.
 */
export function SuggestedGoals({ goals, today, onChanged }: { goals: Goal[]; today: ISODate; onChanged: () => Promise<void> }) {
  const [dismissed, setDismissed] = useState(readDismissed);
  const { attempt, saveError } = useSaveError();
  const added = new Set(goals.map((g) => g.id));
  if (dismissed || SUGGESTED_GOALS.every((s) => added.has(s.id))) return null;
  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(SUGGESTED_DISMISSED_KEY, "1");
    } catch {
      // Blocked storage: it stays dismissed until the page reloads.
    }
  }
  return (
    <section className="suggested-goals" aria-labelledby="suggested-goals-heading">
      <div className="suggested-head">
        <div>
          <h2 id="suggested-goals-heading">Suggested goals</h2>
          <p className="goal-muted">Add your three goals</p>
        </div>
        <button type="button" className="btn-secondary" onClick={dismiss}>
          Dismiss
        </button>
      </div>
      <ul className="suggested-list">
        {SUGGESTED_GOALS.map((s) => {
          const nav = NAV.find((n) => n.id === s.areaId);
          const isAdded = added.has(s.id);
          return (
            <li key={s.id} className="suggested-item">
              <span className="suggested-band" style={{ background: nav?.tile }}>
                {nav && <img src={nav.icon} alt="" width={18} height={18} />}
                <span>{s.title}</span>
              </span>
              {isAdded ? (
                <span className="goal-muted">Added</span>
              ) : (
                <button
                  type="button"
                  aria-label={`Add ${s.title}`}
                  onClick={() =>
                    void attempt(() => addSuggestedGoal(s.id, today)).then(async (ok) => {
                      if (ok) await onChanged();
                    })
                  }
                >
                  Add
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {saveError && <p className="form-message">{saveError}</p>}
    </section>
  );
}
