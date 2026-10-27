import { useEffect, useMemo, useState } from "react";
import { tickItem } from "../data/repo";
import { pickToday } from "../domain/triage";
import { monthlyProgress } from "../domain/progress";
import type { Goal, ISODate, Item } from "../domain/types";
import { CelebrationPlaceholder } from "./CelebrationPlaceholder";
import { MoveToMenu } from "./MoveToMenu";
import { useHubData } from "./useHubData";

/** Completions this month per goal id, as pickToday expects. */
function thisMonthDoneFor(goals: Goal[], items: Item[], today: ISODate): Record<string, number> {
  return Object.fromEntries(goals.map((g) => [g.id, monthlyProgress(g, items, today)?.done ?? 0]));
}

const CELEBRATION_MS = 1500; // invented placeholder duration, to be replaced by Esme's timing

export function TodayPanel({ today }: { today: ISODate }) {
  const { items, goals, refresh, loaded } = useHubData(today);
  const [celebrating, setCelebrating] = useState(false);

  useEffect(() => {
    if (!celebrating) return;
    const t = setTimeout(() => setCelebrating(false), CELEBRATION_MS);
    return () => clearTimeout(t);
  }, [celebrating]);

  const { rhythm, picks, alsoDue } = useMemo(
    () => pickToday(items, goals, today, thisMonthDoneFor(goals, items, today)),
    [items, goals, today],
  );

  async function tick(id: string) {
    await tickItem(id, today);
    setCelebrating(true);
    await refresh();
  }

  function row(it: Item) {
    const overdue = it.due !== undefined && it.due < today;
    return (
      <li key={it.id} className="today-row">
        <button type="button" aria-label={`Done: ${it.title}`} onClick={() => void tick(it.id)}>
          Done
        </button>
        <span className="today-title">{it.title}</span>
        {overdue && (
          <span
            className="overdue-sticker"
          >
            OVERDUE
          </span>
        )}
        <MoveToMenu itemId={it.id} today={today} onMoved={refresh} label={it.title} />
      </li>
    );
  }

  const empty = loaded && rhythm.length + picks.length + alsoDue.length === 0;

  return (
    <section className="today-panel">
      <h1>Today</h1>
      {celebrating && <CelebrationPlaceholder />}
      {empty && <p>Nothing planned for today.</p>}
      {rhythm.length > 0 && (
        <ul aria-label="Rhythm">{rhythm.map(row)}</ul>
      )}
      {picks.length > 0 && <ul aria-label="Today">{picks.map(row)}</ul>}
      {alsoDue.length > 0 && (
        <details>
          <summary>Also due</summary>
          <ul aria-label="Also due">{alsoDue.map(row)}</ul>
        </details>
      )}
    </section>
  );
}
