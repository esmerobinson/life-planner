import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  answeredPrompts, CANT_OPEN, currentStep, ensureCheckinSet, listCheckinDays, moveAnswerOn, readCheckinDay, readPromptSettings, saveAnswer,
  savePromptSettings, type CheckinDay,
} from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { PROMPTS, PROMPT_BY_ID, STARTER_IDS, workbookPage } from "../../journal/prompts";
import { pickPrompts } from "../../journal/rotation";
import type { ISODate } from "../../domain/types";
import { AUTOSAVE_MS, useDraft, useHiddenFlush } from "../useDraft";
import { AutoGrowTextarea } from "../useAutoGrow";
import { DoneBox, LoadLine, longDate, PromptText, useLoadGuard } from "./bits";
import { useDbChanges } from "./useJournalKey";

/** On a finished check-in: the answers back into boxes, then read-only again. */
export const EDIT_ANSWERS = "Edit";
export const SAVE_ANSWERS = "Save";
/** How many past check-ins the tab lists before "See all" (Read back). */
const PAST_ON_TAB = 3;
/** The gentle line under "Checked in for today" (from the mockup, tab A). */
export const CHECKED_IN_LINE = "Kind to yourself today? That counts.";
/** A finished day's question with no words saved (blank, cleared or lost; bug #40). Provisional wording. */
export const NO_ANSWER_SAVED = "No answer saved";
const SAVE_PROBLEM = "That didn't save. Try again.";

/**
 * Daily check-in (journal brief §2, VISUAL-LANGUAGE.md "Daily check-in", mockup tab A):
 * the day's questions one at a time, Skip / Next, then "Checked in for today" with the
 * answers (editable the same day). Past check-ins can be reread.
 *
 * - The first device to open the check-in on a day writes the day's questions (a synced
 *   `set` row); every other device uses them.
 * - Each answer is its own row, autosaved while typing, on blur, when leaving and when the app
 *   goes to the background. Today is re-read whenever sync brings rows, so another device's
 *   answers show here and are never written over.
 */
export function DailyCheckIn({ jk, today, deviceId }: { jk: JournalKey; today: ISODate; deviceId: string }) {
  const [day, setDay] = useState<CheckinDay | null>(null);
  const [past, setPast] = useState<CheckinDay[]>([]);
  const [active, setActive] = useState<string[] | null>(null);
  const [problem, setProblem] = useState("");
  const latest = useRef(0);
  const guardFail = useRef<() => void>(() => undefined);
  const loaded = useRef(false);
  // The first-open write of a day's questions, per day (a check-in left open past midnight
  // picks and stores the new day's questions too).
  const ensuring = useRef<{ date: ISODate; done: Promise<unknown> } | null>(null);

  const load = useCallback(async () => {
    const id = ++latest.current;
    try {
      const [chosen, all] = await Promise.all([readPromptSettings(jk), listCheckinDays(jk)]);
      const ids = chosen ?? [...STARTER_IDS];
      let todayDay = all.find((d) => d.date === today) ?? (await readCheckinDay(jk, today));
      if (!todayDay.hasSet && todayDay.prompts.length === 0) {
        // This device is the first to open today's check-in: pick and store the questions
        // (once; a reload meanwhile waits for that same write).
        if (ensuring.current?.date !== today) {
          const history = all
            .filter((d) => d.date < today)
            .map((d) => ({ date: d.date, prompts: d.prompts, answered: new Set(answeredPrompts(d)) }));
          const prompts = pickPrompts({ date: today, hour: new Date().getHours(), active: ids, history });
          ensuring.current = {
            date: today,
            done: prompts.length > 0 ? ensureCheckinSet(jk, today, prompts) : Promise.resolve(false),
          };
        }
        await ensuring.current.done;
        todayDay = await readCheckinDay(jk, today);
      }
      if (id !== latest.current) return;
      loaded.current = true;
      setActive(ids);
      setDay(todayDay);
      setPast(all.filter((d) => d.date !== today));
    } catch {
      if (id !== latest.current) return;
      if (loaded.current) setProblem(SAVE_PROBLEM);
      else guardFail.current(); // nothing read yet: the can't-open line and Try again
    }
  }, [jk, today]);
  useEffect(() => void load(), [load]);
  useDbChanges(() => void load());
  // Never blank under the strip: "Loading…", then the can't-open line and Try again.
  const guard = useLoadGuard(day === null, load);
  guardFail.current = guard.fail;

  async function choose(ids: string[]) {
    setActive(ids);
    try {
      await savePromptSettings(jk, ids, today);
    } catch {
      setProblem(SAVE_PROBLEM);
    }
  }

  const step = day ? currentStep(day) : -1;
  return (
    <>
      {day === null && <LoadLine guard={guard} />}
      {day && day.unreadable > 0 && <p className="journal-muted">{CANT_OPEN}</p>}
      {day && day.prompts.length === 0 && <p>No questions are switched on. Choose some under Choose questions.</p>}
      {day && day.prompts.length > 0 &&
        (step === -1 ? (
          <CheckedIn jk={jk} day={day} deviceId={deviceId} onProblem={setProblem} />
        ) : (
          <Question key={`${day.date}|${day.prompts[step]}`} jk={jk} day={day} step={step} deviceId={deviceId} onProblem={setProblem} />
        ))}
      {problem && <p role="alert">{problem}</p>}
      <PastCheckIns past={past} />
      {active && <ChooseQuestions active={active} onChange={(ids) => void choose(ids)} />}
    </>
  );
}

export function QuestionText({ id }: { id: string }) {
  const p = PROMPT_BY_ID.get(id);
  if (!p) return <p className="journal-q">This question is from a newer version of the app.</p>;
  const page = workbookPage(p.ref);
  return (
    <>
      <p className="journal-q">
        <PromptText text={p.text} />
      </p>
      <p className="journal-muted journal-skill">{page ? `${p.skill} · ${page}` : p.skill}</p>
    </>
  );
}

/**
 * One question. The answer box shows the newest answer from any device and saves this
 * device's own row (not yet "moved past") after a pause in typing, on blur, when it goes away
 * and when the app is hidden. Next and Skip save it as moved past; Skip keeps anything typed,
 * and Skip on an empty box saves it as skipped (left out of the finished check-in; bug #40).
 * Next / Skip on a box left untouched never copies another device's answer and never blanks
 * this device's own: it writes nothing when already moved past anywhere, else only "moved past".
 */
function Question({
  jk, day, step, deviceId, onProblem,
}: { jk: JournalKey; day: CheckinDay; step: number; deviceId: string; onProblem: (p: string) => void }) {
  const prompt = day.prompts[step]!;
  const stored = day.answers.get(prompt)?.answer ?? "";
  const [text, setText] = useState(stored);
  const latest = useRef(stored);
  const saved = useRef(stored);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const moved = useRef(false);
  const [busy, setBusy] = useState(false);
  // If another device already moved past this question, an autosave here keeps it moved past.
  const doneThere = useRef(false);
  doneThere.current = day.answers.get(prompt)?.done ?? false;

  const enqueue = useCallback((op: () => Promise<unknown>) => {
    const next = queue.current.then(op, op);
    queue.current = next.catch(() => undefined);
    return next;
  }, []);

  // Another device's answer to this question arrives: take it while nothing here is unsaved.
  useEffect(() => {
    if (latest.current === saved.current && stored !== saved.current) {
      latest.current = stored;
      saved.current = stored;
      setText(stored);
    }
  }, [stored]);

  const saveNow = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const value = latest.current;
    if (moved.current || value === saved.current) return;
    saved.current = value;
    void enqueue(() => saveAnswer(jk, day.date, prompt, deviceId, value, doneThere.current)).catch(() => {
      if (saved.current === value) saved.current = "\u0000unsaved"; // the next save tries again
      onProblem(SAVE_PROBLEM);
    });
  }, [jk, day.date, prompt, deviceId, enqueue, onProblem]);

  useEffect(() => () => saveNow(), [saveNow]);
  useHiddenFlush(saveNow);

  async function move(skip: boolean) {
    if (busy) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setBusy(true);
    const value = latest.current;
    const untouched = value === saved.current && value === stored;
    try {
      if (untouched && doneThere.current) {
        moved.current = true; // already moved past on another device: nothing to write
      } else {
        // Nothing new typed: keep what this device already saved (never blank it).
        await enqueue(() =>
          untouched
            ? moveAnswerOn(jk, day.date, prompt, deviceId, { skip })
            : saveAnswer(jk, day.date, prompt, deviceId, value, true, undefined, skip),
        );
        moved.current = true; // the next question shows once the save is read back
      }
      onProblem("");
    } catch {
      onProblem(SAVE_PROBLEM); // stays on this question, text kept
      setBusy(false);
    }
  }

  const last = step === day.prompts.length - 1;
  const n = day.prompts.length;
  return (
    <div className="journal-question">
      <div className="journal-dots" role="img" aria-label={`Question ${step + 1} of ${n}`}>
        {day.prompts.map((_, i) => (
          <span key={i} className={i <= step ? "journal-dot on" : "journal-dot"} />
        ))}
      </div>
      <QuestionText id={prompt} />
      <AutoGrowTextarea
        className="journal-answer"
        aria-label="Your answer"
        placeholder="Anything you like…"
        value={text}
        onChange={(e) => {
          latest.current = e.target.value;
          setText(e.target.value);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(saveNow, AUTOSAVE_MS);
        }}
        onBlur={saveNow}
      />
      <div className="btn-group journal-question-actions">
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void move(true)}>
          Skip
        </button>
        <button type="button" disabled={busy} onClick={() => void move(false)}>
          {last ? "Finish" : "Next →"}
        </button>
      </div>
    </div>
  );
}

/**
 * Once today's check-in is finished (Esme, 2026-11-04: "i should just see a completed check in
 * with my answers, maybe an option to edit"): "Checked in for today", then every question of
 * the day with her answer as it is, read-only, or "No answer saved" when it has no words
 * (saved blank, cleared or lost; bug #40). Only a question she skipped on purpose isn't shown.
 * "Edit" is always there and turns every shown question into a box (every question, when she
 * skipped them all; each saved as she types, as before); Save shows them read-only again.
 */
function CheckedIn({
  jk, day, deviceId, onProblem,
}: { jk: JournalKey; day: CheckinDay; deviceId: string; onProblem: (p: string) => void }) {
  // While editing: the questions shown when she pressed Edit, kept until Save, so clearing one
  // to rewrite it never takes its box away (re-review m2).
  const [editingIds, setEditingIds] = useState<string[] | null>(null);
  const editing = editingIds !== null;
  // The answers the boxes opened with: while she edits, a re-read of the day never puts other
  // words into a box (bug #32); she sees them again after Save.
  const [editStart, setEditStart] = useState<Record<string, { text: string; at: number }>>({});
  // This Edit's own rows (a new version each time she edits; bug #24).
  const [session, setSession] = useState("");
  // What she just saved here, shown at once until the day is read again; then the day's merged
  // answer, newest from any device, shows (bug #23).
  const [mine, setMine] = useState<Record<string, string>>({});
  useEffect(() => setMine({}), [day]);
  const answerOf = (id: string) => mine[id] ?? day.answers.get(id)?.answer ?? "";
  const hasWords = (id: string) => answerOf(id).trim() !== "";
  // Hidden only when skipped on purpose with nothing written; anything unsure shows (bug #40).
  const skipped = (id: string) => !hasWords(id) && !(id in mine) && day.answers.get(id)?.skipped === true;
  const visible = day.prompts.filter((id) => !skipped(id));
  const shown = editingIds ?? visible;
  return (
    <>
      <DoneBox title="Checked in for today" line={CHECKED_IN_LINE} />
      <ol className="journal-answers">
        {shown.map((id) => (
          <li key={id}>
            <QuestionText id={id} />
            {editing ? (
              <EditableAnswer
                stored={editStart[id]?.text ?? answerOf(id)}
                onSave={async (text) => {
                  setMine((m) => ({ ...m, [id]: text }));
                  try {
                    await saveAnswer(jk, day.date, id, deviceId, text, true, { session, seenAt: editStart[id]?.at }); // this Edit's own row
                  } catch (err) {
                    onProblem(SAVE_PROBLEM);
                    throw err;
                  }
                }}
              />
            ) : hasWords(id) ? (
              <p className="journal-past-answer">
                <output aria-label="Your answer" aria-live="off">
                  {answerOf(id)}
                </output>
              </p>
            ) : (
              <p className="journal-muted">{NO_ANSWER_SAVED}</p>
            )}
          </li>
        ))}
      </ol>
      <div className="btn-group">
        {editing ? (
          <button type="button" onClick={() => setEditingIds(null)}>
            {SAVE_ANSWERS}
          </button>
        ) : (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const open = visible.length > 0 ? visible : day.prompts; // all skipped: every one
              setSession(Date.now().toString(36));
              setEditStart(Object.fromEntries(open.map((id) => [id, { text: answerOf(id), at: day.answers.get(id)?.at ?? 0 }])));
              setEditingIds(open);
            }}
          >
            {EDIT_ANSWERS}
          </button>
        )}
      </div>
    </>
  );
}

function EditableAnswer({ stored, onSave }: { stored: string; onSave: (text: string) => Promise<void> }) {
  const draft = useDraft(stored, onSave, AUTOSAVE_MS);
  // Save (or anything else) taking the boxes away: what is typed is saved first.
  const flush = useRef(draft.flush);
  flush.current = draft.flush;
  useEffect(() => () => flush.current(), []);
  return (
    <AutoGrowTextarea
      className="journal-answer"
      aria-label="Your answer"
      placeholder="Anything you like…"
      value={draft.value}
      onChange={(e) => draft.set(e.target.value)}
      onBlur={draft.flush}
    />
  );
}

/**
 * Past check-ins, newest first (the latest few; "See all" opens Read back); each opens the
 * questions she answered (these may be reread).
 * Skipped questions aren't shown, and a day with nothing answered isn't listed (Esme,
 * 2026-11-04): those questions come round again instead.
 */
function PastCheckIns({ past }: { past: CheckinDay[] }) {
  const days = past.filter((c) => answeredPrompts(c).length > 0 || c.unreadable > 0);
  if (days.length === 0) return null;
  return (
    <details className="journal-fold">
      <summary>Past check-ins</summary>
      <ul className="journal-past">
        {days.slice(0, PAST_ON_TAB).map((c) => (
          <li key={c.date}>
            <details>
              <summary>{longDate(c.date)}</summary>
              <ol className="journal-answers">
                {answeredPrompts(c).map((id) => (
                  <li key={id}>
                    <QuestionText id={id} />
                    <p className="journal-past-answer">{c.answers.get(id)!.answer}</p>
                  </li>
                ))}
              </ol>
              {c.unreadable > 0 && <p className="journal-muted">{CANT_OPEN}</p>}
            </details>
          </li>
        ))}
      </ul>
      {days.length > PAST_ON_TAB && (
        <p>
          <Link to="/journal/read-back">See all</Link>
        </p>
      )}
    </details>
  );
}

/** Choose questions: the whole bank with a tick each (synced; defaults to her starters). */
function ChooseQuestions({ active, onChange }: { active: string[]; onChange: (ids: string[]) => void }) {
  const on = new Set(active);
  return (
    <details className="journal-fold">
      <summary>Choose questions</summary>
      <ul className="journal-choose">
        {PROMPTS.map((p) => (
          <li key={p.id}>
            <label className="form-check">
              <input
                type="checkbox"
                checked={on.has(p.id)}
                onChange={(e) => onChange(e.target.checked ? [...active, p.id] : active.filter((id) => id !== p.id))}
              />
              <span>
                <PromptText text={p.text} /> <span className="journal-muted">{p.skill}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}
