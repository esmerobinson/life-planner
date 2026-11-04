import { useContext } from "react";
import { HABIT_WORDS, isRepeating } from "../domain/habits";
import type { AreaId, ISODate, Item } from "../domain/types";
import { AREA_CHOICES, GOAL_AREAS_MIND_FIRST } from "./areas";
import { ShellContext } from "./shellContext";
import { StripTitle } from "./TaskRow";
import { useHubData } from "./useHubData";
import { useRepeatActions } from "./useRepeatActions";

/** Every repeating item by area: Mind first, then the sidebar's order, and the Inbox (older imports) last. */
export function repeatGroups(items: Item[]): { areaId: AreaId; label: string; items: Item[] }[] {
  const order = [...GOAL_AREAS_MIND_FIRST, ...AREA_CHOICES.filter((a) => a.id === "inbox")];
  const repeating = items.filter(isRepeating);
  return order
    .map((a) => ({
      areaId: a.id,
      label: a.label,
      items: repeating.filter((i) => i.areaId === a.id).sort((x, y) => x.title.localeCompare(y.title)),
    }))
    .filter((g) => g.items.length > 0);
}

/**
 * The Repeating page: everything that repeats, across all areas, so a repeat can be found
 * and stopped (kept as a one-off to-do) or deleted (to the Bin) without hunting for it.
 */
export function RepeatingPage({ today }: { today: ISODate }) {
  const { items, refresh, loaded, error } = useHubData(today);
  const shell = useContext(ShellContext);
  const actions = useRepeatActions(today, async () => {
    await refresh();
    await shell?.refresh();
  });
  const groups = repeatGroups(items);

  return (
    <section className="repeating-page">
      <h1>Repeating</h1>
      {error && <p>{error}</p>}
      <p>
        Everything that repeats, by area. Stop repeating keeps it as a one-off to-do in its area; Delete moves it to the Bin.
      </p>
      {actions.saveError && <p className="form-message">{actions.saveError}</p>}
      {loaded && !error && groups.length === 0 && <p>Nothing repeats.</p>}
      {groups.map((g) => (
        <section key={g.areaId}>
          <h2>{g.label}</h2>
          <ul aria-label={`Repeating in ${g.label}`} className="strip-list">
            {g.items.map((it) => (
              <li key={it.id} className="strip no-tick">
                <div className="strip-body">
                  <StripTitle item={it} />
                  <div className="strip-meta">{HABIT_WORDS.schedule(it.recur)}</div>
                </div>
                <div className="strip-actions">
                  <button type="button" className="btn-secondary" aria-label={`Stop repeating: ${it.title}`} onClick={() => void actions.stop(it)}>
                    Stop repeating
                  </button>
                  <button type="button" className="btn-secondary" aria-label={`Delete: ${it.title}`} onClick={() => void actions.remove(it)}>
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
