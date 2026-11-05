import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  answeredPrompts, CANT_OPEN, listCheckinDays, listExerciseEntries, listNotes, listReadBack, morningOpensOn, readExerciseCards, readMorningPage,
  type CheckinDay, type ExerciseResponse, type MorningText, type Note,
} from "../../data/repo";
import { addDays } from "../../domain/dates";
import type { ISODate } from "../../domain/types";
import type { JournalKey } from "../../journal/crypto";
import { LoadLine, longDate, monthLabel, useLoadGuard } from "./bits";
import { QuestionText } from "./DailyCheckIn";
import { NoteBody, ReadOnlyVersions } from "./NotesToMyself";
import { cardTitle, OtherVersions, ResponseView } from "./ResponseView";
import { READ_BACK_PARTS, tabPath, type ReadBackPart } from "./tabs";
import { useDbChanges } from "./useJournalKey";

/** The line at the top of Read back (the approved mockup, 2026-11-05 option B). */
export const READ_BACK_LINE = "Everything you've done in the Journal, saved.";
/** Inside a part with nothing in it yet. */
export const NOTHING_YET = "Nothing to read back yet.";
/** On a part's tile when it has nothing yet. */
export const TILE_EMPTY = "Nothing yet";
/** At the top of Morning pages in Read back. */
export const PAGES_LINE = "Each page opens 4 weeks after you write it.";
export const BACK_TO_READ_BACK = "← Read back";

type Page = { id: string; date: ISODate; n: number };
type Loaded = {
  exercises: { entry: ExerciseResponse; title: string }[];
  checkins: CheckinDay[];
  pages: Page[];
  notes: Note[];
  unreadable: Record<"exercise" | "check-in" | "notes", number>;
};

const isPart = (p: string | null): p is ReadBackPart => READ_BACK_PARTS.some((x) => x.id === p);

/**
 * Read back (2026-11-05, option B "Choose a part first"): four big mint tiles, one per Journal
 * part in the tabs' order, each with its count and when it was last done. Tapping one opens
 * that part's full list (`?part=…`, so "See all" links straight to it), grouped by month,
 * newest first; each entry opens to read. A morning page stays hidden for 4 weeks after its day
 * ("Opens on <date>", not even decrypted until then); everything else reads any time. Notes to
 * myself are read-only here (changed only in their own tab).
 */
export function ReadBack({ jk, today }: { jk: JournalKey; today: ISODate }) {
  const [data, setData] = useState<Loaded | null>(null);
  const [params, setParams] = useSearchParams();
  const raw = params.get("part");
  const part = isPart(raw) ? raw : null;
  const latest = useRef(0);
  const guardFail = useRef<() => void>(() => undefined);
  // Keyboard focus follows her: onto a part's heading when she opens it, back onto its tile.
  const opened = useRef<ReadBackPart | null>(null);

  const load = useCallback(async () => {
    const id = ++latest.current;
    try {
      const [exercises, checkins, pages, cards, notes] = await Promise.all([
        listExerciseEntries(jk, addDays(today, 1)),
        listCheckinDays(jk),
        listReadBack(),
        readExerciseCards(jk),
        listNotes(jk),
      ]);
      // Each response's title: its own card (by its full id), with that card's book.
      const set = cards.state === "ok" ? cards.set : null;
      const titles = new Map((set?.tracks ?? []).map((t) => [t.id, t.title]));
      const title = (e: ExerciseResponse) => {
        const c = set?.cards.find((x) => x.id === e.id && (!x.legacy || x.theme === e.theme));
        return cardTitle(e, c ? titles.get(c.track) : undefined, !!c);
      };
      if (id !== latest.current) return;
      const pageCount = new Map<ISODate, number>();
      setData({
        exercises: [...exercises.entries]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((entry) => ({ entry, title: title(entry) })),
        // Only what she answered: a day of skips isn't listed (Esme, 2026-11-04).
        checkins: checkins.filter((d) => answeredPrompts(d).length > 0).sort((a, b) => b.date.localeCompare(a.date)),
        pages: pages.map((p) => {
          const n = (pageCount.get(p.date) ?? 0) + 1;
          pageCount.set(p.date, n);
          return { id: p.id, date: p.date, n };
        }),
        notes: [...notes.notes].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt),
        unreadable: {
          exercise: exercises.unreadable,
          "check-in": checkins.reduce((n, d) => n + d.unreadable, 0),
          notes: notes.unreadable,
        },
      });
    } catch {
      if (id === latest.current) guardFail.current();
    }
  }, [jk, today]);
  useEffect(() => void load(), [load]);
  useDbChanges(() => void load());
  const guard = useLoadGuard(data === null, load);
  guardFail.current = guard.fail;

  if (data === null) return <LoadLine guard={guard} />;
  if (part) return <PartView jk={jk} today={today} part={part} data={data} focus={opened.current === part} />;
  const unreadable = data.unreadable.exercise + data.unreadable["check-in"] + data.unreadable.notes;
  return (
    <div className="journal-readback">
      <p className="journal-muted">{READ_BACK_LINE}</p>
      {unreadable > 0 && <p className="journal-muted">{CANT_OPEN}</p>}
      <div className="journal-readback-tiles">
        {READ_BACK_PARTS.map((p) => (
          <Tile
            key={p.id}
            {...tileOf(p.id, data, today)}
            title={p.title}
            refocus={opened.current === p.id}
            onOpen={() => {
              opened.current = p.id;
              setParams({ part: p.id });
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** A tile's count and its small line. */
function tileOf(part: ReadBackPart, data: Loaded, today: ISODate): { count: number; line: string } {
  const last = (dates: ISODate[]) => ({ count: dates.length, line: dates[0] ? `Last: ${longDate(dates[0])}` : TILE_EMPTY });
  if (part === "exercise") return last(data.exercises.map((x) => x.entry.date));
  if (part === "check-in") return last(data.checkins.map((d) => d.date));
  if (part === "notes") return last(data.notes.map((n) => n.date));
  const ready = data.pages.filter((p) => today >= morningOpensOn(p.date)).length;
  const later = data.pages.length - ready;
  if (data.pages.length === 0) return { count: 0, line: TILE_EMPTY };
  return { count: data.pages.length, line: `${ready} ready to read${later > 0 ? ` · ${later} opening later` : ""}` };
}

function Tile({ title, count, line, refocus, onOpen }: { title: string; count: number; line: string; refocus: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (refocus) ref.current?.focus();
  }, [refocus]);
  return (
    <button ref={ref} type="button" className="journal-readback-tile" onClick={onOpen}>
      <span className="journal-readback-tile-name">{title}</span>
      <span className="journal-readback-tile-count">{count}</span>
      <span className="journal-readback-tile-line">{line}</span>
    </button>
  );
}

/** Items newest first, in runs by month ("2026-11"), each run still newest first. */
function byMonth<T>(items: T[], date: (t: T) => ISODate): [string, T[]][] {
  const months: [string, T[]][] = [];
  for (const it of items) {
    const m = date(it).slice(0, 7);
    const run = months[months.length - 1];
    if (run && run[0] === m) run[1].push(it);
    else months.push([m, [it]]);
  }
  return months;
}

/** One part's whole list: "← Read back", its name, then its entries by month. */
function PartView({ jk, today, part, data, focus }: { jk: JournalKey; today: ISODate; part: ReadBackPart; data: Loaded; focus: boolean }) {
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focus) heading.current?.focus();
  }, [focus]);
  const title = READ_BACK_PARTS.find((p) => p.id === part)!.title;
  const unreadable = part === "morning" ? 0 : data.unreadable[part];

  const months = (() => {
    if (part === "exercise") {
      return byMonth(data.exercises, (x) => x.entry.date).map(([m, xs]) => [m, xs.map((x) => (
        <li key={`${x.entry.date}|${x.entry.id}|${x.entry.theme}`}>
          <details>
            <summary>{`${longDate(x.entry.date)} · ${x.title}`}</summary>
            <ResponseView text={x.entry.text} parts={x.entry.parts} />
            {!x.entry.submitted && <p className="journal-muted">Not submitted</p>}
            <OtherVersions others={x.entry.others} />
          </details>
        </li>
      ))] as const);
    }
    if (part === "check-in") {
      return byMonth(data.checkins, (d) => d.date).map(([m, ds]) => [m, ds.map((d) => {
        const ids = answeredPrompts(d);
        return (
          <li key={d.date}>
            <details>
              <summary>{`${longDate(d.date)} · ${ids.length} ${ids.length === 1 ? "answer" : "answers"}`}</summary>
              <ol className="journal-answers">
                {ids.map((q) => (
                  <li key={q}>
                    <QuestionText id={q} />
                    <p className="journal-past-answer">{d.answers.get(q)!.answer}</p>
                  </li>
                ))}
              </ol>
            </details>
          </li>
        );
      })] as const);
    }
    if (part === "morning") {
      return byMonth(data.pages, (p) => p.date).map(([m, ps]) => [m, ps.map((p) => (
        <li key={p.id}>
          <PageItem jk={jk} page={p} today={today} />
        </li>
      ))] as const);
    }
    return byMonth(data.notes, (n) => n.date).map(([m, ns]) => [m, ns.map((n) => (
      <li key={n.id}>
        <details>
          <summary>{`${longDate(n.date)} · ${n.thought}`}</summary>
          <NoteBody note={n} />
          <ReadOnlyVersions versions={n.others} />
        </details>
      </li>
    ))] as const);
  })();

  return (
    <section className="journal-readback journal-readback-part" aria-labelledby={id}>
      <Link to={tabPath("read-back")} className="quiet-link">
        {BACK_TO_READ_BACK}
      </Link>
      <h3 id={id} ref={heading} tabIndex={-1} className="journal-readback-title">
        {title}
      </h3>
      {part === "morning" && <p className="journal-muted">{PAGES_LINE}</p>}
      {unreadable > 0 && <p className="journal-muted">{CANT_OPEN}</p>}
      {months.length === 0 && <p>{NOTHING_YET}</p>}
      {months.map(([m, items]) => {
        const label = monthLabel(m, today);
        return (
          <div key={m} className="journal-readback-month">
            <h4 className="journal-readback-month-name">{label}</h4>
            <ul className="journal-readback-list" aria-label={label}>
              {items}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

function PageItem({ jk, page, today }: { jk: JournalKey; page: Page; today: ISODate }) {
  const label = `${longDate(page.date)}${page.n > 1 ? ` · page ${page.n}` : ""}`;
  const opensOn = morningOpensOn(page.date);
  if (today < opensOn) {
    return (
      <p className="journal-readback-locked">
        <b>{label}</b> <span className="journal-muted">{`Opens on ${longDate(opensOn)}`}</span>
      </p>
    );
  }
  return <OpenPage jk={jk} id={page.id} label={label} today={today} />;
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
