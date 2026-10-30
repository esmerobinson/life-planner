import { useCallback, useEffect, useRef, useState } from "react";
import {
  CANT_OPEN, currentStep, ensureCheckinSet, listCheckinDays, readCheckinDay, readPromptSettings, saveAnswer,
  savePromptSettings, type CheckinDay,
} from "../../data/repo";
import type { JournalKey } from "../../journal/crypto";
import { PROMPTS, PROMPT_BY_ID, STARTER_IDS, workbookPage } from "../../journal/prompts";
import { pickPrompts } from "../../journal/rotation";
import type { ISODate } from "../../domain/types";
import { AUTOSAVE_MS, useDraft, useHiddenFlush } from "../useDraft";
import { DoneBox, JournalHead, longDate, PromptText } from "./bits";
import { useDbChanges } from "./useJournalKey";

/** The gentle line under "Checked in for today" (from the mockup, tab A). */
export const CHECKED_IN_LINE = "Kind to yourself today? That counts.";
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
export function DailyCheckIn({ jk, today }: { jk: JournalKey; today: ISODate }) {
  const [day, setDay] = useState<CheckinDay | null>(null);
  const [past, setPast] = useState<CheckinDay[]>([]);
  const [active, setActive] = useState<string[] | null>(null);
  const [problem, setProblem] = useState("");
  const latest = useRef(0);
  const ensuring = useRef<Promise<unknown> | null>(null);

  const load = useCallback(async () => {
    const id = ++latest.current;
    try {
      const [chosen, all] = await Promise.all([readPromptSettings(jk), listCheckinDays(jk)]);
      const ids = chosen ?? [...STARTER_IDS];
      let todayDay = all.find((d) => d.date === today) ?? (await readCheckinDay(jk, today));
      if (!todayDay.hasSet && todayDay.prompts.length === 0) {
        // This device is the first to open today's check-in: pick and store the questions
        // (once; a reload meanwhile waits for that same write).
        if (!ensuring.current) {
          const history = all.filter((d) => d.date < today).map((d) => ({ date: d.date, prompts: d.prompts }));
          const prompts = pickPrompts({ date: today, hour: new Date().getHours(), active: ids, history });
          ensuring.current = prompts.length > 0 ? ensureCheckinSet(jk, today, prompts) : Promise.resolve(false);
        }
        await ensuring.current;
        todayDay = await readCheckinDay(jk, today);
      }
      if (id !== latest.current) return;
      setActive(ids);
      setDay(todayDay);
      setPast(all.filter((d) => d.date !== today));
    } catch {
      if (id === latest.current) setProblem(SAVE_PROBLEM);
    }
  }, [jk, today]);
  useEffect(() => void load(), [load]);
  useDbChanges(() => void load());

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
    <section className="journal-card" aria-labelledby="daily-check-in" id="daily-check-in-section">
      <JournalHead id="daily-check-in" title="Daily check-in" sub="Today's three questions · 🔒 private" />
      {day && day.unreadable > 0 && <p className="journal-muted">{CANT_OPEN}</p>}
      {day && day.prompts.length === 0 && <p>No questions are switched on. Choose some under Choose questions.</p>}
      {day && day.prompts.length > 0 &&
        (step === -1 ? (
          <CheckedIn jk={jk} day={day} onProblem={setProblem} />
        ) : (
          <Question key={day.prompts[step]} jk={jk} day={day} step={step} onProblem={setProblem} />
        ))}
      {problem && <p role="alert">{problem}</p>}
      <PastCheckIns past={past} />
      {active && <ChooseQuestions active={active} onChange={(ids) => void choose(ids)} />}
    </section>
  );
}

function QuestionText({ id }: { id: string }) {
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
 * One question. The answer box saves itself (its own row, not yet "moved past") after a pause
 * in typing, on blur, when it goes away and when the app is hidden. Next and Skip save it as
 * moved past; Skip keeps anything already typed.
 */
function Question({
  jk, day, step, onProblem,
}: { jk: JournalKey; day: CheckinDay; step: number; onProblem: (p: string) => void }) {
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
    void enqueue(() => saveAnswer(jk, day.date, prompt, value, doneThere.current)).catch(() => {
      if (saved.current === value) saved.current = "\u0000unsaved"; // the next save tries again
      onProblem(SAVE_PROBLEM);
    });
  }, [jk, day.date, prompt, enqueue, onProblem]);

  useEffect(() => () => saveNow(), [saveNow]);
  useHiddenFlush(saveNow);

  async function move() {
    if (busy) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setBusy(true);
    const value = latest.current;
    try {
      await enqueue(() => saveAnswer(jk, day.date, prompt, value, true));
      moved.current = true; // the next question shows once the save is read back
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
      <textarea
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
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void move()}>
          Skip
        </button>
        <button type="button" disabled={busy} onClick={() => void move()}>
          {last ? "Finish" : "Next →"}
        </button>
      </div>
    </div>
  );
}

/** "Checked in for today", then today's questions and answers, still editable. */
function CheckedIn({ jk, day, onProblem }: { jk: JournalKey; day: CheckinDay; onProblem: (p: string) => void }) {
  return (
    <>
      <DoneBox title="Checked in for today" line={CHECKED_IN_LINE} />
      <ol className="journal-answers">
        {day.prompts.map((id) => (
          <li key={id}>
            <QuestionText id={id} />
            <EditableAnswer
              stored={day.answers.get(id)?.answer ?? ""}
              onSave={async (text) => {
                try {
                  await saveAnswer(jk, day.date, id, text, true);
                } catch (err) {
                  onProblem(SAVE_PROBLEM);
                  throw err;
                }
              }}
            />
          </li>
        ))}
      </ol>
    </>
  );
}

function EditableAnswer({ stored, onSave }: { stored: string; onSave: (text: string) => Promise<void> }) {
  const draft = useDraft(stored, onSave, AUTOSAVE_MS);
  return (
    <textarea
      className="journal-answer"
      aria-label="Your answer"
      placeholder="Anything you like…"
      value={draft.value}
      onChange={(e) => draft.set(e.target.value)}
      onBlur={draft.flush}
    />
  );
}

/** Past check-ins, newest first; each opens its questions and answers (these may be reread). */
function PastCheckIns({ past }: { past: CheckinDay[] }) {
  if (past.length === 0) return null;
  return (
    <details className="journal-fold">
      <summary>Past check-ins</summary>
      <ul className="journal-past">
        {past.map((c) => (
          <li key={c.date}>
            <details>
              <summary>{longDate(c.date)}</summary>
              <ol className="journal-answers">
                {c.prompts.map((id) => {
                  const a = c.answers.get(id)?.answer ?? null;
                  return (
                    <li key={id}>
                      <QuestionText id={id} />
                      <p className="journal-past-answer">{a ?? <span className="journal-muted">Skipped</span>}</p>
                    </li>
                  );
                })}
              </ol>
              {c.unreadable > 0 && <p className="journal-muted">{CANT_OPEN}</p>}
            </details>
          </li>
        ))}
      </ul>
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
