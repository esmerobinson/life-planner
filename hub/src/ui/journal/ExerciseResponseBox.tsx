import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  cardRef, logExerciseEntry, readExerciseEntry, readLatestExerciseEntry, responseComplete, responseLoggable, saveExerciseDraft,
  submitExerciseEntry, trackerNewInput, type ExerciseResponse, type PartAnswer, type ResponseValue,
} from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { emptyPart, hasTracker, trackerDaysFilled, type CardPart, type ExerciseCard, type PartValue } from "../../journal/exercise";
import type { ISODate } from "../../domain/types";
import { AUTOSAVE_MS, useHiddenFlush } from "../useDraft";
import { useDbChanges } from "./useJournalKey";

const SAVE_PROBLEM = "That didn't save. Try again.";
/** A running count, to tell whether a read started after a write had landed. */
let clock = 0;
const tick = () => ++clock;
/** The most she can type in one checklist item's note. */
const MAX_CHECKLIST_NOTE_TEXT = 500;
const RATINGS =[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** Saving a tracker card's day without finishing it. */
export const SAVE_TODAY = "Save today's entry";

/**
 * Her response to a card (journal polish brief §1; Journal v2). A card without parts: the
 * check-in's answer box, growing with what she writes. A card with parts: one input per part
 * (text: a box; list: `count` numbered lines with "N of M filled"; rating: 0–10; choice: pill
 * options; table: a grid under its column headings, stacked row cards on the phone; scale: the
 * points between its end labels; tracker: Day 1 … Day N, each with its fields, the day to fill
 * now outlined; chain: its steps in order, linked; checklist: each item with the choice pills and perhaps a note box, "N of M
 * answered · Yes 3 · …"), and Submit only once every part is filled
 * ("if I have to complete 10, I complete 10"). A tracker card can be saved a day at a time
 * ("Save today's entry"): it counts for the day, and comes back as today's card until every day
 * is filled; its earlier days come forward from the last day she saved. Under it, "See an example" and her book's own example when the card has them.
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
  const [read, setRead] = useState<{ entry: ExerciseResponse | null; carried: PartAnswer[] | null; at: number } | undefined>(undefined);
  const latestRead = useRef(0);
  const tracker = hasTracker(card);
  const load = useCallback(async () => {
    const id = ++latestRead.current;
    const at = tick();
    try {
      const r = await readExerciseEntry(jk, today, ref);
      let e = r.entry;
      // A tracker card: today's box starts from the last day she saved, and only what is new
      // since then can be saved for today (review I2).
      const prev = tracker ? await readLatestExerciseEntry(jk, today, ref) : null;
      if (!e && prev) e = { ...prev, date: today, saved: false, submitted: false };
      if (id === latestRead.current) setRead({ entry: e, carried: prev?.parts ?? null, at });
    } catch {
      if (id === latestRead.current) onProblem(SAVE_PROBLEM);
    }
  }, [jk, today, ref, tracker, onProblem]);
  useEffect(() => void load(), [load]);
  useDbChanges(() => void load());
  if (read === undefined) return null; // the box opens once what is stored is known
  return (
    <ResponseField
      jk={jk}
      today={today}
      deviceId={deviceId}
      card={card}
      todayId={todayId}
      entry={read.entry}
      carried={read.carried}
      readAt={read.at}
      reload={load}
      onProblem={onProblem}
      note={note}
      after={after}
    />
  );
}

/** A stored answer fitted to the part's shape now (its lines, rows and fields), or the empty one. */
function fit(empty: PartValue, prev: PartValue): PartValue {
  if (Array.isArray(empty)) {
    if (!Array.isArray(prev)) return empty;
    return (empty as unknown[]).map((e, i) => {
      const was = (prev as unknown[])[i];
      if (Array.isArray(e)) return (e as string[]).map((_, j) => (Array.isArray(was) && typeof was[j] === "string" ? was[j] : ""));
      return typeof was === "string" ? was : "";
    }) as PartValue;
  }
  if (typeof empty === "string") return typeof prev === "string" ? prev : empty;
  return typeof prev === "number" || typeof prev === "string" ? prev : null;
}

/**
 * A stored checklist answer fitted to the card's items now: each item keeps the choice (still
 * one of the options) and note stored under the same item words.
 */
export function fitChecklist(part: CardPart, prev: PartValue): PartValue {
  const rows = Array.isArray(prev) ? (prev as unknown[]).filter((r): r is string[] => Array.isArray(r)) : [];
  return part.items!.map((item, i) => {
    const was = rows[i]?.[0] === item ? rows[i] : rows.find((r) => r[0] === item);
    const choice = typeof was?.[1] === "string" && (part.options ?? []).includes(was[1]) ? was[1] : "";
    return [item, choice, typeof was?.[2] === "string" ? was[2] : ""];
  });
}

/** The stored response as this card's value: its text, or an answer for each of its parts. */
function valueFrom(parts: CardPart[], entry: ExerciseResponse | null): ResponseValue {
  if (parts.length === 0) return entry?.text ?? "";
  return parts.map((p, i): PartAnswer => {
    const prev = entry?.parts?.find((a) => a.prompt === p.prompt && a.kind === p.kind) ?? entry?.parts?.[i];
    const answer =
      prev && prev.kind === p.kind ? (p.kind === "checklist" ? fitChecklist(p, prev.answer) : fit(emptyPart(p), prev.answer)) : emptyPart(p);
    return { prompt: p.prompt, kind: p.kind, answer };
  });
}

const UNSAVED = "\u0000unsaved";
const keyOf = (v: ResponseValue) => (typeof v === "string" ? v : JSON.stringify(v));

function ResponseField({
  jk, today, deviceId, card, todayId, entry, carried, readAt, reload, onProblem, note, after,
}: {
  jk: JournalKey;
  today: ISODate;
  deviceId: string;
  card: ExerciseCard;
  todayId: string;
  entry: ExerciseResponse | null;
  /** A tracker card's days carried forward from an earlier day (null: none). */
  carried: PartAnswer[] | null;
  /** When the read behind `entry` started (tick). */
  readAt: number;
  reload: () => Promise<void>;
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

  // Writes in flight, and when the last one landed: a read that started before a write landed
  // (or while one is in flight) is older than what is here, and is never taken.
  const pending = useRef(0);
  const landedAt = useRef(0);

  // One save at a time, in order: a draft never lands after the Submit that followed it. Once
  // it lands, what is stored is read again.
  const enqueue = useCallback(
    (op: () => Promise<unknown>) => {
      pending.current++;
      const next = queue.current.then(op, op).finally(() => {
        pending.current--;
        landedAt.current = tick();
        void reload();
      });
      queue.current = next.catch(() => undefined);
      return next;
    },
    [reload],
  );

  // A newer stored response (another device, or this one read back): take it while nothing typed waits.
  useEffect(() => {
    const fresh = pending.current === 0 && readAt > landedAt.current;
    if (fresh && keyOf(latest.current) === saved.current && storedKey !== saved.current) {
      latest.current = stored;
      saved.current = storedKey;
      setValue(stored);
    }
  }, [stored, storedKey, readAt]);

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

  async function submit(log = false) {
    if (busy) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const v = latest.current;
    if (log ? !(responseLoggable(v) && trackerNewInput(v, carried)) : !responseComplete(v)) return;
    setBusy(true);
    const before = saved.current;
    const k = keyOf(v);
    saved.current = k;
    try {
      await enqueue(() => (log ? logExerciseEntry : submitExerciseEntry)(jk, today, deviceId, ref, v, todayId));
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
          ) : !responseComplete(value) && hasTracker(card) ? (
            <button type="button" disabled={busy || !responseLoggable(value) || !trackerNewInput(value, carried)} onClick={() => void submit(true)}>
              {SAVE_TODAY}
            </button>
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
    const lines = Array.isArray(value) ? (value as string[]) : [];
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
  if (part.kind === "checklist") return <ChecklistInput part={part} value={value} onChange={onChange} />;
  if (part.kind === "table") return <TableInput part={part} value={value} onChange={onChange} />;
  if (part.kind === "tracker") return <TrackerInput part={part} value={value} onChange={onChange} />;
  if (part.kind === "chain") {
    const links = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="exercise-part">
        <legend className="exercise-label">{part.prompt}</legend>
        <ol className="exercise-chain">
          {part.steps!.map((step, j) => (
            <li key={j}>
              <label className="exercise-chain-step">
                <span>
                  {j > 0 && (
                    <span className="exercise-chain-arrow" aria-hidden="true">
                      →{" "}
                    </span>
                  )}
                  {step}
                </span>
                <textarea
                  className="journal-answer exercise-chain-box"
                  rows={2}
                  value={links[j] ?? ""}
                  onChange={(e) => onChange(links.map((y, k) => (k === j ? e.target.value : y)))}
                />
              </label>
            </li>
          ))}
        </ol>
      </fieldset>
    );
  }
  if (part.kind === "scale") {
    const points = Array.from({ length: part.max! - part.min! + 1 }, (_, i) => part.min! + i);
    return (
      <fieldset className="exercise-part">
        <legend className="exercise-label">{part.prompt}</legend>
        <div className="exercise-scale">
          {part.minLabel && <span className="journal-muted exercise-scale-end">{part.minLabel}</span>}
          <div className="btn-group exercise-rating">
            {points.map((o) => (
              <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(value === o ? null : o)}>
                {o}
              </button>
            ))}
          </div>
          {part.maxLabel && <span className="journal-muted exercise-scale-end">{part.maxLabel}</span>}
        </div>
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

/**
 * A checklist: the prompt, then a row per item (its words, the options as the choice part's
 * pills, one at a time, tap again to clear, and a one-line note box when the card gives it a
 * placeholder), and a quiet count line ("4 of 9 answered · Yes 3 · Partly 1"). An answer is an
 * [item, choice, note] row per item.
 */
function ChecklistInput({ part, value, onChange }: { part: CardPart; value: PartValue; onChange: (v: PartValue) => void }) {
  const id = useId();
  const options = part.options ?? [];
  const rows = Array.isArray(value) ? (value as string[][]) : [];
  const set = (i: number, at: 1 | 2, v: string) => onChange(rows.map((r, j) => (j === i ? r.map((x, k) => (k === at ? v : x)) : r)));
  const counts = options.map((o) => ({ o, n: rows.filter((r) => r[1] === o).length })).filter((c) => c.n > 0);
  const answered = counts.reduce((n, c) => n + c.n, 0);
  return (
    <fieldset className="exercise-part">
      <legend className="exercise-label">{part.prompt}</legend>
      <ul className="exercise-checklist">
        {rows.map((r, i) => (
          <li key={i} className="exercise-check-item">
            <span id={`${id}-${i}`} className="exercise-check-label">
              {part.items![i]}
            </span>
            <div role="group" aria-labelledby={`${id}-${i}`} className="btn-group exercise-choice">
              {options.map((o) => (
                <button key={o} type="button" aria-pressed={r[1] === o} onClick={() => set(i, 1, r[1] === o ? "" : o)}>
                  {o}
                </button>
              ))}
            </div>
            {part.note && (
              <input
                type="text"
                className="exercise-check-note"
                aria-label={`${part.items![i]}, note`}
                placeholder={part.note}
                maxLength={MAX_CHECKLIST_NOTE_TEXT}
                value={r[2] ?? ""}
                onChange={(e) => set(i, 2, e.target.value)}
              />
            )}
          </li>
        ))}
      </ul>
      <p className="journal-muted">{[`${answered} of ${rows.length} answered`, ...counts.map((c) => `${c.o} ${c.n}`)].join(" · ")}</p>
    </fieldset>
  );
}

/** A table: a grid of inputs under its column headings (stacked row cards on the phone, by CSS). */
function TableInput({ part, value, onChange }: { part: CardPart; value: PartValue; onChange: (v: PartValue) => void }) {
  const grid = Array.isArray(value) ? (value as string[][]) : [];
  const cols = part.columns!;
  const set = (r: number, c: number, v: string) => onChange(grid.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)));
  return (
    <fieldset className="exercise-part">
      <legend className="exercise-label">{part.prompt}</legend>
      <table className="exercise-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, r) => (
            <tr key={r}>
              {cols.map((c, j) => (
                <td key={c} data-label={c}>
                  <input type="text" aria-label={`${c}, row ${r + 1}`} value={row[j] ?? ""} onChange={(e) => set(r, j, e.target.value)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </fieldset>
  );
}

/** A tracker: Day 1 … Day N, each with its fields; the day to fill now outlined ("Day 3 of 7"). */
function TrackerInput({ part, value, onChange }: { part: CardPart; value: PartValue; onChange: (v: PartValue) => void }) {
  const days = Array.isArray(value) ? (value as string[][]) : [];
  const fields = part.fields!;
  const filled = trackerDaysFilled(part, value);
  const now = Math.min(filled, part.days! - 1);
  const set = (d: number, f: number, v: string) => onChange(days.map((day, i) => (i === d ? day.map((x, j) => (j === f ? v : x)) : day)));
  return (
    <fieldset className="exercise-part">
      <legend className="exercise-label">{part.prompt}</legend>
      <p className="journal-muted">{filled >= part.days! ? `All ${part.days} days filled` : `Day ${filled + 1} of ${part.days}`}</p>
      <ol className="exercise-tracker">
        {days.map((day, d) => (
          <li key={d} className={d === now && filled < part.days! ? "exercise-tracker-day is-now" : "exercise-tracker-day"}>
            <b>{`Day ${d + 1}`}</b>
            {fields.map((f, j) => (
              <label key={f} className="exercise-tracker-field">
                <span className="journal-muted">{f}</span>
                <input type="text" aria-label={`Day ${d + 1}, ${f}`} value={day[j] ?? ""} onChange={(e) => set(d, j, e.target.value)} />
              </label>
            ))}
          </li>
        ))}
      </ol>
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
