import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { listItems, restoreItem } from "../data/repo";
import type { ISODate, Item } from "../domain/types";
import { GOAL_AREAS } from "./areas";
import { GoalCard } from "./GoalProgress";
import { MoveToMenu } from "./MoveToMenu";
import { TaskRow, useTick } from "./TaskRow";
import { useHubData } from "./useHubData";

type View = "all" | "tasks" | "ideas" | "goals";
const TABS: { id: View; label: string }[] = [
  { id: "all", label: "All" },
  { id: "tasks", label: "To-dos" },
  { id: "ideas", label: "Ideas" },
  { id: "goals", label: "Goals" },
];

export function AreaPage({ today }: { today: ISODate }) {
  const { areaId } = useParams();
  const area = GOAL_AREAS.find((a) => a.id === areaId);
  const { items, goals, refresh, loaded } = useHubData(today);
  const { tick, celebration } = useTick(today, refresh);
  const [view, setView] = useState<View>("all");
  const [archived, setArchived] = useState<Item[]>([]);

  // Archived items are not in useHubData; re-read whenever the open items change.
  const id = area?.id;
  useEffect(() => {
    if (!id) return;
    let live = true;
    void listItems({ status: "archived", areaId: id }).then((a) => live && setArchived(a));
    return () => {
      live = false;
    };
  }, [items, id]);

  if (!area) return <p>That area does not exist.</p>;

  const mine = items.filter((i) => i.areaId === area.id && i.status === "open");
  const tasks = view === "all" || view === "tasks" ? mine.filter((i) => i.kind === "task") : [];
  const ideas = view === "all" || view === "ideas" ? mine.filter((i) => i.kind === "idea") : [];
  const areaGoals = view === "all" || view === "goals" ? goals.filter((g) => g.areaId === area.id) : [];
  const empty = loaded && tasks.length + ideas.length + areaGoals.length === 0;

  return (
    <section className="area-page">
      <h1>{area.label}</h1>
      <div role="tablist" aria-label="Show">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={view === t.id}
            onClick={() => setView(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {celebration}
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
      <h2>Archive</h2>
      {archived.length === 0 ? (
        <p>Nothing archived.</p>
      ) : (
        <ul aria-label="Archive">
          {archived.map((it) => (
            <li key={it.id} className="today-row">
              <span className="today-title">{it.title}</span>
              <button
                type="button"
                aria-label={`Restore: ${it.title}`}
                onClick={() => void restoreItem(it.id, today).then(refresh)}
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
