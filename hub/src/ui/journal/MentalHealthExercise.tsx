import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  CANT_OPEN, CARDS_TOO_BIG, importExerciseCards, listExerciseEntries, readExerciseCards, readExerciseProgress,
  recordExerciseShown, setExerciseStar, type CardsState, type ExerciseProgress, type ExerciseResponse,
} from "../../data/repo";
import { addDays } from "../../domain/dates";
import type { JournalKey } from "../../journal/crypto";
import {
  chapterLine, INVALID_CARD_FILE, moreParagraphs, parseCardFile, planExercise, replacingRestarts,
  type CardSet, type ExerciseCard,
} from "../../journal/exercise";
import type { ISODate } from "../../domain/types";
import { exerciseDoneDays, rowStatus, type RowStatus } from "../../journal/rows";
import { Streak } from "../Streak";
import { LoadLine, longDate, PromptText, useLoadGuard } from "./bits";
import { CardExample, ExerciseResponseBox } from "./ExerciseResponseBox";
import { ChapterMap, WorkbookBars } from "./WorkbookProgress";
import { workbooks } from "../../journal/workbooks";
import { ResponseView } from "./ResponseView";
import { useDbChanges } from "./useJournalKey";

export const REPLACE_QUESTION = "Replace your exercise cards?";
/** Said with the question only when progress would be lost (a done card's id isn't in the new file). */
export const RESTARTS_LINE = "Replacing your cards restarts your exercise progress.";
/** While the card set's chunks are still arriving from another device. */
export const CARDS_SYNCING = "Your cards are still syncing…";
/** Beside Submit on today's card (the approved mockup). */
export const SUBMIT_TICKS = "Submitting ticks today's exercise.";
export const NEXT_ONE = "Do the next one →";
/** Above the next card once one is submitted. */
export const savedLine = (card: ExerciseCard) =>
  `${card.day !== null && !card.optional ? `Day ${card.day}` : "That card"} saved. Here's the next one if you'd like to keep going.`;
/** When the card just submitted was the last one not done. */
export const ALL_DONE_LINE = "That's every card for now. Lovely work.";
export const SEE_WHAT_YOU_WROTE = "See what you wrote";
const SAVE_PROBLEM = "That didn't save. Try again.";
/** Over a card's own responses (a card opened from the chapter map). */
export const YOUR_RESPONSES = "Your responses";
/** The one control for every card (Esme, 2026-11-04: not a long list on the tab). */
export const SEE_ALL_CHAPTERS = "See all chapters";
/** How many past exercises the tab lists before "See all" (Read back). */
const PAST_ON_TAB = 3;
const READ_PROBLEM = "The exercise cards couldn't be read. Try again.";
/** Each book's title by track id (a set with one untitled book: none shown). */
const TrackTitles = createContext<ReadonlyMap<string, string>>(new Map());

/** A card file bigger than this isn't read at all (the real set is about 90 KB). */
const MAX_FILE_BYTES = 16 * 1024 * 1024;

/**
 * Mental health exercise (exercise brief; Journal v2 tab): one learn + try card a day. The
 * cards are her private study notes, imported from a file and stored sealed with the journal
 * key (never in the app itself). Today's card is the lowest one not yet done this round; once
 * shown it stays today's card all day, done or not. Submit is the only way to finish a card.
 * After it, the card is replaced in place by the next one not yet done (never stacked below),
 * with a short line above it; "Do the next one →" does the same without submitting. One card is
 * on the page at a time, and what she wrote stays reachable under Read back and "See all chapters" (the chapter map pop-up).
 */
export function MentalHealthExercise({ jk, today, deviceId }: { jk: JournalKey; today: ISODate; deviceId: string }) {
  const [cards, setCards] = useState<CardsState | null>(null);
  const [progress, setProgress] = useState<ExerciseProgress | null>(null);
  // Every response (today's too), newest first: Past exercises and each card in the chapter map.
  const [responses, setResponses] = useState<ExerciseResponse[]>([]);
  const [problem, setProblem] = useState("");
  const [asking, setAsking] = useState<CardSet | null>(null);
  // The one card on the page: null is today's card. "Do the next one" and Submit replace it in
  // place; `trail` is the cards left behind unsubmitted (the Back link returns to the last).
  const [shownId, setShownId] = useState<string | null>(null);
  const [trail, setTrail] = useState<string[]>([]);
  // Just submitted: waiting for the saved state to be read back, then the line above the next card.
  const [waiting, setWaiting] = useState<string | null>(null);
  const [saved, setSaved] = useState<ExerciseCard | null>(null);
  // The chapter map pop-up, open on this book (and perhaps straight on one card; null: closed).
  const [mapOf, setMapOf] = useState<{ book: string; card: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const scrollUp = useRef(false);
  const latest = useRef(0);
  const guardFail = useRef<() => void>(() => undefined);
  const loaded = useRef(false);
  const recorded = useRef<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const id = ++latest.current;
    try {
      const [c, p, all] = await Promise.all([readExerciseCards(jk), readExerciseProgress(jk), listExerciseEntries(jk, addDays(today, 1))]);
      if (id !== latest.current) return;
      loaded.current = true;
      setCards(c);
      setProgress(p);
      setResponses(all.entries);
    } catch {
      if (id !== latest.current) return;
      if (loaded.current) setProblem(READ_PROBLEM);
      else guardFail.current(); // nothing read yet: the can't-open line and Try again
    }
  }, [jk, today]);
  useEffect(() => void load(), [load]);
  useDbChanges(() => void load());
  useEffect(() => {
    setShownId(null);
    setTrail([]);
    setWaiting(null);
    setSaved(null);
  }, [today]);
  // Never blank: "Loading…", then the can't-open line and Try again.
  const guard = useLoadGuard(cards === null, load);
  guardFail.current = guard.fail;

  const set = cards?.state === "ok" ? cards.set : null;
  const plan = useMemo(
    () => (set && progress ? planExercise(set.cards, progress.marks, progress.starred, today, deviceId) : null),
    [set, progress, today, deviceId],
  );

  // The first look at today's card on this device records it, so it stays today's card all day.
  useEffect(() => {
    if (!plan?.record) return;
    const key = `${today}|${plan.today.card.id}`;
    if (recorded.current === key) return;
    recorded.current = key;
    void recordExerciseShown(jk, today, deviceId, plan.today.card.id).catch(() => undefined);
  }, [plan, jk, today, deviceId]);

  useEffect(() => {
    if (asking) cancelRef.current?.focus();
  }, [asking]);

  async function attempt(fn: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    try {
      await fn();
      setProblem("");
      await load();
      return true;
    } catch (err) {
      setProblem(err instanceof Error && err.message === CARDS_TOO_BIG ? CARDS_TOO_BIG : SAVE_PROBLEM);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function chosen(file: File) {
    setProblem("");
    setAsking(null);
    const next = await readCardFile(file);
    if (!next) return setProblem(INVALID_CARD_FILE);
    if (cards?.state === "none") await attempt(() => importExerciseCards(jk, next, today));
    else setAsking(next); // replacing what is there: ask first
  }

  const star = (id: string, on: boolean) => void attempt(() => setExerciseStar(jk, today, deviceId, id, on));
  const starred = progress?.starred ?? new Set<string>();
  const row = useMemo(() => rowStatus(exerciseDoneDays(progress?.marks ?? []), today), [progress, today]);
  const byId = new Map((set?.cards ?? []).map((c) => [c.id, c]));
  // Never a finished card (2026-11-04: "I'm still seeing day 1 and have to scroll down to day
  // 2"): the card chosen, else today's, else the next not done today. None left: all done.
  const shown = plan
    ? ([shownId ? byId.get(shownId) : undefined, plan.today.card, ...plan.queue].find((c) => c && !plan.doneToday.has(c.id)) ?? null)
    : null;
  const finished = !!plan && !shown;
  const isToday = !!plan && shown?.id === plan.today.card.id;
  // Opened (or reloaded) after today's card was submitted: the line names the last card done today.
  const savedCard =
    saved ??
    (plan && shownId === null && plan.today.done
      ? (byId.get(
          responses
            .filter((e) => e.date === today && e.submitted && plan.doneToday.has(e.id))
            .reduce<ExerciseResponse | null>((a, e) => (!a || e.at > a.at ? e : a), null)?.id ?? "",
        ) ?? plan.today.card)
      : null);
  // Not done today, not on the page, not left behind unsubmitted.
  const upcoming = plan?.queue.filter((c) => c.id !== shown?.id && !plan.doneToday.has(c.id)) ?? [];
  const next = upcoming.find((c) => !trail.includes(c.id)) ?? null;
  const back = trail.length > 0 ? byId.get(trail[trail.length - 1]!) ?? null : null;

  // Once a submit is read back as done, the card gives way to the next one not done (or a gentle line).
  useEffect(() => {
    if (!waiting || !plan || !plan.doneToday.has(waiting)) return;
    const after = plan.queue.find((c) => c.id !== waiting && !plan.doneToday.has(c.id)) ?? null;
    setWaiting(null);
    setSaved(byId.get(waiting) ?? null);
    setShownId(after?.id ?? null);
    setTrail((t) => t.filter((id) => !plan.doneToday.has(id)));
    scrollUp.current = true;
  });
  // The tab goes back to the top of the new card.
  useEffect(() => {
    if (!scrollUp.current) return;
    scrollUp.current = false;
    stage.current?.scrollIntoView?.({ block: "start" });
  }, [shownId, finished]);

  function goNext() {
    if (!next || !shown) return;
    setTrail((t) => [...t, shown.id]);
    setShownId(next.id);
    setSaved(null);
    scrollUp.current = true;
  }
  function goBack() {
    if (!back) return;
    setTrail((t) => t.slice(0, -1));
    setShownId(back.id);
    setSaved(null);
    scrollUp.current = true;
  }
  const nextButton = next && (
    <button type="button" className="btn-secondary exercise-next" disabled={busy} onClick={goNext}>
      {NEXT_ONE}
    </button>
  );
  const books = useMemo(() => (set && plan ? workbooks(set, plan) : []), [set, plan]);
  const restarts = asking && progress ? replacingRestarts(progress.marks, asking) : false;
  const titles = useMemo(() => new Map((set?.tracks ?? []).filter((t) => t.title).map((t) => [t.id, t.title])), [set]);

  return (
    <TrackTitles.Provider value={titles}>
      {cards === null && <LoadLine guard={guard} />}
      {cards?.state === "none" && (
        <div className="exercise-empty">
          <p>Add your exercise cards</p>
          <ImportPill busy={busy} onFile={(f) => void chosen(f)} />
        </div>
      )}
      {cards?.state === "syncing" && (
        <>
          <p className="journal-muted">{CARDS_SYNCING}</p>
          {/* Never a dead end (review M2): her file can be imported here too. */}
          <ImportPill busy={busy} onFile={(f) => void chosen(f)} />
        </>
      )}
      {cards?.state === "unreadable" && (
        <>
          <p className="journal-muted">{CANT_OPEN}</p>
          <ImportPill busy={busy} onFile={(f) => void chosen(f)} />
        </>
      )}
      {progress && progress.unreadable > 0 && set && <p className="journal-muted">{CANT_OPEN}</p>}
      {plan && (
        <>
          <WorkbookBars books={books} onOpen={(book) => setMapOf({ book, card: null })} />
          {mapOf && set && (
            <ChapterMap
              books={books}
              optional={set.cards.filter((c) => c.optional)}
              start={mapOf.book}
              startCard={mapOf.card}
              onClose={() => setMapOf(null)}
              renderCard={(c) => (
                <CardReview
                  card={c}
                  responses={responses.filter((e) => isFor(c, e))}
                  starred={starred.has(c.id)}
                  busy={busy}
                  onStar={star}
                />
              )}
            />
          )}
          <ImportPill label="Update cards" fileLabel="Exercise card file (update)" busy={busy} onFile={(f) => void chosen(f)} />
          <div ref={stage} className="exercise-stage">
            {savedCard && (
              <p className="journal-muted exercise-saved" role="status">
                {finished ? ALL_DONE_LINE : savedLine(savedCard)}{" "}
                <button type="button" className="quiet-link" onClick={() => setMapOf({ book: savedCard.track, card: savedCard.id })}>
                  {SEE_WHAT_YOU_WROTE}
                </button>
              </p>
            )}
            {finished && !savedCard && <p className="journal-muted exercise-saved">{ALL_DONE_LINE}</p>}
            {!finished && shown && (
              <article
                key={shown.id}
                className={isToday ? "exercise-card" : "exercise-card exercise-boxed"}
                aria-label={isToday ? "Today's card" : `Next card: ${shown.day !== null ? `Day ${shown.day}` : shown.theme}`}
              >
                {back && (
                  <button type="button" className="btn-secondary exercise-back" onClick={goBack}>
                    {`← Back to ${back.day !== null ? `Day ${back.day}` : back.theme}`}
                  </button>
                )}
                <CardHead card={shown} streak={row} round={plan.round} />
                <CardBody card={shown} />
                <ReadMore card={shown} />
                <ExerciseResponseBox
                  key={`${today}|${shown.id}`}
                  jk={jk}
                  today={today}
                  deviceId={deviceId}
                  card={shown}
                  todayId={plan.today.card.id}
                  onProblem={setProblem}
                  onSubmitted={() => setWaiting(shown.id)}
                  note={plan.doneToday.size === 0 ? <span className="journal-muted">{SUBMIT_TICKS}</span> : undefined}
                  after={nextButton}
                />
                {!shown.optional && (
                  <div className="exercise-actions">
                    <StarToggle on={starred.has(shown.id)} disabled={busy} onToggle={(on) => star(shown.id, on)} />
                  </div>
                )}
              </article>
            )}
          </div>
        </>
      )}
      <PastExercises past={responses.filter((e) => e.date < today)} cards={set?.cards ?? []} />
      {plan && books.length > 0 && (
        <div className="btn-group">
          <button type="button" className="btn-secondary" onClick={() => setMapOf({ book: books[0]!.id, card: null })}>
            {SEE_ALL_CHAPTERS}
          </button>
        </div>
      )}
      {asking && (
        <div className="btn-group">
          <p id="exercise-replace-q">
            {REPLACE_QUESTION}
            {restarts && (
              <>
                {" "}
                <span>{RESTARTS_LINE}</span>
              </>
            )}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void attempt(() => importExerciseCards(jk, asking, today)).then((ok) => {
                if (ok) setAsking(null);
              })
            }
          >
            Replace
          </button>
          <button ref={cancelRef} type="button" className="btn-secondary" aria-describedby="exercise-replace-q" onClick={() => setAsking(null)}>
            Cancel
          </button>
        </div>
      )}
      {problem && <p role="alert">{problem}</p>}
    </TrackTitles.Provider>
  );
}

/** A chosen file as a card set, or null (too big, unreadable or not a card file). */
async function readCardFile(file: File): Promise<CardSet | null> {
  if (file.size > MAX_FILE_BYTES) return null;
  try {
    return parseCardFile(await file.text());
  } catch {
    return null;
  }
}

/**
 * The "Import" soft pill and its file picker (JSON only). "Update cards" at the top of the
 * tab is the same pill and flow under another name (its picker is labelled apart).
 */
function ImportPill({
  busy, onFile, label = "Import", fileLabel = "Exercise card file",
}: { busy: boolean; onFile: (f: File) => void; label?: string; fileLabel?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="btn-group">
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => input.current?.click()}>
        {label}
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json"
        hidden
        aria-label={fileLabel}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </div>
  );
}

/**
 * A card's top: the "Day N" chip (Journal violet), the theme and its format chip ("Table",
 * "Tracker", …), with the streak on the right (today's card), then the small line with its book
 * and chapter ("DBT skills workbook · Chapter 1 · …"). An optional card has no day chip.
 */
function CardHead({ card, streak, round = 1 }: { card: ExerciseCard; streak?: RowStatus; round?: number }) {
  const book = useContext(TrackTitles).get(card.track) ?? "";
  const line = [book, chapterLine(card), round > 1 ? `Round ${round}` : ""].filter(Boolean).join(" · ");
  return (
    <div>
      <div className="exercise-head">
        <p className="exercise-day-line">
          {card.day !== null && !card.optional && <span className="chip exercise-day">{`Day ${card.day}`}</span>}{" "}
          <span className="exercise-theme">{card.theme}</span>
          {card.format && <span className="chip exercise-format">{card.format}</span>}
        </p>
        {streak && <Streak n={streak.streak} week={streak.week} />}
      </div>
      {line && <p className="journal-muted exercise-chapter">{line}</p>}
    </div>
  );
}

/** Learn, Try this, then the book, the skill and the session line. */
function CardBody({ card }: { card: ExerciseCard }) {
  return (
    <>
      <div>
        <h3 className="exercise-label">Learn</h3>
        <p className="exercise-text">
          <PromptText text={card.learn} />
        </p>
      </div>
      <div>
        <h3 className="exercise-label">Try this</h3>
        <p className="exercise-text">
          <PromptText text={card.try} />
        </p>
      </div>
      {(card.book || card.skill || card.session) && (
        <div className="exercise-meta">
          {card.book && <p className="journal-muted exercise-text">In your book: <PromptText text={card.book} /></p>}
          {card.skill && <p className="journal-muted exercise-text">{card.skill}</p>}
          {card.session && <p className="journal-muted">Good one to bring to a session</p>}
        </div>
      )}
    </>
  );
}

/**
 * "Read more" (Journal v2): a fold under the card opening a --row box with the card's extra
 * text, in paragraphs, and its sources as links (each opens in a new tab). Not shown when the
 * card has no "Read more" text.
 */
function ReadMore({ card }: { card: ExerciseCard }) {
  const paras = moreParagraphs(card.more);
  if (paras.length === 0) return null;
  return (
    <details className="exercise-more">
      <summary>Read more</summary>
      <div className="exercise-more-box">
        {paras.map((p, i) => (
          <p key={i}>
            <PromptText text={p} />
          </p>
        ))}
        {card.sources.length > 0 && (
          <p className="journal-muted">
            Sources:{" "}
            {card.sources.map((s, i) => (
              <span key={s.url}>
                {i > 0 && " · "}
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title}
                </a>
              </span>
            ))}
          </p>
        )}
      </div>
    </details>
  );
}

/** A response belongs to this card (a version 1 card's by its day and theme, as before). */
const isFor = (c: ExerciseCard, e: ExerciseResponse) => c.id === e.id && (!c.legacy || c.theme === e.theme);

/**
 * Past exercises (journal polish brief §2): earlier days' responses, newest first, each
 * "Day N · Theme · <date>". Opening one shows the card (from the stored set; if the set was
 * replaced and the card is gone, just the theme stored with the response) and her response.
 * These are readable any time.
 */
function PastExercises({ past, cards }: { past: ExerciseResponse[]; cards: ExerciseCard[] }) {
  if (past.length === 0) return null;
  // Short on the tab (Esme, 2026-11-04): the latest few; Read back has every one.
  return (
    <details className="journal-fold">
      <summary>Past exercises</summary>
      <ul className="journal-past" aria-label="Past exercises">
        {past.slice(0, PAST_ON_TAB).map((e) => (
          <li key={`${e.date}|${e.id}|${e.theme}`}>
            <PastExercise entry={e} card={cards.find((c) => isFor(c, e)) ?? null} />
          </li>
        ))}
      </ul>
      {past.length > PAST_ON_TAB && (
        <p>
          <Link to="/journal/read-back">
            See all
          </Link>
        </p>
      )}
    </details>
  );
}

function PastExercise({ entry, card }: { entry: ExerciseResponse; card: ExerciseCard | null }) {
  const [open, setOpen] = useState(false);
  const name = entry.day !== null ? `Day ${entry.day} · ${entry.theme}` : entry.theme;
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{`${name} · ${longDate(entry.date)}`}</summary>
      {open && (
        <div className="exercise-card exercise-boxed">
          {card && <CardBody card={card} />}
          <div>
            <h3 className="exercise-label">Your response</h3>
            <ResponseView text={entry.text} parts={entry.parts} />
            {!entry.submitted && <p className="journal-muted">Not submitted</p>}
          </div>
        </div>
      )}
    </details>
  );
}

/** A line-drawn star (filled while starred). */
function StarGlyph({ on, label }: { on: boolean; label?: string }) {
  return (
    <svg
      className="exercise-star-glyph"
      viewBox="0 0 24 24"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <path
        d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.1 6-.8z"
        fill={on ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StarToggle({ on, disabled, onToggle }: { on: boolean; disabled: boolean; onToggle: (on: boolean) => void }) {
  return (
    <button type="button" className="exercise-star" aria-pressed={on} aria-label="Star this card" disabled={disabled} onClick={() => onToggle(!on)}>
      <StarGlyph on={on} />
    </button>
  );
}

/**
 * One card to read (in the chapter map pop-up): its head, Learn and Try this, Read more, the
 * examples and the star, then her responses under it (date and answers, read-only, newest
 * first). The same content All cards showed, now opened from the pop-up.
 */
function CardReview({
  card, responses, starred, busy, onStar,
}: {
  card: ExerciseCard;
  responses: ExerciseResponse[];
  starred: boolean;
  busy: boolean;
  onStar: (id: string, on: boolean) => void;
}) {
  return (
    <div className="exercise-card exercise-boxed">
      <CardHead card={card} />
      <CardBody card={card} />
      <ReadMore card={card} />
      <CardExample card={card} />
      {!card.optional && (
        <div className="exercise-actions">
          <StarToggle on={starred} disabled={busy} onToggle={(on) => onStar(card.id, on)} />
        </div>
      )}
      {responses.length > 0 && (
        <div>
          <h3 className="exercise-label">{YOUR_RESPONSES}</h3>
          <ul className="journal-past" aria-label={YOUR_RESPONSES}>
            {responses.map((e) => (
              <li key={e.date}>
                <p>
                  <b>{longDate(e.date)}</b>
                  {!e.submitted && <span className="journal-muted"> · Not submitted</span>}
                </p>
                <ResponseView text={e.text} parts={e.parts} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
