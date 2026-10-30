import { useCallback, useEffect, useRef, useState } from "react";
import { db } from "../../data/db";
import { CANT_OPEN, listCheckins, readCheckin, saveCheckin, type CheckinDay } from "../../data/repo";
import type { CheckinEntry } from "../../journal/entries";
import { PROMPTS, PROMPT_BY_ID, workbookPage } from "../../journal/prompts";
import { pickPrompts } from "../../journal/rotation";
import { loadActivePrompts, saveActivePrompts } from "../../journal/settings";
import type { ISODate } from "../../domain/types";
import { AUTOSAVE_MS, useDraft } from "../useDraft";
import { DoneBox, JournalHead, longDate, PromptText } from "./bits";
import { useDbChanges } from "./useJournalKey";

/** The gentle line under "Checked in for today" (from the mockup, tab A). */
export const CHECKED_IN_LINE = "Kind to yourself today? That counts.";
const SAVE_PROBLEM = "That didn't save. Try again.";

type Today =
  | { kind: "loading" }
  | { kind: "unreadable" }
  | { kind: "ready"; entry: Omit<CheckinEntry, "v">; saved: boolean };

/**
 * Daily check-in (journal brief §2, VISUAL-LANGUAGE.md "Daily check-in", mockup tab A): three
 * of her questions, one at a time, Skip / Next, then "Checked in for today" with the answers
 * (editable the same day). Past check-ins can be reread.
 */
export function DailyCheckIn({ cryptoKey, today }: { cryptoKey: CryptoKey; today: ISODate }) {
  const [state, setState] = useState<Today>({ kind: "loading" });
  const [past, setPast] = useState<CheckinDay[]>([]);
  const [active, setActive] = useState<string[] | null>(null);
  const [problem, setProblem] = useState("");
  // Every write in order (answers typed quickly must not overtake one another).
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const current = useRef<Omit<CheckinEntry, "v"> | null>(null);

  const loadPast = useCallback(async () => {
    try {
      setPast((await listCheckins(cryptoKey)).filter((c) => c.date !== today));
    } catch {
      setPast([]);
    }
  }, [cryptoKey, today]);

  const loadToday = useCallback(
    async (activeIds?: string[]) => {
      const ids = activeIds ?? (await loadActivePrompts(db));
      setActive(ids);
      const opened = await readCheckin(cryptoKey, today);
      if (opened.state === "unreadable") {
        setState({ kind: "unreadable" });
        return;
      }
      if (opened.state === "ok") {
        const { v: _v, ...entry } = opened.entry;
        current.current = entry;
        setState({ kind: "ready", entry, saved: true });
        return;
      }
      const history = (await listCheckins(cryptoKey)).flatMap((c) =>
        c.opened.state === "ok" ? [{ date: c.date, prompts: c.opened.entry.prompts }] : [],
      );
      const prompts = pickPrompts({ date: today, hour: new Date().getHours(), active: ids, history });
      const entry = { prompts, answers: prompts.map(() => null), step: 0, finished: false };
      current.current = entry;
      setState({ kind: "ready", entry, saved: false });
    },
    [cryptoKey, today],
  );

  useEffect(() => {
    void loadToday().catch(() => setState({ kind: "unreadable" }));
    void loadPast();
  }, [loadToday, loadPast]);
  useDbChanges(() => void loadPast());

  const save = useCallback(
    (entry: Omit<CheckinEntry, "v">) => {
      current.current = entry;
      setState({ kind: "ready", entry, saved: true });
      const op = () => saveCheckin(cryptoKey, today, entry);
      const next = queue.current.then(op, op);
      queue.current = next.catch(() => undefined);
      return next.then(
        () => setProblem(""),
        () => setProblem(SAVE_PROBLEM),
      );
    },
    [cryptoKey, today],
  );

  function answer(text: string | null) {
    const entry = current.current;
    if (!entry) return;
    const answers = entry.answers.slice();
    answers[entry.step] = text && text.trim() ? text : null;
    const step = entry.step + 1;
    void save({ ...entry, answers, step, finished: step >= entry.prompts.length });
  }

  async function choose(ids: string[]) {
    await saveActivePrompts(db, ids);
    // A day not started yet takes the new choice at once; a started one keeps its questions.
    if (state.kind === "ready" && !state.saved) await loadToday(ids);
    else setActive(ids);
  }

  return (
    <section className="journal-card" aria-labelledby="daily-check-in" id="daily-check-in-section">
      <JournalHead id="daily-check-in" title="Daily check-in" sub="Today's three questions · 🔒 private" />
      {state.kind === "unreadable" && <p role="alert">{CANT_OPEN}</p>}
      {state.kind === "ready" && state.entry.prompts.length === 0 && (
        <p>No questions are switched on. Choose some under Choose questions.</p>
      )}
      {state.kind === "ready" && state.entry.prompts.length > 0 &&
        (state.entry.finished ? (
          <CheckedIn entry={state.entry} onEdit={(answers) => void save({ ...current.current!, answers })} />
        ) : (
          <Question key={state.entry.step} entry={state.entry} onAnswer={answer} />
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

function Question({ entry, onAnswer }: { entry: Omit<CheckinEntry, "v">; onAnswer: (text: string | null) => void }) {
  const [text, setText] = useState(entry.answers[entry.step] ?? "");
  const last = entry.step === entry.prompts.length - 1;
  const n = entry.prompts.length;
  return (
    <div className="journal-question">
      <div className="journal-dots" role="img" aria-label={`Question ${entry.step + 1} of ${n}`}>
        {entry.prompts.map((_, i) => (
          <span key={i} className={i <= entry.step ? "journal-dot on" : "journal-dot"} />
        ))}
      </div>
      <QuestionText id={entry.prompts[entry.step]!} />
      <textarea
        className="journal-answer"
        aria-label="Your answer"
        placeholder="Anything you like…"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="btn-group journal-question-actions">
        <button type="button" className="btn-secondary" onClick={() => onAnswer(null)}>
          Skip
        </button>
        <button type="button" onClick={() => onAnswer(text)}>
          {last ? "Finish" : "Next →"}
        </button>
      </div>
    </div>
  );
}

/** "Checked in for today", then today's questions and answers, still editable. */
function CheckedIn({ entry, onEdit }: { entry: Omit<CheckinEntry, "v">; onEdit: (answers: (string | null)[]) => void }) {
  const answers = useRef(entry.answers);
  answers.current = entry.answers;
  return (
    <>
      <DoneBox title="Checked in for today" line={CHECKED_IN_LINE} />
      <ol className="journal-answers">
        {entry.prompts.map((id, i) => (
          <li key={id}>
            <QuestionText id={id} />
            <EditableAnswer
              stored={entry.answers[i] ?? ""}
              onSave={async (text) => {
                const next = answers.current.slice();
                next[i] = text.trim() ? text : null;
                answers.current = next;
                onEdit(next);
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
              {c.opened.state === "ok" ? (
                <ol className="journal-answers">
                  {c.opened.entry.prompts.map((id, i) => {
                    const a = c.opened.state === "ok" ? c.opened.entry.answers[i] : null;
                    return (
                      <li key={id}>
                        <QuestionText id={id} />
                        <p className="journal-past-answer">{a ?? <span className="journal-muted">Skipped</span>}</p>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p>{CANT_OPEN}</p>
              )}
            </details>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** Choose questions: the whole bank with a tick each (this device; defaults to her starters). */
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
