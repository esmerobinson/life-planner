import { useNavigate } from "react-router-dom";
import type { ISODate } from "../domain/types";
import type { RowStatus } from "../journal/rows";
import { CHECKIN_HASH, EXERCISE_HASH, MORNING_HASH } from "./journal/JournalPage";
import { JournalRow, type TickState } from "./journal/JournalStrip";
import { useJournalRows } from "./journal/useJournalRows";

/**
 * The Home Journal card (desktop and phone; VISUAL-LANGUAGE.md "Journal rows (2026-11-02)"):
 * Morning pages, Daily check-in and Mental health exercise as mint strips shaped like task
 * strips. Each tick ticks itself when that part is done today (never by hand); "★ N" is the
 * streak. Tapping a row opens that Journal section. Locked or not set up here: the rows
 * still show, with an empty box that says it isn't available and no streaks, and open the
 * Journal (to unlock). While loading: no boxes yet, so nothing pops from unticked to ticked.
 */
export function JournalCard({ today }: { today: ISODate }) {
  const navigate = useNavigate();
  const view = useJournalRows(today);
  const ok = view.state === "ok" ? view : null;
  const unknown: TickState = view.state === "loading" ? "loading" : "locked";
  const props = (s: RowStatus | undefined) => (s ? { tick: (s.done ? "done" : "todo") as TickState, streak: s.streak } : { tick: unknown, streak: 0 });
  const card = ok?.exercise.card;
  return (
    <section className="journal-card-home" aria-label="Journal">
      <h2>Journal</h2>
      <ul className="strip-list journal-rows">
        <JournalRow title="Morning pages" {...props(ok?.morning)} onOpen={() => navigate(`/journal${MORNING_HASH}`)} />
        <JournalRow title="Daily check-in" {...props(ok?.checkin)} onOpen={() => navigate(`/journal${CHECKIN_HASH}`)} />
        <JournalRow
          title="Mental health exercise"
          {...props(ok?.exercise)}
          meta={card ? `Day ${card.day} · ${card.theme}` : undefined}
          onOpen={() => navigate(`/journal${EXERCISE_HASH}`)}
        />
      </ul>
    </section>
  );
}
