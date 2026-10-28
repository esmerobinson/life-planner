import { useContext, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { db } from "../data/db";
import { isValidISODate } from "../domain/dates";
import type { AreaId, ISODate } from "../domain/types";
import {
  importObsidianGoals,
  parseAreaGoals,
  parseHabits,
  parseMonthGoals,
  type ParseNote,
  type ProposedGoal,
  type ProposedTask,
} from "../import/obsidianGoals";
import { GOAL_AREAS } from "./areas";
import { SAVE_ERROR } from "./messages";
import { ShellContext } from "./shellContext";

interface GoalRow {
  p: ProposedGoal;
  selected: boolean;
  exists: boolean;
}
interface TaskRow {
  p: ProposedTask;
  selected: boolean;
  exists: boolean;
}
interface Preview {
  goals: GoalRow[];
  tasks: TaskRow[];
  metrics: { name: string; current: number; target: number }[];
  weekly: string[];
  notes: ParseNote[];
}

function SourceBox({
  name,
  text,
  onText,
}: {
  name: string;
  text: string;
  onText: (t: string) => void;
}) {
  const [error, setError] = useState("");
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      onText(await file.text());
      setError("");
    } catch {
      setError("That file could not be read.");
    }
  }
  return (
    <>
      <label className="form-field">
        <span className="form-label">{`${name} file`}</span>
        <input type="file" accept=".md,.txt" onChange={(e) => void onFile(e)} />
      </label>
      <label className="form-field">
        <span className="form-label">{`${name} text`}</span>
        <textarea value={text} onChange={(e) => onText(e.target.value)} rows={6} />
      </label>
      {error && <p>{error}</p>}
    </>
  );
}

export function ObsidianImportPage({ today }: { today: ISODate }) {
  const shell = useContext(ShellContext);
  const [goalsText, setGoalsText] = useState("");
  const [monthText, setMonthText] = useState("");
  const [habitsText, setHabitsText] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);
  const inFlight = useRef(false);

  async function makePreview() {
    setResult("");
    if (!goalsText.trim() && !monthText.trim() && !habitsText.trim()) {
      setMessage("Paste a note or choose a file first.");
      return;
    }
    setMessage("");
    try {
      const area = parseAreaGoals(goalsText, today);
      const month = parseMonthGoals(monthText, today);
      const habits = parseHabits(habitsText);
      const goalKeys = new Set<string>();
      await db.goals.each((g) => {
        if (g.source?.key) goalKeys.add(g.source.key);
      });
      const itemKeys = new Set<string>();
      await db.items.each((i) => {
        if (i.source?.key) itemKeys.add(i.source.key);
      });
      setPreview({
        goals: [...area.goals, ...month.goals].map((p) => {
          const exists = goalKeys.has(p.key);
          return { p, exists, selected: !exists };
        }),
        tasks: [...month.tasks, ...habits.habits].map((p) => {
          const exists = itemKeys.has(p.key);
          return { p, exists, selected: !exists };
        }),
        metrics: habits.metrics,
        weekly: habits.weekly,
        notes: [...area.notes, ...month.notes, ...habits.notes],
      });
    } catch {
      setMessage("The notes could not be read.");
    }
  }

  function editGoal(i: number, patch: Partial<ProposedGoal>, selected?: boolean) {
    setPreview((pv) =>
      pv && {
        ...pv,
        goals: pv.goals.map((r, n) =>
          n === i ? { ...r, p: { ...r.p, ...patch }, selected: selected ?? r.selected } : r,
        ),
      },
    );
  }

  function editTask(i: number, patch: Partial<ProposedTask>, selected?: boolean) {
    setPreview((pv) =>
      pv && {
        ...pv,
        tasks: pv.tasks.map((r, n) =>
          n === i ? { ...r, p: { ...r.p, ...patch }, selected: selected ?? r.selected } : r,
        ),
      },
    );
  }

  async function addSelected() {
    if (inFlight.current || !preview) return;
    const goals = preview.goals.filter((r) => r.selected && !r.exists).map((r) => r.p);
    const tasks = preview.tasks.filter((r) => r.selected && !r.exists).map((r) => r.p);
    if (goals.some((g) => g.kind === "finite" && !(g.deadline && isValidISODate(g.deadline)))) {
      setMessage("Give each selected goal with a deadline a date first.");
      return;
    }
    setMessage("");
    inFlight.current = true;
    setRunning(true);
    try {
      const r = await importObsidianGoals({ goals, tasks }, today);
      setResult(`Added ${r.goalsAdded} goals and ${r.tasksAdded} tasks, already had ${r.alreadyHad}.`);
      setPreview(null);
      await shell?.refresh();
    } catch {
      setMessage(SAVE_ERROR);
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }

  return (
    <section className="obsidian-import">
      <h1>Import from Obsidian</h1>
      <p>
        Paste or choose any of your notes. You will see what would be added first, and nothing is saved until you
        press Add selected.
      </p>
      <SourceBox name="Goals note" text={goalsText} onText={setGoalsText} />
      <SourceBox name="Monthly note" text={monthText} onText={setMonthText} />
      <SourceBox name="Habits note" text={habitsText} onText={setHabitsText} />
      <div className="form-actions">
        <button type="button" onClick={() => void makePreview()}>
          Preview
        </button>
      </div>
      {message && <p className="form-message">{message}</p>}
      {result && (
        <>
          <p>{result}</p>
          <p>
            <Link className="btn-secondary" to="/goals">
              Back to Goals
            </Link>
          </p>
        </>
      )}
      {preview && (
        <>
          <h2>Preview</h2>
          {preview.goals.length === 0 && preview.tasks.length === 0 && <p>Nothing to add from these notes.</p>}
          {preview.goals.length > 0 && (
            <>
              <h3>Goals</h3>
              <ul aria-label="Proposed goals">
                {preview.goals.map((r, i) => (
                  <li key={r.p.key + i}>
                    <label className="form-check">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.p.title}`}
                        checked={r.selected}
                        disabled={r.exists}
                        onChange={(e) => editGoal(i, {}, e.target.checked)}
                      />
                      {r.p.title}
                    </label>
                    {r.exists ? (
                      <p>Already added</p>
                    ) : (
                      <>
                        <div className="form-row">
                          <label className="form-field">
                            <span className="form-label">Area</span>
                            <select
                              aria-label={`Area for ${r.p.title}`}
                              value={r.p.areaId}
                              onChange={(e) => editGoal(i, { areaId: e.target.value as AreaId, areaFallback: false })}
                            >
                              {GOAL_AREAS.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {r.p.kind === "finite" && (
                            <label className="form-field">
                              <span className="form-label">Deadline</span>
                              <input
                                type="date"
                                aria-label={`Deadline for ${r.p.title}`}
                                value={r.p.deadline ?? ""}
                                onChange={(e) => editGoal(i, { deadline: e.target.value || undefined })}
                              />
                            </label>
                          )}
                        </div>
                        {r.p.areaFallback && <p>No matching area, so Admin is proposed. You can change it.</p>}
                        {r.p.why && r.p.why.split(/\n+/).map((t, n) => <p key={n}>{t}</p>)}
                        {r.p.cadence && r.p.cadence.split(/\n+/).map((t, n) => <p key={n}>{t}</p>)}
                        {r.p.notes && <p>{r.p.notes}</p>}
                        {r.p.milestones.length > 0 && (
                          <ul aria-label={`Milestones for ${r.p.title}`}>
                            {r.p.milestones.map((m, n) => (
                              <li key={n}>{m}</li>
                            ))}
                          </ul>
                        )}
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {preview.tasks.length > 0 && (
            <>
              <h3>Tasks</h3>
              <ul aria-label="Proposed tasks">
                {preview.tasks.map((r, i) => (
                  <li key={r.p.key + i}>
                    <label className="form-check">
                      <input
                        type="checkbox"
                        aria-label={`Select task ${r.p.title}`}
                        checked={r.selected}
                        disabled={r.exists}
                        onChange={(e) => editTask(i, {}, e.target.checked)}
                      />
                      {r.p.title}
                    </label>
                    {r.exists ? (
                      <p>Already added</p>
                    ) : (
                      <label className="form-field">
                        <span className="form-label">Area</span>
                        <select
                          aria-label={`Area for task ${r.p.title}`}
                          value={r.p.areaId}
                          onChange={(e) => editTask(i, { areaId: e.target.value as AreaId })}
                        >
                          {GOAL_AREAS.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {(preview.metrics.length > 0 || preview.weekly.length > 0) && (
            <>
              <h3>Not imported yet</h3>
              <ul aria-label="Information only">
                {preview.metrics.map((m, i) => (
                  <li key={"m" + i}>{`${m.name}: ${m.current} of ${m.target}`}</li>
                ))}
                {preview.weekly.map((w, i) => (
                  <li key={"w" + i}>{w}</li>
                ))}
              </ul>
            </>
          )}
          {preview.notes.length > 0 && (
            <details>
              <summary>{`Notes (${preview.notes.length})`}</summary>
              <ul aria-label="Obsidian import notes">
                {preview.notes.map((n, i) => (
                  <li key={i}>{n.line ? `${n.reason}: ${n.line}` : n.reason}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="form-actions">
            <button type="button" disabled={running} onClick={() => void addSelected()}>
              Add selected
            </button>
          </div>
        </>
      )}
    </section>
  );
}
