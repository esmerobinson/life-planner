import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  cardRef, readExerciseEntry, responseComplete, saveExerciseDraft, submitExerciseEntry,
  type ExerciseResponse, type PartAnswer, type ResponseValue,
} from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { emptyPart, type CardPart, type ExerciseCard, type PartValue } from "../../journal/exercise";
import type { ISODate } from "../../domain/types";
import { AUTOSAVE_MS, useHiddenFlush } from "../useDraft";
import { useDbChanges } from "./useJournalKey";

const SAVE_PROBLEM = "That didn't save. Try again.";
const RATINGS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/**
 * Her response to a card (journal polish brief §1; Journal v2). A card without parts: the
 * check-in's answer box, growing with what she writes. A card with parts: one input per part
 * (text: a box; list: `count` numbered lines with "N of M filled"; rating: 0–10; choice: pill
 * options), and Submit only once every part is filled ("if I have to complete 10, I complete
 * 10"). Under it, "See an example" and her book's own example when the card has them.
 * Autosaved as a draft after a pause, on blur, when the app is hidden or the page left (a
 * draft never marks Done). Submit saves it and marks that card done today; "Saved" shows while
 * it holds what was submitted, and editing brings Submit back. Another device's newer response
 * comes in while nothing typed here is waiting.
 */
export function ExerciseResponseBox({
  jk, today, deviceId, card, todayId, onProblem, note, after,
}: {
  jk: JournalKey;
  today: ISODate;
  deviceId: string;
  card: ExerciseCard;
  todayId: string;
  onProblem: (p: string) => void;
  note?: ReactNode;
  after?: ReactNode;
}) {
  // The same card keeps the same reference across renders.
  const ref = useMemo(() => cardRef(card), [card.id, card.day, card.theme, card.legacy]);
  const [entry, setEntry] = useState<ExerciseResponse | null | undefined>(undefined);
  const latestRead = useRef(0);
  const load = useCallback(async () => {
    const id = ++latestRead.current;
    try {
      const r = await readExerciseEntry(jk, today, ref);
      if (id === latestRead.current) setEntry(r.entry);
    } catch {
      if (id === latestRead.current) onProblem(SAVE_PROBLEM);
    }
  }, [jk, today, ref, onProblem]);
  useEffect(() => void load(), [load]);
  useDbChanges(() => void load());
  if (entry === undefined) return null; // the box opens once what is stored is known
  return (
    <ResponseField jk={jk} today={today} deviceId={deviceId} card={card} todayId={todayId} entry={entry} onProblem={onProblem} note={note} after={after} />
  );
}

/** The stored response as this card's value: its text, or an answer for each of its parts. */
function valueFrom(parts: CardPart[], entry: ExerciseResponse | null): ResponseValue {
  if (parts.length === 0) return entry?.text ?? "";
  return parts.map((p, i): PartAnswer => {
    const prev = entry?.parts?.find((a) => a.prompt === p.prompt && a.kind === p.kind) ?? entry?.parts?.[i];
    let answer: PartValue = emptyPart(p);
    if (prev && prev.kind === p.kind) {
      if (p.kind === "list" && Array.isArray(prev.answer)) answer = Array.from({ length: p.count! }, (_, j) => (prev.answer as string[])[j] ?? "");
      else if (p.kind !== "list") answer = prev.answer;
    }
    return { prompt: p.prompt, kind: p.kind, answer };
  });
}

const UNSAVED = "\u0000unsaved";
const keyOf = (v: ResponseValue) => (typeof v === "string" ? v : JSON.stringify(v));

function ResponseField({
  jk, today, deviceId, card, todayId, entry, onProblem, note, after,
}: {
  jk: JournalKey;
  today: ISODate;
  deviceId: string;
  card: ExerciseCard;
  todayId: string;
  entry: ExerciseResponse | null;
  onProblem: (p: string) => void;
  note?: ReactNode;
  after?: ReactNode;
}) {
  const ref = useMemo(() => cardRef(card), [card.id, card.day, card.theme, card.legacy]);
  const stored = useMemo(() => valueFrom(card.parts, entry), [card.parts, entry]);
  const storedKey = keyOf(stored);
  const [value, setValue] = useState<ResponseValue>(stored);
  const [busy, setBusy] = useState(false);
  const latest = useRef<ResponseValue>(stored);
  const saved = useRef(storedKey);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const box = useRef<HTMLTextAreaElement>(null);

  // One save at a time, in order: a draft never lands after the Submit that followed it.
  const enqueue = useCallback((op: () => Promise<unknown>) => {
    const next = queue.current.then(op, op);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  // When this box last wrote: a read that started before that write landed is older, never taken.
  const wroteAt = useRef(0);
  const entryAt = entry?.at ?? null;

  // A newer stored response (another device, or this one read back): take it while nothing typed waits.
  useEffect(() => {
    const newer = wroteAt.current === 0 || (entryAt !== null && entryAt >= wroteAt.current);
    if (newer && keyOf(latest.current) === saved.current && storedKey !== saved.current) {
      latest.current = stored;
      saved.current = storedKey;
      setValue(stored);
    }
  }, [stored, storedKey, entryAt]);

  // The single box grows with the text (at least its six rows).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const saveNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const v = latest.current;
    const k = keyOf(v);
    if (k === saved.current) return;
    saved.current = k;
    wroteAt.current = Date.now();
    void enqueue(() => saveExerciseDraft(jk, today, deviceId, ref, v)).catch(() => {
      if (saved.current === k) saved.current = UNSAVED; // the next save tries again
      onProblem(SAVE_PROBLEM);
    });
  }, [jk, today, deviceId, ref, enqueue, onProblem]);

  useEffect(() => () => saveNow(), [saveNow]);
  useHiddenFlush(saveNow);

  function change(v: ResponseValue) {
    latest.current = v;
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(saveNow, AUTOSAVE_MS);
  }

  function setPart(i: number, answer: PartValue) {
    const now = latest.current as PartAnswer[];
    change(now.map((a, j) => (j === i ? { ...a, answer } : a)));
  }

  async function submit() {
    if (busy) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const v = latest.current;
    if (!responseComplete(v)) return;
    setBusy(true);
    const before = saved.current;
    const k = keyOf(v);
    saved.current = k;
    wroteAt.current = Date.now();
    try {
      await enqueue(() => submitExerciseEntry(jk, today, deviceId, ref, v, todayId));
      onProblem("");
    } catch {
      if (saved.current === k) saved.current = before === k ? UNSAVED : before;
      onProblem(SAVE_PROBLEM); // what she wrote stays
    } finally {
      setBusy(false);
    }
  }

  const showSaved = entry?.saved === true && keyOf(value) === storedKey;
  return (
    <div className="exercise-response-wrap">
      {typeof value === "string" ? (
        <textarea
          ref={box}
          className="journal-answer exercise-response"
          aria-label="Your response"
          placeholder="Write your response…"
          rows={6}
          value={value}
          onChange={(e) => change(e.target.value)}
          onBlur={saveNow}
        />
      ) : (
        <div className="exercise-parts" onBlur={saveNow}>
          {card.parts.map((p, i) => (
            <PartInput key={i} part={p} value={value[i]!.answer} onChange={(a) => setPart(i, a)} />
          ))}
        </div>
      )}
      <CardExample card={card} />
      <div className="exercise-response-row">
        {note ?? <span />}
        <div className="btn-group exercise-response-actions">
          {showSaved ? (
            <p className="journal-muted" role="status">
              Saved
            </p>
          ) : (
            <button type="button" disabled={busy || !responseComplete(value)} onClick={() => void submit()}>
              Submit
            </button>
          )}
          {after}
        </div>
      </div>
    </div>
  );
}

/** One part's input. */
function PartInput({ part, value, onChange }: { part: CardPart; value: PartValue; onChange: (v: PartValue) => void }) {
  if (part.kind === "text") {
    return (
      <label className="exercise-part">
        <span className="exercise-label">{part.prompt}</span>
        <textarea className="journal-answer exercise-part-text" value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} />
      </label>
    );
  }
  if (part.kind === "list") {
    const lines = Array.isArray(value) ? value : [];
    const filled = lines.filter((x) => x.trim() !== "").length;
    return (
      <fieldset className="exercise-part">
        <legend className="exercise-label">{part.prompt}</legend>
        <ol className="exercise-list">
          {lines.map((x, j) => (
            <li key={j}>
              <input
                type="text"
                className="exercise-list-line"
                aria-label={`${part.prompt}, ${j + 1}`}
                value={x}
                onChange={(e) => onChange(lines.map((y, k) => (k === j ? e.target.value : y)))}
              />
            </li>
          ))}
        </ol>
        <p className="journal-muted">{`${filled} of ${part.count} filled`}</p>
      </fieldset>
    );
  }
  const options: (string | number)[] = part.kind === "rating" ? RATINGS : (part.options ?? []);
  return (
    <fieldset className="exercise-part">
      <legend className="exercise-label">{part.prompt}</legend>
      <div className={part.kind === "rating" ? "btn-group exercise-rating" : "btn-group exercise-choice"}>
        {options.map((o) => (
          <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(value === o ? null : o)}>
            {o}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** "See an example" (a made-up worked example) and, when her book has one, where to find it. */
export function CardExample({ card }: { card: ExerciseCard }) {
  if (!card.example && !card.bookExample) return null;
  return (
    <>
      {card.example && (
        <details className="exercise-more exercise-example">
          <summary>See an example</summary>
          <div className="exercise-more-box">
            <p className="exercise-text">{card.example}</p>
          </div>
        </details>
      )}
      {card.bookExample && (
        <p className="journal-muted">{card.book ? `Your book has its own example in ${card.book}` : "Your book has its own example"}</p>
      )}
    </>
  );
}
