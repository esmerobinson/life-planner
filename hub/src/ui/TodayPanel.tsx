import { useContext, useEffect, useMemo, useState } from "react";
import { tickItem, untickItem } from "../data/repo";
import { pickToday, tickedOffToday, withTickedOff } from "../domain/triage";
import { monthlyProgress } from "../domain/progress";
import type { Goal, ISODate, Item } from "../domain/types";
import { CelebrationPlaceholder } from "./CelebrationPlaceholder";
import { useSaveError } from "./messages";
import { ShellContext } from "./shellContext";
import { TaskRow } from "./TaskRow";
import { useHubData } from "./useHubData";

/** Completions this month per goal id, as pickToday expects. */
function thisMonthDoneFor(goals: Goal[], items: Item[], today: ISODate): Record<string, number> {
  return Object.fromEntries(goals.map((g) => [g.id, monthlyProgress(g, items, today)?.done ?? 0]));
}

const CELEBRATION_MS = 1500; // invented placeholder duration, to be replaced by Esme's timing

/** `headingLevel` 2 when the panel sits under another page title (the phone Home). */
export function TodayPanel({ today, headingLevel = 1 }: { today: ISODate; headingLevel?: 1 | 2 }) {
  const Heading = headingLevel === 2 ? "h2" : "h1";
  const { items, goals, refresh, loaded, error } = useHubData(today);
  const [celebrating, setCelebrating] = useState(false);
  const { attempt, saveError } = useSaveError();
  const shell = useContext(ShellContext);

  /** Re-read locally, then tell the shell so every other useHubData consumer re-reads too. */
  async function changed() {
    await refresh();
    await shell?.refresh();
  }

  useEffect(() => {
    if (!celebrating) return;
    const t = setTimeout(() => setCelebrating(false), CELEBRATION_MS);
    return () => clearTimeout(t);
  }, [celebrating]);

  // What was ticked off today stays, crossed out, at the bottom of its list (round 3).
  const { rhythm, picks, alsoDue } = useMemo(
    () => withTickedOff(pickToday(items, goals, today, thisMonthDoneFor(goals, items, today)), items, today),
    [items, goals, today],
  );

  async function tick(id: string): Promise<boolean> {
    if (!(await attempt(() => tickItem(id, today)))) return false;
    setCelebrating(true);
    await changed();
    return true;
  }

  async function untick(id: string) {
    if (await attempt(() => untickItem(id, today))) await changed();
  }

  function row(it: Item) {
    return (
      <TaskRow
        key={it.id}
        item={it}
        today={today}
        onTick={tick}
        onUntick={untick}
        crossed={tickedOffToday(it, today)}
        onMoved={changed}
        onTodayList
      />
    );
  }

  if (error) {
    return (
      <section className="today-panel">
        <Heading>Today</Heading>
        <p>{error}</p>
      </section>
    );
  }

  const empty = loaded && rhythm.length + picks.length + alsoDue.length === 0;

  return (
    <section className="today-panel">
      <Heading>Today</Heading>
      {celebrating && <CelebrationPlaceholder />}
      {saveError && <p className="form-message">{saveError}</p>}
      {empty && <p>Nothing planned for today.</p>}
      {rhythm.length > 0 && (
        <ul aria-label="Rhythm" className="strip-list">{rhythm.map(row)}</ul>
      )}
      {picks.length > 0 && <ul aria-label="Today" className="strip-list">{picks.map(row)}</ul>}
      {alsoDue.length > 0 && (
        <details>
          <summary>Also due</summary>
          <ul aria-label="Also due" className="strip-list">{alsoDue.map(row)}</ul>
        </details>
      )}
    </section>
  );
}
