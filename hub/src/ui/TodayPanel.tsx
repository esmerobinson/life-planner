import { useContext, useEffect, useMemo, type ReactNode } from "react";
import { tickItem, untickItem } from "../data/repo";
import { recordTodayFill, shouldRecord } from "../data/todayFillRepo";
import { tickedOffToday, todayFill, todayList } from "../domain/triage";
import type { ISODate, Item } from "../domain/types";
import { DoneSection } from "./DoneSection";
import { useSaveError } from "./messages";
import { ShellContext } from "./shellContext";
import { TaskRow } from "./TaskRow";
import { useHubData } from "./useHubData";
import { useTodayFill } from "./useTodayFill";

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
  const { attempt, saveError } = useSaveError();
  const shell = useContext(ShellContext);

  /** Re-read locally, then tell the shell so every other useHubData consumer re-reads too. */
  async function changed() {
    await refresh();
    await shell?.refresh();
  }

  // Habits and started projects ticked today stay, crossed out, at the bottom of their list;
  // a to-do done today moves to the "Done today" dropdown.
  // Inactive goals don't count (goals redesign).
  // The day's picks are kept once shown (synced): one she removes, moves or ticks off is never
  // replaced; the list just gets shorter (Esme, 2026-11-06). The next day starts fresh.
  const kept = useTodayFill(today);
  const { rhythm, picks, alsoDue, doneToday } = useMemo(
    () => todayList(items, goals, today, kept.frozen),
    [items, goals, today, kept.frozen],
  );
  useEffect(() => {
    if (!loaded || error || !kept.loaded) return;
    const next = todayFill(items, goals, today, kept.frozen);
    if (shouldRecord(kept.frozen, next)) void recordTodayFill(today, next).catch(() => undefined);
  }, [loaded, error, kept.loaded, kept.frozen, items, goals, today]);

  async function tick(id: string, saved?: () => void): Promise<boolean> {
    if (!(await attempt(() => tickItem(id, today)))) return false;
    saved?.(); // the sparkle, on the ticked box (TaskRow)
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
      <Heading>Today</Heading>
      <div className="today-body">
        {lead}
        {saveError && <p className="form-message">{saveError}</p>}
        {empty && <p>Nothing planned for today.</p>}
        {rhythm.length > 0 && (
          <ul aria-label="Rhythm" className="strip-list">{rhythm.map(row)}</ul>
        )}
        {picks.length > 0 && <ul aria-label="Today" className="strip-list">{picks.map(row)}</ul>}
        {doneToday.length > 0 && <DoneSection title="Done today" items={doneToday} today={today} onUndo={untick} />}
        {/* Only things due in the next few days that didn't fit: anything due today or overdue is
            always on the list above (Esme, 2026-11-06). Wording provisional, for Esme / Design. */}
        {alsoDue.length > 0 && (
          <details>
            <summary>Due in the next few days</summary>
            <ul aria-label="Due in the next few days" className="strip-list">{alsoDue.map(row)}</ul>
          </details>
        )}
      </div>
    </section>
  );
}
