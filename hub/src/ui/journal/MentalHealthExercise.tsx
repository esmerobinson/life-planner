import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  CANT_OPEN, CARDS_TOO_BIG, importExerciseCards, listExerciseEntries, readExerciseCards, readExerciseProgress,
  recordExerciseShown, saveExerciseMark, setExerciseStar, type CardsState, type ExerciseProgress, type ExerciseResponse,
} from "../../data/repo";
import { addDays } from "../../domain/dates";
import type { JournalKey } from "../../journal/crypto";
import {
  chapterLine, INVALID_CARD_FILE, moreParagraphs, parseCardFile, planExercise, replacingRestarts, sequence, upNext,
  type CardSet, type ExerciseCard,
} from "../../journal/exercise";
import type { ISODate } from "../../domain/types";
import { exerciseDoneDays, rowStatus, type RowStatus } from "../../journal/rows";
import { Streak } from "../Streak";
import { LoadLine, longDate, PromptText, useLoadGuard } from "./bits";
import { CardExample, ExerciseResponseBox } from "./ExerciseResponseBox";
import { ResponseView } from "./ResponseView";
import { useDbChanges } from "./useJournalKey";

/** Under today's card once it is done. */
export const DONE_LINE = "Done for today · next card tomorrow";
export const REPLACE_QUESTION = "Replace your exercise cards?";
/** Said with the question only when progress would be lost (a done card's id isn't in the new file). */
export const RESTARTS_LINE = "Replacing your cards restarts your exercise progress.";
/** While the card set's chunks are still arriving from another device. */
export const CARDS_SYNCING = "Your cards are still syncing…";
/** Beside Submit on today's card (the approved mockup). */
export const SUBMIT_TICKS = "Submitting ticks today's exercise.";
export const NEXT_ONE = "Do the next one →";
const SAVE_PROBLEM = "That didn't save. Try again.";
/** In All cards, over a card's own responses. */
export const YOUR_RESPONSES = "Your responses";
const READ_PROBLEM = "The exercise cards couldn't be read. Try again.";
/** Each book's title by track id (a set with one untitled book: none shown). */
const TrackTitles = createContext<ReadonlyMap<string, string>>(new Map());

/** A card file bigger than this isn't read at all (the real set is about 90 KB). */
const MAX_FILE_BYTES = 16 * 1024 * 1024;

/**
 * Mental health exercise (exercise brief; Journal v2 tab): one learn + try card a day. The
 * cards are her private study notes, imported from a file and stored sealed with the journal
 * key (never in the app itself). Today's card is the lowest one not yet done this round; once
 * shown it stays today's card all day, done or not. "Do the next one →" opens the next card not
 * yet done, in the same sitting, with its own response box (its Submit marks it done today too).
 */
export function MentalHealthExercise({ jk, today, deviceId }: { jk: JournalKey; today: ISODate; deviceId: string }) {
  const [cards, setCards] = useState<CardsState | null>(null);
  const [progress, setProgress] = useState<ExerciseProgress | null>(null);
  // Every response (today's too), newest first: Past exercises and each card under All cards.
  const [responses, setResponses] = useState<ExerciseResponse[]>([]);
  const [problem, setProblem] = useState("");
  const [asking, setAsking] = useState<CardSet | null>(null);
  // Further cards opened with "Do the next one" in this sitting (ids, in order).
  const [opened, setOpened] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [ticking, setTicking] = useState<boolean | null>(null);
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
  useEffect(() => setOpened([]), [today]);
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
  const extras = opened.map((id) => byId.get(id)).filter((c): c is ExerciseCard => c !== undefined);
  const next = plan ? upNext(plan, new Set(opened)) : null;
  const nextButton = next && (
    <button type="button" className="btn-secondary exercise-next" disabled={busy} onClick={() => setOpened((o) => [...o, next.id])}>
      {NEXT_ONE}
    </button>
  );
  const done = plan?.today.done ?? false;
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
          <ImportPill label="Update cards" fileLabel="Exercise card file (update)" busy={busy} onFile={(f) => void chosen(f)} />
          <article className="exercise-card" aria-label="Today's card">
            <CardHead card={plan.today.card} streak={row} round={plan.round} />
            <CardBody card={plan.today.card} />
            <ReadMore card={plan.today.card} />
            <ExerciseResponseBox
              key={`${today}|${plan.today.card.id}`}
              jk={jk}
              today={today}
              deviceId={deviceId}
              card={plan.today.card}
              todayId={plan.today.card.id}
              onProblem={setProblem}
              note={<span className="journal-muted">{SUBMIT_TICKS}</span>}
              after={extras.length === 0 ? nextButton : null}
            />
            <div className="exercise-actions">
              <label className="form-check">
                <input
                  type="checkbox"
                  className="tick"
                  checked={ticking ?? done}
                  disabled={busy}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setTicking(on); // shown at once; the saved state takes over once read back
                    void attempt(() => saveExerciseMark(jk, today, deviceId, plan.today.card.id, on)).finally(() => setTicking(null));
                  }}
                />
                <span>Done</span>
              </label>
              <StarToggle on={starred.has(plan.today.card.id)} disabled={busy} onToggle={(on) => star(plan.today.card.id, on)} />
            </div>
            {done && <p className="journal-muted">{DONE_LINE}</p>}
          </article>
          {extras.map((card, i) => (
            <article key={card.id} className="exercise-card exercise-boxed" aria-label={`Next card: Day ${card.day}`}>
              <CardHead card={card} />
              <CardBody card={card} />
              <ReadMore card={card} />
              <ExerciseResponseBox
                key={`${today}|${card.id}`}
                jk={jk}
                today={today}
                deviceId={deviceId}
                card={card}
                todayId={plan.today.card.id}
                onProblem={setProblem}
                after={i === extras.length - 1 ? nextButton : null}
              />
              {plan.doneToday.has(card.id) && <p className="journal-muted">Done</p>}
            </article>
          ))}
        </>
      )}
      <PastExercises past={responses.filter((e) => e.date < today)} cards={set?.cards ?? []} />
      {plan && set && (
        <AllCards
          set={set}
          responses={responses}
          done={plan.doneThisRound}
          starred={starred}
          busy={busy}
          onStar={star}
          onFile={(f) => void chosen(f)}
        />
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
          {card.book && <p className="journal-muted exercise-text">{`In your book: ${card.book}`}</p>}
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
          <p key={i}>{p}</p>
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
  return (
    <details className="journal-fold">
      <summary>Past exercises</summary>
      <ul className="journal-past" aria-label="Past exercises">
        {past.map((e) => (
          <li key={`${e.date}|${e.id}|${e.theme}`}>
            <PastExercise entry={e} card={cards.find((c) => isFor(c, e)) ?? null} />
          </li>
        ))}
      </ul>
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
 * Every card, each opening to read: optional cards first ("Introduction (optional reading)"),
 * then the daily cards grouped by book, then chapter ("Day N · Theme", done this round,
 * starred). A card she has answered lists her responses under it (date and answers, read-only,
 * newest first). Import lives here too.
 */
function AllCards({
  set, responses, done, starred, busy, onStar, onFile,
}: {
  set: CardSet;
  responses: ExerciseResponse[];
  done: ReadonlySet<string>;
  starred: ReadonlySet<string>;
  busy: boolean;
  onStar: (id: string, on: boolean) => void;
  onFile: (f: File) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="journal-fold" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>All cards</summary>
      {open && (
        <>
          <ul className="journal-past" aria-label="All cards">
            {grouped(set).map((g) =>
              g.kind === "head" ? (
                <li key={g.key} role="presentation" className={g.book ? "exercise-group-book" : "exercise-group-chapter journal-muted"}>
                  {g.book ? <h3 className="exercise-label">{g.text}</h3> : g.text}
                </li>
              ) : (
                <li key={g.card.id}>
                  <OneCard
                    card={g.card}
                    responses={responses.filter((e) => isFor(g.card, e))}
                    done={done.has(g.card.id)}
                    starred={starred.has(g.card.id)}
                    busy={busy}
                    onStar={onStar}
                  />
                </li>
              ),
            )}
          </ul>
          <div className="exercise-reimport">
            <ImportPill busy={busy} onFile={onFile} />
          </div>
        </>
      )}
    </details>
  );
}

type Group = { kind: "head"; key: string; text: string; book: boolean } | { kind: "card"; card: ExerciseCard };

/** All cards in order with their group headings: optional ones, then each book (titled) and its chapters. */
function grouped(set: CardSet): Group[] {
  const out: Group[] = set.cards.filter((c) => c.optional).map((card) => ({ kind: "card", card }));
  const seq = sequence(set.cards);
  for (const t of set.tracks) {
    const mine = seq.filter((c) => c.track === t.id);
    if (mine.length === 0) continue;
    if (t.title) out.push({ kind: "head", key: `book|${t.id}`, text: t.title, book: true });
    let chapter: string | null = null;
    for (const card of mine) {
      const line = chapterLine(card);
      if (line && line !== chapter) out.push({ kind: "head", key: `ch|${t.id}|${card.id}`, text: line, book: false });
      chapter = line;
      out.push({ kind: "card", card });
    }
  }
  return out;
}

function OneCard({
  card, responses, done, starred, busy, onStar,
}: {
  card: ExerciseCard;
  responses: ExerciseResponse[];
  done: boolean;
  starred: boolean;
  busy: boolean;
  onStar: (id: string, on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span>{card.optional ? `${card.theme} (optional reading)` : `Day ${card.day} · ${card.theme}`}</span>
        {done && (
          <span className="exercise-mark" role="img" aria-label="done">
            {" "}✓
          </span>
        )}
        {starred && (
          <span className="exercise-mark">
            {" "}
            <StarGlyph on label="starred" />
          </span>
        )}
      </summary>
      {open && (
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
      )}
    </details>
  );
}
