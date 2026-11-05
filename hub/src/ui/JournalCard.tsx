import { useNavigate } from "react-router-dom";
import { endOfMonth } from "../domain/dates";
import { HABIT_WORDS } from "../domain/habits";
import type { ISODate } from "../domain/types";
import type { RowStatus } from "../journal/rows";
import { JournalRow, type TickState } from "./journal/JournalStrip";
import { tabPath, type JournalTabId } from "./journal/tabs";
import { useJournalRows, type JournalRowsView } from "./journal/useJournalRows";
import { ProgressBar } from "./ProgressBar";
import { Streak } from "./Streak";

/** One of the three Journal rows, as every list shows them. */
interface RowFacts {
  tab: JournalTabId;
  title: string;
  tick: TickState;
  status: RowStatus | null;
  /** The exercise's "Day N · Theme". */
  meta?: string;
}

/** The three rows, in her order (Journal v2): the mental health exercise first. */
function rowFacts(view: JournalRowsView): RowFacts[] {
  const ok = view.state === "ok" ? view : null;
  const unknown: TickState = view.state === "loading" ? "loading" : "locked";
  const tick = (s: RowStatus | undefined): TickState => (s ? (s.done ? "done" : "todo") : unknown);
  const card = ok?.exercise.card;
  return [
    {
      tab: "exercise", title: "Mental health exercise", tick: tick(ok?.exercise), status: ok?.exercise ?? null,
      meta: card ? `Day ${card.day} · ${card.theme}` : undefined,
    },
    { tab: "morning", title: "Morning pages", tick: tick(ok?.morning), status: ok?.morning ?? null },
    { tab: "check-in", title: "Daily check-in", tick: tick(ok?.checkin), status: ok?.checkin ?? null },
  ];
}

/**
 * The green rows at the top of Home's Today list (VISUAL-LANGUAGE.md "Journal rows
 * (2026-11-02)" and "Home (2026-11-04)"): the mental health exercise, Morning pages and Daily
 * check-in as mint strips exactly like task strips, daily recurring tasks. Each tick ticks
 * itself when that part is done today (never by hand); the streak is on the right. Tapping a
 * row opens that Journal tab. Locked or not set up here: the rows still show, with an empty
 * box that says it isn't available and no streaks, and open the Journal (to unlock). While
 * loading: no boxes yet, so nothing pops from unticked to ticked. No heading of their own:
 * they sit under Today's.
 */
export function JournalRows({ today }: { today: ISODate }) {
  const navigate = useNavigate();
  const rows = rowFacts(useJournalRows(today));
  return (
    <ul className="strip-list journal-rows" aria-label="Journal">
      {rows.map((r) => (
        <JournalRow
          key={r.tab}
          title={r.title}
          tick={r.tick}
          meta={r.meta}
          right={r.status && <Streak n={r.status.streak} week={r.status.week} always />}
          onOpen={() => navigate(tabPath(r.tab))}
        />
      ))}
    </ul>
  );
}

/** Days in today's month. */
const daysInMonth = (today: ISODate): number => {
  const [y, m] = today.split("-").map(Number);
  return Number(endOfMonth(y!, m!).slice(8));
};

/**
 * The same three rows inside Mind's Habits box (Journal v2), after her own Mind habits, in
 * the habit rows' format: "every day" under the title, and on the right "N of M this month"
 * over the small bar (N = days done this month, M = days in the month). Read-only ticks;
 * tapping a row opens that Journal tab. Locked or loading: no count.
 */
export function JournalHabitRows({ today }: { today: ISODate }) {
  const navigate = useNavigate();
  const rows = rowFacts(useJournalRows(today));
  const planned = daysInMonth(today);
  return (
    <>
      {rows.map((r) => {
        const text = r.status ? HABIT_WORDS.session(today, r.status.month, planned) : null;
        return (
          <JournalRow
            key={r.tab}
            title={r.title}
            tick={r.tick}
            meta={HABIT_WORDS.schedule(["mon", "tue", "wed", "thu", "fri", "sat", "sun"])}
            right={
              r.status &&
              text && (
                <>
                  {/* The same week as on Home and the Journal tabs (Esme, 2026-11-04). */}
                  <Streak n={r.status.streak} week={r.status.week} always />
                  <div className="habit-session">
                    <div className="habit-count">{text}</div>
                    <ProgressBar ratio={r.status.month / planned} label={text} />
                  </div>
                </>
              )
            }
            onOpen={() => navigate(tabPath(r.tab))}
          />
        );
      })}
    </>
  );
}
