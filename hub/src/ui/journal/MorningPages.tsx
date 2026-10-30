import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addMorningPhoto, CANT_OPEN, finishMorningPage, listMorningDays, morningOpensOn, openJournalPhoto, readMorningText,
  saveMorningDraft, type MorningDay, type MorningText,
} from "../../data/repo";
import { monthGrid, shiftMonth, streakLine } from "../../journal/calendar";
import { countWords, MORNING_WORDS } from "../../journal/entries";
import type { ISODate } from "../../domain/types";
import { downscalePicture, PICTURE_UNREADABLE } from "../picture";
import { ProgressBar } from "../ProgressBar";
import { AUTOSAVE_MS } from "../useDraft";
import { DoneBox, JournalHead, longDate, monthLabel, Star } from "./bits";
import { useDbChanges } from "./useJournalKey";

/** The rules in our own words (journal brief §1's line; no quotation from the book). */
export const MORNING_RULES =
  "Three pages, longhand if you can, first thing in the morning. Don't edit, don't reread, just keep the pen moving.";
const SAVE_PROBLEM = "That didn't save. Try again.";

/**
 * Morning pages (journal brief §1, VISUAL-LANGUAGE.md "Morning pages", mockup tab C): the star
 * calendar, "Write now" and "Add photo". A finished page stays hidden for 4 weeks, then
 * opens read-only in "Read back".
 */
export function MorningPages({ cryptoKey, today }: { cryptoKey: CryptoKey; today: ISODate }) {
  const [days, setDays] = useState<MorningDay[] | null>(null);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [writing, setWriting] = useState(false);
  const [problem, setProblem] = useState("");
  const [adding, setAdding] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const id = ++latest.current;
    try {
      const all = await listMorningDays(cryptoKey);
      if (id === latest.current) setDays(all);
    } catch {
      if (id === latest.current) setDays([]);
    }
  }, [cryptoKey]);
  useEffect(() => void load(), [load]);
  useDbChanges(() => void load());

  const done = useMemo(() => new Set((days ?? []).filter((d) => d.done).map((d) => d.date)), [days]);
  const todayDay = days?.find((d) => d.date === today);
  const unreadableToday = todayDay?.state === "unreadable";
  const streak = streakLine(done, today);

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setProblem("");
    setAdding(true);
    try {
      const picture = await downscalePicture(file);
      await addMorningPhoto(cryptoKey, today, picture);
      await load();
    } catch (err) {
      setProblem(err instanceof Error && err.message === PICTURE_UNREADABLE ? PICTURE_UNREADABLE : SAVE_PROBLEM);
    } finally {
      setAdding(false);
    }
  }

  if (days === null) return <section className="journal-card" aria-labelledby="morning-pages" id="morning-pages-section" />;

  return (
    <section className="journal-card" aria-labelledby="morning-pages" id="morning-pages-section">
      <JournalHead id="morning-pages" title="Morning pages" sub={longDate(today)} />
      {writing ? (
        <WritingView
          cryptoKey={cryptoKey}
          today={today}
          initialDraft={todayDay?.draft ?? ""}
          onClose={() => {
            setWriting(false);
            void load();
          }}
        />
      ) : (
        <>
          <p className="journal-rules">{MORNING_RULES}</p>
          <div className="journal-month-row">
            <button type="button" className="btn-secondary journal-month-step" aria-label="Previous month" onClick={() => setMonth((m) => shiftMonth(m, -1))}>
              ‹
            </button>
            <b aria-live="polite">{monthLabel(month, today)}</b>
            <button type="button" className="btn-secondary journal-month-step" aria-label="Next month" onClick={() => setMonth((m) => shiftMonth(m, 1))}>
              ›
            </button>
          </div>
          <StarCalendar month={month} done={done} today={today} />
          {streak && !todayDay?.done && (
            <p className="journal-muted journal-streak">
              <Star /> {streak}
            </p>
          )}
          {unreadableToday ? (
            <p role="alert">{CANT_OPEN}</p>
          ) : (
            <>
              {todayDay?.done && <DoneBox title="Done for today" line={streak} star />}
              {todayDay && todayDay.photos.length > 0 && (
                <ul className="journal-photos" aria-label="Today's photos">
                  {todayDay.photos.map((id) => (
                    <li key={id}>
                      <ProofPhoto cryptoKey={cryptoKey} id={id} />
                    </li>
                  ))}
                </ul>
              )}
              <div className="btn-group">
                <button type="button" onClick={() => setWriting(true)}>
                  Write now
                </button>
                <button type="button" className="btn-secondary" disabled={adding} onClick={() => fileInput.current?.click()}>
                  Add photo
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
              </div>
            </>
          )}
          {problem && <p role="alert">{problem}</p>}
          <ReadBack cryptoKey={cryptoKey} days={days} today={today} />
        </>
      )}
    </section>
  );
}

const WEEKDAY_HEADS = ["M", "T", "W", "T", "F", "S", "S"];

/** The month, Monday first: a star on each day with a morning page, today outlined. */
function StarCalendar({ month, done, today }: { month: string; done: ReadonlySet<ISODate>; today: ISODate }) {
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
            {on ? "" : c.day}
          </div>
        );
      })}
    </div>
  );
}

/** A proof photo: blurred until "Show" (photos may be looked at; typed pages may not). */
function ProofPhoto({ cryptoKey, id }: { cryptoKey: CryptoKey; id: string }) {
  const [state, setState] = useState<"loading" | "missing" | "unreadable" | "ok">("loading");
  const [url, setUrl] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    void openJournalPhoto(cryptoKey, id).then((r) => {
      if (!alive) return;
      if (r.state === "ok") {
        made = URL.createObjectURL(r.blob);
        setUrl(made);
      }
      setState(r.state);
    });
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [cryptoKey, id]);
  if (state === "loading") return null;
  if (state === "missing") return <div className="journal-photo-missing" aria-label="Photo not on this device yet" role="img" />;
  if (state === "unreadable") return <p>{CANT_OPEN}</p>;
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
 * Write now: one big plain box, "N of 750 words" with the progress bar, "I'm done". The draft
 * saves itself (sealed) after a pause in typing and when the view closes; "I'm done" adds the
 * page to the day, hidden for 4 weeks.
 */
function WritingView({
  cryptoKey, today, initialDraft, onClose,
}: { cryptoKey: CryptoKey; today: ISODate; initialDraft: string; onClose: () => void }) {
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
    void enqueue(() => saveMorningDraft(cryptoKey, today, draft)).catch(() => {
      if (saved.current === draft) saved.current = "\u0000unsaved";
      setProblem(SAVE_PROBLEM);
    });
  }, [cryptoKey, today, enqueue]);

  // Leaving mid-way (Back, another page, closing the app's view) keeps the draft.
  useEffect(() => () => saveDraft(), [saveDraft]);

  function onChange(value: string) {
    latest.current = value;
    setText(value);
    setProblem("");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(saveDraft, AUTOSAVE_MS);
  }

  async function done() {
    if (busy) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setBusy(true);
    const page = latest.current;
    try {
      await enqueue(() => finishMorningPage(cryptoKey, today, page));
      finished.current = true;
      latest.current = "";
      saved.current = "";
      setText("");
      onClose();
    } catch {
      setProblem(SAVE_PROBLEM);
      setBusy(false);
    }
  }

  const words = countWords(text);
  return (
    <div className="journal-writing">
      <textarea
        className="journal-page-box"
        aria-label="Today's morning page"
        placeholder="Just write. No topic, no editing."
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={saveDraft}
        autoFocus
      />
      <div>
        <p className="journal-muted journal-words">{`${words} of ${MORNING_WORDS} words`}</p>
        <ProgressBar ratio={words / MORNING_WORDS} label={`${words} of ${MORNING_WORDS} words`} />
      </div>
      {problem && <p role="alert">{problem}</p>}
      <div className="btn-group">
        <button type="button" disabled={busy || words === 0} onClick={() => void done()}>
          I'm done
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            saveDraft();
            onClose();
          }}
        >
          Back
        </button>
      </div>
    </div>
  );
}

/**
 * Read back: every day with finished typed pages, newest first. Younger than 4 weeks: "Opens
 * on <date>" and nothing else (the entry is not decrypted). Older: opens read-only.
 */
function ReadBack({ cryptoKey, days, today }: { cryptoKey: CryptoKey; days: MorningDay[]; today: ISODate }) {
  const written = days.filter((d) => d.state === "ok" && d.pages > 0).sort((a, b) => b.date.localeCompare(a.date));
  if (written.length === 0) return null;
  return (
    <details className="journal-fold">
      <summary>Read back</summary>
      <ul className="journal-past">
        {written.map((d) => {
          const opensOn = morningOpensOn(d.date);
          return (
            <li key={d.date}>
              {today < opensOn ? (
                <p className="journal-readback-locked">
                  <b>{longDate(d.date)}</b>{" "}
                  <span className="journal-muted">{`Opens on ${longDate(opensOn)}`}</span>
                </p>
              ) : (
                <OpenPage cryptoKey={cryptoKey} date={d.date} today={today} />
              )}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** One readable day: decrypted only when she opens it. */
function OpenPage({ cryptoKey, date, today }: { cryptoKey: CryptoKey; date: ISODate; today: ISODate }) {
  const [text, setText] = useState<MorningText | null>(null);
  return (
    <details
      onToggle={(e) => {
        if ((e.currentTarget as HTMLDetailsElement).open && !text) {
          void readMorningText(cryptoKey, date, today).then(setText, () => setText({ state: "unreadable" }));
        }
      }}
    >
      <summary>{longDate(date)}</summary>
      {text?.state === "ok" && <p className="journal-readback-text">{text.text}</p>}
      {text?.state === "unreadable" && <p>{CANT_OPEN}</p>}
    </details>
  );
}
