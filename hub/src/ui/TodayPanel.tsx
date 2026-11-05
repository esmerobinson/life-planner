import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { listGoals, listItems, tickItem, untickItem } from "../data/repo";
import { pickToday, tickedOffToday, withTickedOff } from "../domain/triage";
import { monthlyProgress } from "../domain/progress";
import type { Goal, ISODate, Item } from "../domain/types";
import { isActive } from "../domain/goalCounts";
import { CELEBRATION_MS, canCelebrate, centreOf, confettiBurst, starPop, textCentreOf, type Point } from "./celebrate";
import { CelebrationStatus } from "./CelebrationStatus";
import { DoneSection } from "./DoneSection";
import { useSaveError } from "./messages";
import { ShellContext } from "./shellContext";
import { TaskRow } from "./TaskRow";
import { useHubData } from "./useHubData";

/** Completions this month per goal id, as pickToday expects. */
function thisMonthDoneFor(goals: Goal[], items: Item[], today: ISODate): Record<string, number> {
  return Object.fromEntries(goals.map((g) => [g.id, monthlyProgress(g, items, today)?.done ?? 0]));
}

/**
 * Habits and started projects ticked today stay, crossed out, at the bottom of their list;
 * a to-do done today moves to the "Done today" dropdown. Inactive goals don't count (goals redesign).
 */
function todayLists(items: Item[], goals: Goal[], today: ISODate) {
  const active = goals.filter(isActive);
  return withTickedOff(pickToday(items, active, today, thisMonthDoneFor(active, items, today)), items, today);
}

/**
 * Today's list, on Home (there is no separate Today page since 2026-11-04). `lead` comes first
 * under the heading, as its own group (Home: the three Journal rows). `headingLevel` 2 when the
 * panel sits under another page title (the phone Home). The heading and everything under it
 * are two boxes (the heading and .today-body), so Home can line the list up with its goals.
 */
export function TodayPanel({
  today, headingLevel = 1, lead,
}: { today: ISODate; headingLevel?: 1 | 2; lead?: ReactNode }) {
  const Heading = headingLevel === 2 ? "h2" : "h1";
  const { items, goals, refresh, loaded, error } = useHubData(today);
  const [celebrating, setCelebrating] = useState(false);
  const { attempt, saveError } = useSaveError();
  const shell = useContext(ShellContext);
  const heading = useRef<HTMLHeadingElement>(null);

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

  const { rhythm, picks, alsoDue, doneToday } = useMemo(() => todayLists(items, goals, today), [items, goals, today]);

  /**
   * After a saved tick: confetti from the Today heading when it left nothing unticked on the
   * list (rhythm and picks; the Journal rows are not to-dos, Also due is not the list), else
   * stars from the box. Decided on a fresh read, as Today may pull in another to-do. Never
   * rejects; a failed read just gives the stars.
   */
  async function celebrateTick(at: Point | null, onList: boolean) {
    let cleared = false;
    if (onList && canCelebrate()) {
      try {
        const [i, g] = await Promise.all([listItems(), listGoals()]);
        const now = todayLists(i, g, today);
        cleared = [...now.rhythm, ...now.picks].every((x) => tickedOffToday(x, today));
      } catch {
        // stars instead
      }
    }
    if (cleared && heading.current) confettiBurst(textCentreOf(heading.current));
    else if (at) starPop(at);
  }

  async function tick(id: string, box?: Element): Promise<boolean> {
    const at = box ? centreOf(box) : null;
    const onList = [...rhythm, ...picks].some((i) => i.id === id);
    if (!(await attempt(() => tickItem(id, today)))) return false;
    setCelebrating(true);
    void celebrateTick(at, onList); // nothing waits for it
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
        <div className="today-body">
          <p>{error}</p>
        </div>
      </section>
    );
  }

  const empty = loaded && rhythm.length + picks.length + alsoDue.length === 0;

  return (
    <section className="today-panel">
      <Heading ref={heading}>Today</Heading>
      <div className="today-body">
        {lead}
        {celebrating && <CelebrationStatus />}
        {saveError && <p className="form-message">{saveError}</p>}
        {empty && <p>Nothing planned for today.</p>}
        {rhythm.length > 0 && (
          <ul aria-label="Rhythm" className="strip-list">{rhythm.map(row)}</ul>
        )}
        {picks.length > 0 && <ul aria-label="Today" className="strip-list">{picks.map(row)}</ul>}
        {doneToday.length > 0 && <DoneSection title="Done today" items={doneToday} today={today} onUndo={untick} />}
        {alsoDue.length > 0 && (
          <details>
            <summary>Also due</summary>
            <ul aria-label="Also due" className="strip-list">{alsoDue.map(row)}</ul>
          </details>
        )}
      </div>
    </section>
  );
}
