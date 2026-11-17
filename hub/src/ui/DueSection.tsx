import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_DUE_PREFS, isLine, MAX_LEAD_MINUTES, MAX_LINE_LENGTH, MAX_LINES, type DuePrefs } from "../reminders/duePrefs";
import { loadDuePrefs, saveDuePrefs } from "../reminders/dueSettings";

// Reminders in Due (2026-11-16): the settings the sync Worker reads to put her reminders into
// Due, her partner's reminders app. PLACEHOLDER LOOK (magenta, system font: reminders.css
// .due-section) and PROVISIONAL WORDING: both hers to decide.

/** Every line of this section's words, in one place, so they can be reworded at once. */
export const DUE_WORDS = {
  heading: "Reminders in Due",
  intro: "Esmeworld can put your reminders into Due. They change by themselves as you tick things off.",
  stored:
    "Stored on Due's server: the reminder titles (your to-do and habit titles, “Plan your day”, “Review your day”) and your motivation lines. Nothing from your journal is ever sent.",
  when: "Changes reach Due after Esmeworld syncs, within about 15 minutes.",
  toggle: "Reminders in Due",
  plan: "Plan your day",
  review: "Review your day",
  dueFirst: "Due today and not done",
  dueSecond: "Still not done",
  nudge: "Nudge if nothing's ticked off",
  lead: "Minutes before a timed to-do",
  timeZone: "Time zone",
  linesHeading: "Your motivation lines",
  linesHelp: "One goes with the nudge each day, in turn. Without any, Due says a gentle line of its own.",
  newLine: "New motivation line",
  addLine: "Add line",
  saveFailed: "That change wasn't saved. Try again.",
  readFailed: "Your Due settings couldn't be read.",
} as const;

const TIME_ROWS = [
  ["plan", DUE_WORDS.plan],
  ["review", DUE_WORDS.review],
  ["dueFirst", DUE_WORDS.dueFirst],
  ["dueSecond", DUE_WORDS.dueSecond],
  ["nudge", DUE_WORDS.nudge],
] as const;

/**
 * A short list of zones (home, and places she might be), plus whichever one is saved. A full
 * list is ~400 entries; this one is PROVISIONAL, easy to extend.
 */
export const ZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Sao_Paulo",
  "Europe/London", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin", "Asia/Tokyo", "Australia/Sydney", "UTC",
];

function zones(current: string): string[] {
  return ZONES.includes(current) ? ZONES : [current, ...ZONES];
}

export function DueSection() {
  const [prefs, setPrefs] = useState<DuePrefs | null>(null);
  const [problem, setProblem] = useState("");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    let live = true;
    loadDuePrefs().then(
      (p) => live && setPrefs(p),
      () => {
        if (!live) return;
        setPrefs(DEFAULT_DUE_PREFS);
        setProblem(DUE_WORDS.readFailed);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  // The latest settings shown, so quick changes in a row build on each other (never on a
  // stale copy), and saves are written in the order they were made.
  const latest = useRef<DuePrefs | null>(null);
  latest.current = prefs;
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const set = useCallback((patch: Partial<DuePrefs>) => {
    if (!latest.current) return;
    const next = { ...latest.current, ...patch };
    latest.current = next;
    setPrefs(next);
    queue.current = queue.current.then(() =>
      saveDuePrefs(next).then(
        () => setProblem(""),
        () => setProblem(DUE_WORDS.saveFailed),
      ),
    );
  }, []);

  if (!prefs) return null;
  const addLine = () => {
    const line = draft.trim();
    if (!isLine(line) || prefs.lines.length >= MAX_LINES) return;
    setDraft("");
    set({ lines: [...prefs.lines, line] });
  };

  return (
    <section className="due-section" aria-labelledby="due-heading">
      <h2 id="due-heading">{DUE_WORDS.heading}</h2>
      <p>{DUE_WORDS.intro}</p>
      <p role="note">{DUE_WORDS.stored}</p>
      <button type="button" aria-pressed={prefs.on} onClick={() => set({ on: !prefs.on })}>
        {`${DUE_WORDS.toggle}: ${prefs.on ? "On" : "Off"}`}
      </button>
      <div className="due-fields">
        {TIME_ROWS.map(([key, label]) => (
          <label key={key}>
            {label}{" "}
            <input
              type="time"
              required
              value={prefs[key]}
              onChange={(e) => {
                if (/^\d{2}:\d{2}$/.test(e.target.value)) set({ [key]: e.target.value });
              }}
            />
          </label>
        ))}
        <label>
          {DUE_WORDS.lead}{" "}
          <input
            type="number"
            min={0}
            max={MAX_LEAD_MINUTES}
            step={1}
            value={prefs.leadMinutes}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (e.target.value !== "" && Number.isInteger(n) && n >= 0 && n <= MAX_LEAD_MINUTES) set({ leadMinutes: n });
            }}
          />
        </label>
        <label>
          {DUE_WORDS.timeZone}{" "}
          <select value={prefs.timeZone} onChange={(e) => set({ timeZone: e.target.value })}>
            {zones(prefs.timeZone).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
      </div>
      <h3>{DUE_WORDS.linesHeading}</h3>
      <p>{DUE_WORDS.linesHelp}</p>
      <ul aria-label={DUE_WORDS.linesHeading}>
        {prefs.lines.map((line, i) => (
          <li key={`${i}:${line}`}>
            <span>{line}</span>{" "}
            <button
              type="button"
              aria-label={`Remove line: ${line}`}
              onClick={() => set({ lines: prefs.lines.filter((_, j) => j !== i) })}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {prefs.lines.length < MAX_LINES && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            addLine();
          }}
        >
          <input
            type="text"
            aria-label={DUE_WORDS.newLine}
            maxLength={MAX_LINE_LENGTH}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />{" "}
          <button type="submit" disabled={!draft.trim()}>
            {DUE_WORDS.addLine}
          </button>
        </form>
      )}
      <p>{DUE_WORDS.when}</p>
      {problem && <p role="alert">{problem}</p>}
    </section>
  );
}
