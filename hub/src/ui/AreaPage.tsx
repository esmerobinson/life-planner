import { useContext, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { listItems, restoreItem, untickItem } from "../data/repo";
import type { ISODate, Item } from "../domain/types";
import { GOAL_AREAS } from "./areas";
import { DoneSection } from "./DoneSection";
import { GoalCard } from "./GoalProgress";
import { DATA_ERROR, useSaveError } from "./messages";
import { MoveToMenu } from "./MoveToMenu";
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

  /** Write, then re-read here and tell the shell so every other page re-reads too. */
  async function save(fn: () => Promise<unknown>) {
    if (!(await attempt(fn))) return;
    await refresh();
    await shell?.refresh();
  }

  const mine = items.filter((i) => i.areaId === area.id && i.status === "open");
  const tasks = view === "all" || view === "tasks" ? mine.filter((i) => i.kind === "task") : [];
  const ideas = view === "all" || view === "ideas" ? mine.filter((i) => i.kind === "idea") : [];
  const areaGoals = view === "all" || view === "goals" ? goals.filter((g) => g.areaId === area.id) : [];
  const empty = loaded && tasks.length + ideas.length + areaGoals.length === 0;

  return (
    <section className="area-page">
      <h1>{area.label}</h1>
      <div role="group" aria-label="Show">
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
        <ul aria-label="To-dos">
          {tasks.map((it) => (
            <TaskRow key={it.id} item={it} today={today} onTick={(i) => void tick(i)} onMoved={refresh} />
          ))}
        </ul>
      )}
      {ideas.length > 0 && (
        <ul aria-label="Ideas">
          {ideas.map((it) => (
            <li key={it.id} className="today-row">
              <span className="today-title">{it.title}</span>
              {it.notes && <span>{it.notes}</span>}
              <MoveToMenu itemId={it.id} today={today} onMoved={refresh} label={it.title} />
            </li>
          ))}
        </ul>
      )}
      {areaGoals.length > 0 && (
        <ul aria-label="Goals" className="goal-list">
          {areaGoals.map((g) => (
            <GoalCard key={g.id} goal={g} items={items} today={today} />
          ))}
        </ul>
      )}
      {(view === "all" || view === "tasks") && (
        <DoneSection
          items={items.filter((i) => i.areaId === area.id)}
          onUndo={(itemId) => void save(() => untickItem(itemId, today))}
        />
      )}
      <h2>Archive</h2>
      {archiveFailed ? (
        <p>{DATA_ERROR}</p>
      ) : archived.length === 0 ? (
        <p>Nothing archived.</p>
      ) : (
        <ul aria-label="Archive">
          {archived.map((it) => (
            <li key={it.id} className="today-row">
              <span className="today-title">{it.title}</span>
              <button
                type="button"
                className="btn-secondary"
                aria-label={`Restore: ${it.title}`}
                onClick={() => void save(() => restoreItem(it.id, today))}
              >
                Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
