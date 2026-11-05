import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  addMorningPhoto, CANT_OPEN, finishMorningPage, latestMorningDraft, listMorningDone, openJournalPhoto, readMorningDay, saveMorningDraft,
  type MorningDay,
} from "../../data/repo";
import { monthGrid, shiftMonth } from "../../journal/calendar";
import type { JournalKey } from "../../journal/crypto";
import { countWords, MORNING_WORDS } from "../../journal/entries";
import { rowStatus } from "../../journal/rows";
import { addDays, todayISO } from "../../domain/dates";
import { dayLabel } from "../../domain/display";
import type { ISODate } from "../../domain/types";
import { CHECK_DATE_EVENT } from "../shellContext";
import { downscalePicture, PICTURE_UNREADABLE } from "../picture";
import { ProgressBar } from "../ProgressBar";
import { Streak } from "../Streak";
import { AUTOSAVE_MS, useHiddenFlush } from "../useDraft";
import { DoneBox, LoadLine, monthLabel, useLoadGuard } from "./bits";
import { useDbChanges } from "./useJournalKey";

/** The rules in our own words (journal brief §1's line; no quotation from the book). */
export const MORNING_RULES =
  "Three pages, longhand if you can, first thing in the morning. Don't edit, don't reread, just keep the pen moving.";
/** Under the word count until her 1,000 (Journal v2: a target, never a lock; no guilt). */
export const KEEP_GOING = "Keep going if you can — 1,000 is about three pages.";
const SAVE_PROBLEM = "That didn't save. Try again.";
/**
 * The box's name for an unfinished earlier page: "Yesterday's morning page", or its real day
 * ("Morning page from Tue 27 Oct") when it is older (Esme, 2026-11-05: "its real day").
 */
export const lateLabel = (date: ISODate, today: ISODate) =>
  date === addDays(today, -1) ? "Yesterday's morning page" : `Morning page from ${dayLabel(date, today)}`;

/** Over the box when yesterday's words were left unfinished (review I1: kept as yesterday's draft). */
export const YESTERDAY_SAVED = "Yesterday's unfinished page is saved.";
/** Over the box when an older page was left unfinished (bug #6: never hidden, however old). */
export const olderSaved = (label: string) => `Your unfinished page from ${label} is saved.`;
const fmt = (n: number) => n.toLocaleString("en-GB");

type Props = { jk: JournalKey; today: ISODate; deviceId: string };

/**
 * Morning pages (journal brief §1; Journal v2 tab): the big writing box straight away, "N of
 * 1,000 words" with the bar, "Add photo instead" and "I'm done" (the day counts as done when
 * she presses it, at any length), then the month calendar with today outlined and a mint day
 * for each day she did her pages. A finished page stays hidden for 4 weeks, then opens
 * read-only in the Read back tab. Entries that don't open here are noted, never in the way.
 */
export function MorningPages({ jk, today, deviceId }: Props) {
  const [done, setDone] = useState<Set<ISODate> | null>(null);
  const [day, setDay] = useState<MorningDay | null>(null);
  // This device's newest page left unfinished on an earlier day (yesterday's, or older).
  const [unfinished, setUnfinished] = useState<{ date: ISODate; text: string } | null>(null);
  // Yesterday's page opened for finishing: the day it was started (fixed, even if midnight
  // passes) and, in lateText, its words as they are typed (the box is re-made when the day
  // is re-read, and must come back with them).
  const [finishing, setFinishing] = useState<{ date: ISODate } | null>(null);
  const lateText = useRef("");
  const [month, setMonth] = useState(today.slice(0, 7));
  // Left open past 3am into a new month, the calendar moves with the box (bug #18).
  useEffect(() => setMonth(today.slice(0, 7)), [today]);
  const [problem, setProblem] = useState("");
  const [adding, setAdding] = useState(false);
  // A finished page starts a fresh box (a later page that day is a page of its own).
  const [page, setPage] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const latest = useRef(0);
  const guardFail = useRef<() => void>(() => undefined);

  const load = useCallback(async () => {
    const id = ++latest.current;
    try {
      const [d, t, y] = await Promise.all([
        listMorningDone(jk),
        readMorningDay(jk, today, deviceId),
        latestMorningDraft(jk, today, deviceId),
      ]);
      if (id !== latest.current) return;
      setDone(d);
      setDay(t);
      setUnfinished(y);
    } catch {
      if (id === latest.current) guardFail.current();
    }
  }, [jk, today, deviceId]);
  useEffect(() => void load(), [load]);
  useDbChanges(() => void load());
  // Never blank: "Loading…", then the can't-open line and Try again.
  const guard = useLoadGuard(done === null || day === null, load);
  guardFail.current = guard.fail;

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProblem("");
    setAdding(true);
    try {
      const picture = await downscalePicture(file);
      await addMorningPhoto(jk, today, picture);
      await load();
    } catch (err) {
      setProblem(err instanceof Error && err.message === PICTURE_UNREADABLE ? PICTURE_UNREADABLE : SAVE_PROBLEM);
    } finally {
      setAdding(false);
    }
  }

  // The box is today's: until today's day is read (after midnight too), it waits.
  if (done === null || day === null || day.date !== today) return <LoadLine guard={guard} />;
  const row = rowStatus(done, today);
  const streak = (row.streak > 0 || row.week.some(Boolean) || row.month > 0) && (
    <>
      <Streak n={row.streak} week={row.week} />
      {row.month > 0 && <span>{` ${row.month} this month`}</span>}
    </>
  );
  return (
    <>
      <p className="journal-rules">{MORNING_RULES}</p>
      {day.done && <DoneBox title="Done for today" line={streak || null} />}
      {day.unreadable > 0 && <p className="journal-muted">{CANT_OPEN}</p>}
      {day.photos.length > 0 && (
        <ul className="journal-photos" aria-label="Today's photos">
          {day.photos.map((id) => (
            <li key={id}>
              <ProofPhoto jk={jk} id={id} />
            </li>
          ))}
        </ul>
      )}
      {unfinished && !finishing && (
        <div className="btn-group">
          <p className="journal-muted">
            {unfinished.date === addDays(today, -1) ? YESTERDAY_SAVED : olderSaved(dayLabel(unfinished.date, today))}
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              lateText.current = unfinished.text;
              setFinishing({ date: unfinished.date });
            }}
          >
            {unfinished.date === addDays(today, -1) ? "Open yesterday's page" : "Open that page"}
          </button>
        </div>
      )}
      {finishing && (
        <>
          <p className="journal-muted">
            {finishing.date === addDays(today, -1) ? "Finishing yesterday's page" : `Finishing the page from ${dayLabel(finishing.date, today)}`}
          </p>
          <WritingView
            key={`late|${finishing.date}`}
            jk={jk}
            date={finishing.date}
            late
            deviceId={deviceId}
            initialDraft={lateText.current}
            onText={(t) => (lateText.current = t)}
            onFinished={() => {
              setFinishing(null); // back to today's own, untouched box
              void load();
            }}
            photoButton={
              <button type="button" className="btn-secondary" onClick={() => setFinishing(null)}>
                Back to today
              </button>
            }
          />
        </>
      )}
      {/* Kept mounted (just hidden) while yesterday's page is open, so nothing typed today is lost. */}
      <div hidden={finishing !== null}>
        <WritingView
          key={`${page}|${today}`}
          jk={jk}
          date={today}
          deviceId={deviceId}
          initialDraft={page === 0 ? day.draft : ""}
          onFinished={() => {
            setPage((n) => n + 1);
            void load();
          }}
          photoButton={
            <>
              <button type="button" className="btn-secondary" disabled={adding} onClick={() => fileInput.current?.click()}>
                Add photo instead
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                aria-label="Photo of today's pages"
                onChange={(e) => void onPhoto(e)}
              />
            </>
          }
        />
      </div>
      {problem && <p role="alert">{problem}</p>}
      <div className="journal-month-row">
        <button type="button" className="btn-secondary journal-month-step" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
          ‹
        </button>
        <b aria-live="polite">{monthLabel(month, today)}</b>
        <button type="button" className="btn-secondary journal-month-step" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
          ›
        </button>
      </div>
      <MonthCalendar month={month} done={done} today={today} />
      {streak && !day.done && <p className="journal-muted journal-streak">{streak}</p>}
    </>
  );
}

const WEEKDAY_HEADS = ["M", "T", "W", "T", "F", "S", "S"];

/** The month, Monday first: each day with a morning page is mint (the approved mockup), today outlined. */
function MonthCalendar({ month, done, today }: { month: string; done: ReadonlySet<ISODate>; today: ISODate }) {
  return (
    <div className="journal-cal" role="group" aria-label="Morning pages calendar">
      {WEEKDAY_HEADS.map((d, i) => (
        <div key={`h${i}`} className="journal-muted journal-cal-head" aria-hidden="true">
          {d}
        </div>
      ))}
      {monthGrid(month).map((c, i) => {
        if (c.blank) return <div key={`b${i}`} className="journal-day blank" aria-hidden="true" />;
        const on = done.has(c.date);
        const isToday = c.date === today;
        const cls = ["journal-day", on ? "on" : "", isToday ? "today" : ""].filter(Boolean).join(" ");
        return (
          <div key={c.date} className={cls} data-date={c.date} aria-label={`${c.day}${on ? ", done" : ""}${isToday ? ", today" : ""}`} role="img">
            {c.day}
          </div>
        );
      })}
    </div>
  );
}

/** A proof photo: blurred until "Show" (photos may be looked at; typed pages wait 4 weeks). */
function ProofPhoto({ jk, id }: { jk: JournalKey; id: string }) {
  const [state, setState] = useState<"loading" | "missing" | "unreadable" | "ok">("loading");
  const [url, setUrl] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    void openJournalPhoto(jk, id).then((r) => {
      if (!alive) return;
      if (r.state === "ok") {
        made = URL.createObjectURL(r.blob);
        setUrl(made);
      }
      setState(r.state);
    }, () => alive && setState("unreadable"));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [jk, id]);
  if (state === "loading") return null;
  if (state === "missing") return <div className="journal-photo-missing" aria-label="Photo not on this device yet" role="img" />;
  if (state === "unreadable") return <p className="journal-muted">{CANT_OPEN}</p>;
  return (
    <div className="journal-photo-wrap">
      <img className={shown ? "journal-photo" : "journal-photo blurred"} src={url ?? undefined} alt="Photo of a morning page" />
      <button type="button" className="btn-secondary" aria-pressed={shown} onClick={() => setShown((s) => !s)}>
        {shown ? "Hide" : "Show"}
      </button>
    </div>
  );
}

/**
 * The writing box: one big plain box, "N of 1,000 words" with the progress bar and, until
 * 1,000, a gentle line; "I'm done" works at any length (but not on an empty box). The draft
 * (this device's own row) saves itself, sealed, after a pause in typing, on blur, when the
 * box goes away and when the app goes to the background. The day is fixed when the box
 * opens; a new day opens a new, empty box (the old one keeps its words as that day's draft),
 * and "I'm done" after midnight, before the app noticed, never files the page under yesterday:
 * it saves the draft and asks the app to look at the clock (review I1).
 */
function WritingView({
  jk, date: startDate, late = false, deviceId, initialDraft, onText, onFinished, photoButton,
}: {
  jk: JournalKey;
  date: ISODate;
  /** Yesterday's unfinished page: it is filed under its own date, as if finished then. */
  late?: boolean;
  deviceId: string;
  initialDraft: string;
  /** Told the words as they change (so a box that is re-made can come back with them). */
  onText?: (text: string) => void;
  onFinished: () => void;
  photoButton: ReactNode;
}) {
  const [date] = useState(startDate); // pinned when the box opens (midnight stays on the same day)
  const [text, setText] = useState(initialDraft);
  const [problem, setProblem] = useState("");
  const [busy, setBusy] = useState(false);
  const latest = useRef(initialDraft);
  const saved = useRef(initialDraft);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Every write in order, so a draft save can never land after "I'm done".
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const finished = useRef(false);

  const enqueue = useCallback(<T,>(op: () => Promise<T>): Promise<T> => {
    const next = queue.current.then(op, op);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  const saveDraft = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const draft = latest.current;
    if (finished.current || draft === saved.current) return;
    saved.current = draft;
    void enqueue(() => saveMorningDraft(jk, date, deviceId, draft)).catch(() => {
      if (saved.current === draft) saved.current = "\u0000unsaved"; // the next save tries again
      setProblem(SAVE_PROBLEM);
    });
  }, [jk, date, deviceId, enqueue]);

  // Leaving (another tab or page) or the app going to the background keeps the draft.
  useEffect(() => () => saveDraft(), [saveDraft]);
  useHiddenFlush(saveDraft);

  function onChange(value: string) {
    latest.current = value;
    onText?.(value);
    setText(value);
    setProblem("");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(saveDraft, AUTOSAVE_MS);
  }

  async function done() {
    if (busy) return;
    // A late page (yesterday's, opened on purpose) is pinned to the day it was started: filing it
    // under that day is right whatever the clock says. Today's box is not (see the note above).
    if (!late && todayISO() !== date) {
      // Midnight passed: nothing is finished by itself. The words stay that day's draft.
      saveDraft();
      window.dispatchEvent(new Event(CHECK_DATE_EVENT));
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setBusy(true);
    const page = latest.current;
    try {
      await enqueue(() => finishMorningPage(jk, date, deviceId, page));
      finished.current = true;
      onFinished();
    } catch {
      setProblem(SAVE_PROBLEM);
      setBusy(false);
    }
  }

  const words = countWords(text);
  const count = `${fmt(words)} of ${fmt(MORNING_WORDS)} words`;
  return (
    <div className="journal-writing">
      <textarea
        className="journal-page-box"
        aria-label={late ? lateLabel(date, todayISO()) : "Today's morning page"}
        placeholder="Just write. No topic, no editing."
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={saveDraft}
      />
      <div>
        <p className="journal-muted journal-words">{count}</p>
        <ProgressBar ratio={words / MORNING_WORDS} label={count} />
        {words < MORNING_WORDS && <p className="journal-muted journal-keep-going">{KEEP_GOING}</p>}
      </div>
      {problem && <p role="alert">{problem}</p>}
      <div className="btn-group journal-write-actions">
        {photoButton}
        <button type="button" disabled={busy || words === 0} onClick={() => void done()}>
          I'm done
        </button>
      </div>
    </div>
  );
}
