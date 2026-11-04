import { useCallback, useEffect, useRef, useState } from "react";
import {
  answeredPrompts, CANT_OPEN, listCheckinDays, listExerciseEntries, listReadBack, morningOpensOn, readExerciseCards, readMorningPage,
  type CheckinDay, type ExerciseResponse, type MorningText,
} from "../../data/repo";
import { addDays } from "../../domain/dates";
import type { ISODate } from "../../domain/types";
import type { JournalKey } from "../../journal/crypto";
import { LoadLine, longDate, useLoadGuard } from "./bits";
import { QuestionText } from "./DailyCheckIn";
import { ResponseView } from "./ResponseView";
import { useDbChanges } from "./useJournalKey";

/** The line at the top of Read back (from the approved mockup). */
export const READ_BACK_LINE = "Your past exercise responses, check-ins and morning pages (pages open after 4 weeks), newest first.";
export const NOTHING_YET = "Nothing to read back yet.";

type Item =
  | { kind: "exercise"; date: ISODate; entry: ExerciseResponse; book: string }
  | { kind: "checkin"; date: ISODate; day: CheckinDay }
  | { kind: "page"; date: ISODate; id: string; n: number };

/** Within a day: the exercise, the check-in, then the morning pages (the mockup's order). */
const ORDER = { exercise: 0, checkin: 1, page: 2 } as const;

/**
 * Read back (Journal v2): one list, newest first, of her exercise responses, check-ins and
 * morning pages. Each opens to read. A morning page stays hidden for 4 weeks after its day
 * ("Opens on <date>", not even decrypted until then); responses and check-ins read any time.
 */
export function ReadBack({ jk, today }: { jk: JournalKey; today: ISODate }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [unreadable, setUnreadable] = useState(0);
  const latest = useRef(0);
  const guardFail = useRef<() => void>(() => undefined);

  const load = useCallback(async () => {
    const id = ++latest.current;
    try {
      const [exercises, checkins, pages, cards] = await Promise.all([
        listExerciseEntries(jk, addDays(today, 1)),
        listCheckinDays(jk),
        listReadBack(),
        readExerciseCards(jk),
      ]);
      // Each response's book (two books of cards), by card id.
      const books = new Map<string, string>();
      if (cards.state === "ok") {
        const titles = new Map(cards.set.tracks.map((t) => [t.id, t.title]));
        for (const c of cards.set.cards) if (titles.get(c.track)) books.set(c.id, titles.get(c.track)!);
      }
      if (id !== latest.current) return;
      const pageCount = new Map<ISODate, number>();
      const list: Item[] = [
        ...exercises.entries.map((entry): Item => ({ kind: "exercise", date: entry.date, entry, book: books.get(entry.id) ?? "" })),
        ...checkins
          // Only what she answered: a day of skips isn't listed (Esme, 2026-11-04).
          .filter((d) => answeredPrompts(d).length > 0)
          .map((day): Item => ({ kind: "checkin", date: day.date, day })),
        ...pages.map((p): Item => {
          const n = (pageCount.get(p.date) ?? 0) + 1;
          pageCount.set(p.date, n);
          return { kind: "page", date: p.date, id: p.id, n };
        }),
      ];
      list.sort((a, b) => b.date.localeCompare(a.date) || ORDER[a.kind] - ORDER[b.kind]);
      setItems(list);
      setUnreadable(exercises.unreadable + checkins.reduce((n, d) => n + d.unreadable, 0));
    } catch {
      if (id === latest.current) guardFail.current();
    }
  }, [jk, today]);
  useEffect(() => void load(), [load]);
  useDbChanges(() => void load());
  const guard = useLoadGuard(items === null, load);
  guardFail.current = guard.fail;

  if (items === null) return <LoadLine guard={guard} />;
  return (
    <>
      <p className="journal-muted">{READ_BACK_LINE}</p>
      {items.length === 0 && <p>{NOTHING_YET}</p>}
      {unreadable > 0 && <p className="journal-muted">{CANT_OPEN}</p>}
      {items.length > 0 && (
        <ul className="journal-past journal-read-back" aria-label="Read back">
          {items.map((it) => (
            <li key={it.kind === "page" ? it.id : `${it.kind}|${it.date}|${it.kind === "exercise" ? `${it.entry.id}|${it.entry.theme}` : ""}`}>
              <ReadBackItem jk={jk} item={it} today={today} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ReadBackItem({ jk, item, today }: { jk: JournalKey; item: Item; today: ISODate }) {
  const date = longDate(item.date);
  if (item.kind === "exercise") {
    const e = item.entry;
    const card = [item.book, e.day !== null ? `Day ${e.day}` : "", e.theme].filter(Boolean).join(" · ");
    return (
      <details>
        <summary>{`${date} · Exercise · ${card}`}</summary>
        <ResponseView text={e.text} parts={e.parts} />
        {!e.submitted && <p className="journal-muted">Not submitted</p>}
      </details>
    );
  }
  if (item.kind === "checkin") {
    return (
      <details>
        <summary>{`${date} · Check-in`}</summary>
        <ol className="journal-answers">
          {answeredPrompts(item.day).map((id) => (
            <li key={id}>
              <QuestionText id={id} />
              <p className="journal-past-answer">{item.day.answers.get(id)!.answer}</p>
            </li>
          ))}
        </ol>
      </details>
    );
  }
  const label = `${date} · Morning pages${item.n > 1 ? ` · page ${item.n}` : ""}`;
  const opensOn = morningOpensOn(item.date);
  if (today < opensOn) {
    return (
      <p className="journal-readback-locked">
        <b>{label}</b> <span className="journal-muted">{`Opens on ${longDate(opensOn)}`}</span>
      </p>
    );
  }
  return <OpenPage jk={jk} id={item.id} label={label} today={today} />;
}

/** One readable page: decrypted only when she opens it. */
function OpenPage({ jk, id, label, today }: { jk: JournalKey; id: string; label: string; today: ISODate }) {
  const [text, setText] = useState<MorningText | null>(null);
  return (
    <details
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && !text) {
          void readMorningPage(jk, id, today).then(setText, () => setText({ state: "unreadable" }));
        }
      }}
    >
      <summary>{label}</summary>
      {text?.state === "ok" && <p className="journal-readback-text">{text.text}</p>}
      {text?.state === "unreadable" && <p>{CANT_OPEN}</p>}
    </details>
  );
}
