import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CANT_OPEN, CARDS_TOO_BIG, importExerciseCards, readExerciseCards, readExerciseProgress, recordExerciseShown,
  saveExerciseMark, setExerciseStar, type CardsState, type ExerciseProgress,
} from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { INVALID_CARD_FILE, parseCardFile, planExercise, type CardSet, type ExerciseCard } from "../../journal/exercise";
import type { ISODate } from "../../domain/types";
import { JournalHead, PromptText } from "./bits";
import { useDbChanges } from "./useJournalKey";

/** Under today's card once it is ticked. */
export const DONE_LINE = "Done for today · next card tomorrow";
export const REPLACE_QUESTION = "Replace your exercise cards?";
const SAVE_PROBLEM = "That didn't save. Try again.";
const READ_PROBLEM = "The exercise cards couldn't be read. Try again.";
/** A card file bigger than this isn't read at all (the real set is about 90 KB). */
const MAX_FILE_BYTES = 16 * 1024 * 1024;

/**
 * Mental health exercise (exercise brief): one learn + try card a day, under the check-in.
 * The cards are her private study notes, imported from a file and stored sealed with the
 * journal key (never in the app itself). Today's card is the lowest one not yet done this
 * round; once shown it stays today's card all day, ticked or not.
 */
export function MentalHealthExercise({ jk, today, deviceId }: { jk: JournalKey; today: ISODate; deviceId: string }) {
  const [cards, setCards] = useState<CardsState | null>(null);
  const [progress, setProgress] = useState<ExerciseProgress | null>(null);
  const [problem, setProblem] = useState("");
  const [asking, setAsking] = useState<CardSet | null>(null);
  const [showNext, setShowNext] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ticking, setTicking] = useState<boolean | null>(null);
  const latest = useRef(0);
  const recorded = useRef<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    const id = ++latest.current;
    try {
      const [c, p] = await Promise.all([readExerciseCards(jk), readExerciseProgress(jk)]);
      if (id !== latest.current) return;
      setCards(c);
      setProgress(p);
    } catch {
      if (id === latest.current) setProblem(READ_PROBLEM);
    }
  }, [jk]);
  useEffect(() => void load(), [load]);
  useDbChanges(() => void load());

  const plan = useMemo(
    () => (cards?.state === "ok" && progress ? planExercise(cards.set.cards, progress.marks, progress.starred, today, deviceId) : null),
    [cards, progress, today, deviceId],
  );

  // The first look at today's card on this device records it, so it stays today's card all day.
  useEffect(() => {
    if (!plan?.record) return;
    const key = `${today}|${plan.today.card.day}`;
    if (recorded.current === key) return;
    recorded.current = key;
    void recordExerciseShown(jk, today, deviceId, plan.today.card.day).catch(() => undefined);
  }, [plan, jk, today, deviceId]);

  const done = plan?.today.done ?? false;
  useEffect(() => {
    if (!done) setShowNext(false);
  }, [done]);
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
    const set = await readCardFile(file);
    if (!set) return setProblem(INVALID_CARD_FILE);
    if (cards?.state === "none") await attempt(() => importExerciseCards(jk, set, today));
    else setAsking(set); // replacing what is there: ask first
  }

  const star = (day: number, on: boolean) => void attempt(() => setExerciseStar(jk, today, deviceId, day, on));
  const starred = progress?.starred ?? new Set<number>();
  const sub = plan && plan.round > 1 ? `Round ${plan.round} · 🔒 private` : "One card a day · 🔒 private";

  return (
    <section className="journal-card" aria-labelledby="mental-health-exercise" id="mental-health-exercise-section">
      <JournalHead id="mental-health-exercise" title="Mental health exercise" sub={sub} />
      {cards?.state === "none" && (
        <div className="exercise-empty">
          <p>Add your exercise cards</p>
          <ImportPill busy={busy} onFile={(f) => void chosen(f)} />
        </div>
      )}
      {cards?.state === "unreadable" && (
        <>
          <p className="journal-muted">{CANT_OPEN}</p>
          <ImportPill busy={busy} onFile={(f) => void chosen(f)} />
        </>
      )}
      {progress && progress.unreadable > 0 && cards?.state === "ok" && <p className="journal-muted">{CANT_OPEN}</p>}
      {plan && (
        <>
          <article className="exercise-card" aria-label="Today's card">
            <CardBody card={plan.today.card} />
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
                    void attempt(() => saveExerciseMark(jk, today, deviceId, plan.today.card.day, on)).finally(() => setTicking(null));
                  }}
                />
                <span>Done</span>
              </label>
              <StarToggle on={starred.has(plan.today.card.day)} disabled={busy} onToggle={(on) => star(plan.today.card.day, on)} />
            </div>
            {done && <p className="journal-muted">{DONE_LINE}</p>}
            {done && !showNext && (
              <button type="button" className="link-button exercise-next-link" onClick={() => setShowNext(true)}>
                Show the next one anyway
              </button>
            )}
          </article>
          {done && showNext && (
            <article className="exercise-card exercise-boxed" aria-label="Next card">
              <CardBody card={plan.next} />
              <div className="exercise-actions">
                <StarToggle on={starred.has(plan.next.day)} disabled={busy} onToggle={(on) => star(plan.next.day, on)} />
              </div>
            </article>
          )}
          <AllCards
            cards={cards?.state === "ok" ? cards.set.cards : []}
            done={plan.doneThisRound}
            starred={starred}
            busy={busy}
            onStar={star}
            onFile={(f) => void chosen(f)}
          />
        </>
      )}
      {asking && (
        <div className="btn-group">
          <p id="exercise-replace-q">{REPLACE_QUESTION}</p>
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
    </section>
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

/** The "Import" soft pill and its file picker (JSON only). */
function ImportPill({ busy, onFile }: { busy: boolean; onFile: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="btn-group">
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => input.current?.click()}>
        Import
      </button>
      <input
        ref={input}
        type="file"
        accept="application/json"
        hidden
        aria-label="Exercise card file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onFile(f);
        }}
      />
    </div>
  );
}

/** One card: "Day N · Theme", Learn, Try this, the book, the skill, and the session line. */
function CardBody({ card }: { card: ExerciseCard }) {
  return (
    <>
      <p className="exercise-day-line">
        <span className="chip exercise-day">{`Day ${card.day}`}</span> <span>{card.theme}</span>
      </p>
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

/** Every card (Day, Theme, done this round, starred); each opens to read. Import lives here too. */
function AllCards({
  cards, done, starred, busy, onStar, onFile,
}: {
  cards: ExerciseCard[];
  done: ReadonlySet<number>;
  starred: ReadonlySet<number>;
  busy: boolean;
  onStar: (day: number, on: boolean) => void;
  onFile: (f: File) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <details className="journal-fold" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>All cards</summary>
      {open && (
        <>
          <ul className="journal-past" aria-label="All cards">
            {cards.map((c) => (
              <li key={c.day}>
                <OneCard card={c} done={done.has(c.day)} starred={starred.has(c.day)} busy={busy} onStar={onStar} />
              </li>
            ))}
          </ul>
          <div className="exercise-reimport">
            <ImportPill busy={busy} onFile={onFile} />
          </div>
        </>
      )}
    </details>
  );
}

function OneCard({
  card, done, starred, busy, onStar,
}: { card: ExerciseCard; done: boolean; starred: boolean; busy: boolean; onStar: (day: number, on: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <details onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span>{`Day ${card.day} · ${card.theme}`}</span>
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
          <CardBody card={card} />
          <div className="exercise-actions">
            <StarToggle on={starred} disabled={busy} onToggle={(on) => onStar(card.day, on)} />
          </div>
        </div>
      )}
    </details>
  );
}
