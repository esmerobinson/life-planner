import { useContext, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { listItems, restoreItem, untickItem } from "../data/repo";
import type { ISODate, Item } from "../domain/types";
import { GOAL_AREAS } from "./areas";
import { DoneSection } from "./DoneSection";
import { GoalCard, MonthProgress } from "./GoalProgress";
import { DATA_ERROR, useSaveError } from "./messages";
import { ShellContext } from "./shellContext";
import { TaskRow, useTick } from "./TaskRow";
import { useHubData } from "./useHubData";

type View = "all" | "tasks" | "ideas" | "goals";
const FILTERS: { id: View; label: string }[] = [
  { id: "all", label: "All" },
  { id: "tasks", label: "To-dos" },
  { id: "ideas", label: "Ideas" },
  { id: "goals", label: "Goals" },
];

export function AreaPage({ today }: { today: ISODate }) {
  const { areaId } = useParams();
  const area = GOAL_AREAS.find((a) => a.id === areaId);
  const { items, goals, refresh, loaded, error } = useHubData(today);
  const { tick, celebration, message } = useTick(today, refresh);
  const { attempt, saveError } = useSaveError();
  const [view, setView] = useState<View>("all");
  const [archived, setArchived] = useState<Item[]>([]);
  const [archiveFailed, setArchiveFailed] = useState(false);
  const shell = useContext(ShellContext);

  // Archived items are not in useHubData; re-read whenever the open items change.
  const id = area?.id;
  useEffect(() => {
    if (!id) return;
    let live = true;
    listItems({ status: "archived", areaId: id }).then(
      (a) => {
        if (!live) return;
        setArchived(a);
        setArchiveFailed(false);
      },
      () => live && setArchiveFailed(true),
    );
    return () => {
      live = false;
    };
  }, [items, id]);

  if (!area) return <p>That area does not exist.</p>;
  if (error) {
    return (
      <section className="area-page">
        <h1>{area.label}</h1>
        <p>{error}</p>
      </section>
    );
  }

  /** Re-read here and tell the shell so every other page re-reads too. */
  async function changed() {
    await refresh();
    await shell?.refresh();
  }

  /** Write, then re-read everywhere. */
  async function save(fn: () => Promise<unknown>) {
    if (!(await attempt(fn))) return;
    await changed();
  }

  const mine = items.filter((i) => i.areaId === area.id && i.status === "open");
  const tasks = view === "all" || view === "tasks" ? mine.filter((i) => i.kind === "task") : [];
  const ideas = view === "all" || view === "ideas" ? mine.filter((i) => i.kind === "idea") : [];
  const areaGoals = view === "all" || view === "goals" ? goals.filter((g) => g.areaId === area.id) : [];
  const empty = loaded && tasks.length + ideas.length + areaGoals.length === 0;

  return (
    <section className="area-page">
      <h1>{area.label}</h1>
      {loaded && <MonthProgress areaId={area.id} items={items} today={today} />}
      <div role="group" aria-label="Show" className="btn-group">
        {FILTERS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={view === t.id}
            onClick={() => setView(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {celebration}
      {message}
      {saveError && <p className="form-message">{saveError}</p>}
      {empty && <p>Nothing here yet.</p>}
      {tasks.length > 0 && (
        <section>
          {view === "all" && <h2>To-dos</h2>}
          <ul aria-label="To-dos" className="strip-list">
            {tasks.map((it) => (
              <TaskRow key={it.id} item={it} today={today} onTick={(i) => void tick(i)} onMoved={changed} />
            ))}
          </ul>
        </section>
      )}
      {(view === "all" || view === "tasks") && (
        <DoneSection
          items={items.filter((i) => i.areaId === area.id)}
          today={today}
          onUndo={(itemId) => void save(() => untickItem(itemId, today))}
        />
      )}
      {ideas.length > 0 && (
        <section>
          {view === "all" && <h2>Ideas</h2>}
          <ul aria-label="Ideas" className="strip-list">
            {ideas.map((it) => (
              <TaskRow
                key={it.id}
                item={it}
                today={today}
                onMoved={changed}
                meta={it.notes ? <div className="strip-meta">{it.notes}</div> : undefined}
              />
            ))}
          </ul>
        </section>
      )}
      {areaGoals.length > 0 && (
        <section>
          {view === "all" && <h2>Goals</h2>}
          <ul aria-label="Goals" className="goal-list">
            {areaGoals.map((g) => (
              <GoalCard key={g.id} goal={g} items={items} today={today} />
            ))}
          </ul>
        </section>
      )}
      <h2>Archive</h2>
      {archiveFailed ? (
        <p>{DATA_ERROR}</p>
      ) : archived.length === 0 ? (
        <p>Nothing archived.</p>
      ) : (
        <ul aria-label="Archive" className="strip-list">
          {archived.map((it) => (
            <li key={it.id} className="strip no-tick">
              <div className="strip-body">
                <div className="strip-title">{it.title}</div>
              </div>
              <div className="strip-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  aria-label={`Restore: ${it.title}`}
                  onClick={() => void save(() => restoreItem(it.id, today))}
                >
                  Restore
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
