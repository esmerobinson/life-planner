import Dexie from "dexie";
import { useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  addRoutineStep, applySuggestedLinks, linkRoutineStep, moveRoutineStep, readRoutine, removeRoutineStep, setRoutineStepDone,
  updateRoutineStep,
} from "../data/dailyRoutineRepo";
import {
  MAX_STEP_MIN, MAX_STEP_TITLE, isLinkableHabit, nextStepId, routineDay, routineSteps, suggestLinks,
  type RoutineRowView, type RoutineStep, type RoutineStepRow, type RoutineTickRow,
} from "../domain/dailyRoutine";
import type { ISODate, Item } from "../domain/types";
import { sheetKeys } from "./ChooseGoalsSheet";
import { REPEAT_GLYPH } from "./IconPopover";
import { useSaveError } from "./messages";
import { ShellContext } from "./shellContext";
import { playTickSparkle } from "./tickSparkle";
import { useHubData } from "./useHubData";
import { AUTOSAVE_MS, useHiddenFlush } from "./useDraft";

/**
 * Every line of "Today's routine" (17 Nov 2026). PROVISIONAL WORDING, for Esme and the Design
 * session: kept in one place so it can be reworded at once.
 */
export const ROUTINE_HOME_WORDS = {
  heading: "Today's routine",
  listLabel: "Next steps",
  count: (done: number, total: number) => `${done} of ${total} today`,
  minimum: (min: string) => `Minimum: ${min}`,
  linked: (habit: string) => `Linked to: ${habit}`,
  more: (n: number) => `More steps (${n})`,
  /** Not "Done today": Today's list above has a fold of that name. "Done (N)" is the area pages' wording. */
  doneFold: (n: number) => `Done (${n})`,
  empty: "No steps yet.",
  edit: "Edit routine",
  editHeading: "Edit routine",
  editHint: "Changes save as you go. Ticking a step's minimum counts fully.",
  stepLabel: "Step",
  minLabel: "Minimum",
  linkLabel: "Linked habit",
  notLinked: "Not linked",
  /** The linked habit is archived, in the Bin or no longer repeating. */
  goneHabit: "A habit that's no longer active",
  up: (title: string) => `Move up: ${title}`,
  down: (title: string) => `Move down: ${title}`,
  remove: (title: string) => `Remove: ${title}`,
  removeText: "Remove",
  newStep: "A new step",
  add: "Add",
  close: "Done",
};
const W = ROUTINE_HOME_WORDS;


/** The routine's rows (steps and today's ticks), re-read on any change here, in another tab or from sync. */
function useRoutineRows(today: ISODate) {
  const [rows, setRows] = useState<{ steps: RoutineStepRow[]; ticks: RoutineTickRow[] } | null>(null);
  const latest = useRef(0);
  const refresh = useCallback(async () => {
    const id = ++latest.current;
    try {
      const r = await readRoutine(today);
      if (id === latest.current) setRows(r);
    } catch {
      // A failed read leaves what was shown; the next change reads again.
    }
  }, [today]);
  const version = useContext(ShellContext)?.version ?? 0;
  useEffect(() => {
    void refresh();
    const onMutated = () => void refresh();
    Dexie.on.storagemutated.subscribe(onMutated);
    return () => {
      latest.current++;
      Dexie.on.storagemutated.unsubscribe(onMutated);
    };
  }, [refresh, version]);
  return { rows, refresh };
}

/**
 * "Today's routine" (Esme approved, 17 Nov 2026), on Home directly under the goals: her daily
 * steps, each with its minimum (which counts fully). A step can be linked to a habit: ticking
 * the step ticks the habit for today, and the other way round. The next step is highlighted;
 * finished steps fold into "Done" and later ones into "More steps", so it stays compact.
 * Nothing turns red and nothing says missed.
 */
export function DailyRoutine({ today, headingLevel = 3 }: { today: ISODate; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const headingId = useId();
  const { items, loaded, refresh: refreshItems } = useHubData(today);
  const { rows, refresh } = useRoutineRows(today);
  const { attempt, saveError } = useSaveError();
  const shell = useContext(ShellContext);
  const [editing, setEditing] = useState(false);
  // A box shows its new state at once; the re-read confirms it (a failed save puts it back).
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const section = useRef<HTMLElement>(null);

  const steps = useMemo(() => routineSteps(rows?.steps ?? []), [rows]);
  const day = useMemo(() => routineDay(steps, items, rows?.ticks ?? [], today), [steps, items, rows, today]);

  // First view (and whenever a matching habit turns up): link the obvious steps to her habits.
  // Tried again on every change while one is waiting (a new device stores none until its first
  // full sync); re-read only when one was stored, so this never loops.
  const suggest = loaded && rows !== null && suggestLinks(steps, items).length > 0;
  useEffect(() => {
    if (suggest) void applySuggestedLinks().then((n) => (n > 0 ? refresh() : undefined), () => undefined);
  }, [suggest, refresh, rows, items]);

  async function changed() {
    await Promise.all([refresh(), refreshItems()]);
    await shell?.refresh();
  }

  async function setDone(row: RoutineRowView, done: boolean, box: HTMLInputElement) {
    const was = box.getBoundingClientRect();
    const focused = document.activeElement === box;
    setPending((p) => ({ ...p, [row.step.id]: done }));
    const ok = await attempt(() => setRoutineStepDone(row.step.id, today, done));
    if (ok && done) playTickSparkle(box.isConnected ? box : was); // unticking plays nothing
    if (ok) await changed();
    setPending(({ [row.step.id]: _drop, ...rest }) => rest);
    // The ticked strip moves to another list: keep the keyboard on the routine (review M4), on
    // the next step's box, else on Edit routine.
    if (focused) {
      requestAnimationFrame(() => {
        const at = section.current;
        const to = at?.querySelector<HTMLElement>('[aria-current="step"] input') ?? at?.querySelector<HTMLElement>(".routine-edit-link button");
        to?.focus();
      });
    }
  }

  if (rows === null) return null;

  const view = day.rows.map((r) => (r.step.id in pending ? { ...r, done: pending[r.step.id]! } : r));
  const next = nextStepId(view);
  const open = view.filter((r) => !r.done);
  // Only the next step in full; the rest fold away as one-line titles (review I3: Home must not
  // scroll more than before; the coordinator's provisional call, for Design).
  const shown = open.filter((r) => r.step.id === next);
  const more = open.filter((r) => r.step.id !== next);
  const done = view.filter((r) => r.done);
  const strip = (r: RoutineRowView) => (
    <RoutineStrip key={r.step.id} row={r} next={r.step.id === next} onDone={(d, box) => void setDone(r, d, box)} />
  );

  return (
    <section ref={section} className="routine-home" aria-labelledby={headingId}>
      <div className="routine-top">
        <Heading id={headingId}>{W.heading}</Heading>
        {day.total > 0 && <span className="routine-count">{W.count(done.length, day.total)}</span>}
      </div>
      {saveError && <p className="form-message">{saveError}</p>}
      {day.total === 0 && <p>{W.empty}</p>}
      {shown.length > 0 && (
        <ul className="strip-list routine-list" aria-label={W.listLabel}>
          {shown.map(strip)}
        </ul>
      )}
      {more.length > 0 && (
        <details className="routine-more">
          <summary>{W.more(more.length)}</summary>
          <ul className="strip-list routine-list">{more.map(strip)}</ul>
        </details>
      )}
      {done.length > 0 && (
        <details className="done-fold routine-done">
          <summary>{W.doneFold(done.length)}</summary>
          <ul className="strip-list routine-list">{done.map(strip)}</ul>
        </details>
      )}
      <p className="routine-edit-link">
        <button type="button" className="quiet-link" aria-haspopup="dialog" onClick={() => setEditing(true)}>
          {W.edit}
        </button>
      </p>
      {editing && <EditRoutineSheet steps={steps} items={items} onChanged={changed} onClose={() => setEditing(false)} />}
    </section>
  );
}

/**
 * One step: the strips' tick box and the title (with the habit symbol when linked). The next step
 * also shows its minimum and its link; every other step is its title on one line.
 */
function RoutineStrip({ row, next, onDone }: { row: RoutineRowView; next: boolean; onDone: (done: boolean, box: HTMLInputElement) => void }) {
  const { step, habit, done } = row;
  return (
    <li
      className={["strip", "routine-step", next ? "routine-next" : "routine-compact", done ? "crossed" : ""].filter(Boolean).join(" ")}
      aria-current={next ? "step" : undefined}
    >
      <input
        type="checkbox"
        className="tick"
        aria-label={done ? `Done: ${step.title}` : `Mark done: ${step.title}`}
        checked={done}
        onChange={(e) => onDone(e.currentTarget.checked, e.currentTarget)}
      />
      <div className="strip-body">
        <div className="strip-title">
          {habit && (
            <span className="strip-glyph" aria-hidden="true">
              {REPEAT_GLYPH}
            </span>
          )}
          {step.title}
        </div>
        {next && step.min && <div className="strip-meta">{W.minimum(step.min)}</div>}
        {next && habit && <div className="strip-meta">{W.linked(habit.title)}</div>}
      </div>
    </li>
  );
}

/**
 * Edit routine, as a pop-up sheet (the Choose goals sheet's frame: Done, Escape or a click on
 * the dimmed page closes it). Each step: its title, its minimum, the habit it's linked to, move
 * up / down, remove. A new step at the bottom. Everything saves as she goes: typing saves after a
 * pause, and whatever is still unsaved saves however the sheet closes (review I2).
 */
function EditRoutineSheet({
  steps, items, onChanged, onClose,
}: { steps: RoutineStep[]; items: Item[]; onChanged: () => Promise<void>; onClose: () => void }) {
  const { attempt, saveError } = useSaveError();
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const headingId = useId();
  const [adding, setAdding] = useState("");
  const habits = useMemo(() => items.filter(isLinkableHabit).sort((a, b) => a.title.localeCompare(b.title)), [items]);

  useEffect(() => {
    opener.current = document.activeElement;
    sheet.current?.focus();
    return () => {
      const back = opener.current as HTMLElement | null;
      if (back && back.isConnected && typeof back.focus === "function") back.focus();
    };
  }, []);

  async function save(fn: () => Promise<unknown>) {
    if (await attempt(fn)) await onChanged();
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (adding.trim() === "") return;
    const title = adding;
    setAdding("");
    await save(() => addRoutineStep(title));
  }

  return (
    <div
      className="choose-shade"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheet}
        className="choose-sheet routine-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onKeyDown={(e) => sheetKeys(e, sheet.current, onClose)}
      >
        <div className="choose-top">
          <div>
            <h2 id={headingId}>{W.editHeading}</h2>
            <div className="choose-muted">{W.editHint}</div>
          </div>
          <button type="button" onClick={onClose}>
            {W.close}
          </button>
        </div>
        {saveError && <p className="form-message">{saveError}</p>}
        <ol className="routine-edit-list">
          {steps.map((s, i) => (
            <EditStep
              key={s.id}
              step={s}
              habits={habits}
              first={i === 0}
              last={i === steps.length - 1}
              save={save}
            />
          ))}
        </ol>
        <form className="routine-add" onSubmit={(e) => void add(e)}>
          <input
            type="text"
            aria-label={W.newStep}
            placeholder={W.newStep}
            maxLength={MAX_STEP_TITLE}
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
          />
          <button type="submit">{W.add}</button>
        </form>
      </div>
    </div>
  );
}

function EditStep({
  step, habits, first, last, save,
}: { step: RoutineStep; habits: Item[]; first: boolean; last: boolean; save: (fn: () => Promise<unknown>) => Promise<void> }) {
  const [title, setTitle] = useState(step.title);
  const [min, setMin] = useState(step.min);
  /** What she has typed, and what is stored (or on its way): the difference is unsaved. */
  const draft = useRef({ title: step.title, min: step.min });
  const sent = useRef({ title: step.title, min: step.min });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef({ save, id: step.id });
  latest.current = { save, id: step.id };

  /** Saves whatever is unsaved now. A blank title is never saved (a step keeps its title). */
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const t = draft.current.title.trim();
    const m = draft.current.min.trim();
    const change = {
      ...(t !== "" && t !== sent.current.title ? { title: t } : {}),
      ...(m !== sent.current.min ? { min: m } : {}),
    };
    if (Object.keys(change).length === 0) return;
    sent.current = { title: change.title ?? sent.current.title, min: change.min ?? sent.current.min };
    const { save: run, id } = latest.current;
    void run(() => updateRoutineStep(id, change));
  }, []);
  useHiddenFlush(flush); // the app hidden or closed
  useEffect(() => () => flush(), [flush]); // the sheet closed any way at all, or she went elsewhere

  // A change stored elsewhere shows here, unless she is typing in that box.
  const adopt = (key: "title" | "min", stored: string, set: (v: string) => void) => {
    const mine = draft.current[key].trim();
    const dirty = mine !== sent.current[key];
    sent.current[key] = stored;
    if (!dirty && mine !== stored) {
      draft.current[key] = stored;
      set(stored);
    }
  };
  useEffect(() => adopt("title", step.title, setTitle), [step.title]);
  useEffect(() => adopt("min", step.min, setMin), [step.min]);

  const typed = (key: "title" | "min", v: string, set: (v: string) => void) => {
    draft.current[key] = v;
    set(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  };
  function leaveTitle() {
    flush();
    if (draft.current.title.trim() === "") {
      draft.current.title = sent.current.title; // a step keeps its title
      setTitle(sent.current.title);
    }
  }
  const enterBlurs = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };
  const live = typeof step.habitId === "string" && habits.some((h) => h.id === step.habitId);
  // A link to a habit that's gone shows as such, so "Not linked" really unlinks it (review M3).
  const stale = typeof step.habitId === "string" && !live ? step.habitId : null;
  const linked = typeof step.habitId === "string" ? step.habitId : "";

  return (
    <li className="routine-edit-step">
      <label>
        <span>{W.stepLabel}</span>
        <input type="text" value={title} maxLength={MAX_STEP_TITLE} onChange={(e) => typed("title", e.target.value, setTitle)} onBlur={leaveTitle} onKeyDown={enterBlurs} />
      </label>
      <label>
        <span>{W.minLabel}</span>
        <input type="text" value={min} maxLength={MAX_STEP_MIN} onChange={(e) => typed("min", e.target.value, setMin)} onBlur={flush} onKeyDown={enterBlurs} />
      </label>
      <label>
        <span>{W.linkLabel}</span>
        <select
          value={linked}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            const v = e.target.value;
            void save(() => linkRoutineStep(step.id, v === "" ? null : v));
          }}
        >
          <option value="">{W.notLinked}</option>
          {stale && <option value={stale}>{W.goneHabit}</option>}
          {habits.map((h) => (
            <option key={h.id} value={h.id}>
              {h.title}
            </option>
          ))}
        </select>
      </label>
      <div className="routine-edit-actions">
        <button type="button" aria-label={W.up(step.title)} disabled={first} onClick={() => void save(() => moveRoutineStep(step.id, -1))}>
          ↑
        </button>
        <button type="button" aria-label={W.down(step.title)} disabled={last} onClick={() => void save(() => moveRoutineStep(step.id, 1))}>
          ↓
        </button>
        <button type="button" aria-label={W.remove(step.title)} onClick={() => void save(() => removeRoutineStep(step.id))}>
          {W.removeText}
        </button>
      </div>
    </li>
  );
}

/**
 * Today's routine count for one day, as a small muted line (the daily log shows it under "Stuck
 * to my daily schedule?" as a hint: it never answers for her). Nothing while loading.
 */
export function RoutineCountHint({ date, words }: { date: ISODate; words: (done: number, total: number) => string }) {
  const { items, loaded } = useHubData(date);
  const { rows } = useRoutineRows(date);
  if (!loaded || rows === null) return null;
  const day = routineDay(routineSteps(rows.steps), items, rows.ticks, date);
  return day.total > 0 ? <p className="journal-muted routine-hint">{words(day.done, day.total)}</p> : null;
}
