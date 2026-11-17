import { liveQuery } from "dexie";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  readDayLog, readWeekReview, removeDayLogVersion, removeWeekReviewVersion, saveDayLog, saveWeekReview, weekOf,
  type DayLogFields, type FormDay, type FormSession, type FormVersion, type WeekReviewFields,
} from "../../data/repo";
import { ownDevices } from "../../data/deviceIds";
import { WEEKDAYS, type ISODate } from "../../domain/types";
import type { JournalKey } from "../../journal/crypto";
import {
  CHOICES, DAY_LOG_RULES, dayLogFields, isReviewDay, MAX_LOG_NOTE, MAX_REVIEW_TEXT, WEEK_REVIEW_RULES, weekReviewFields,
  type Choice, type FormRules,
} from "../../journal/routine";
import { AUTOSAVE_MS, useDraft } from "../useDraft";
import { DoneBox } from "./bits";
import { ROUTINE_WORDS as W, WEEKDAY_NAMES } from "./routineWording";
import "./routine.css";

// PLACEHOLDER look and placement (nothing here is designed: magenta, the system font, no easing):
// the daily log under the Daily check-in, the weekly review under "what I learned" on the Mental
// health exercise tab. The Design session decides the real look; nothing here is a choice.
//
// Airtight like the learned words: saved sealed as she goes (a pause in typing, a choice tapped,
// leaving a box, hiding the app, leaving the page), shown again after a reload, Done shows it done
// with Edit, and a version from another device is never cleared silently (use it, or remove it
// once she confirms).

interface FormSpec<F> {
  rules: FormRules<F>;
  normalise: (f: F) => F;
  save: (jk: JournalKey, deviceId: string, fields: F, session: FormSession) => Promise<string>;
  remove: (jk: JournalKey, deviceId: string, v: FormVersion<F>) => Promise<string>;
  Fields: (p: { value: F; set: (f: F, now?: boolean) => void; flush: () => void }) => ReactNode;
  View: (p: { fields: F }) => ReactNode;
  doneTitle: string;
}

const DAY_LOG_SPEC: FormSpec<DayLogFields> = {
  rules: DAY_LOG_RULES,
  normalise: dayLogFields,
  save: saveDayLog,
  remove: removeDayLogVersion,
  Fields: DayLogBoxes,
  View: DayLogView,
  doneTitle: W.logDone,
};

const DAY_LOG_YESTERDAY: FormSpec<DayLogFields> = { ...DAY_LOG_SPEC, doneTitle: W.logDoneYesterday };

const WEEK_REVIEW_SPEC: FormSpec<WeekReviewFields> = {
  rules: WEEK_REVIEW_RULES,
  normalise: weekReviewFields,
  save: saveWeekReview,
  remove: removeWeekReviewVersion,
  Fields: WeekReviewBoxes,
  View: WeekReviewView,
  doneTitle: W.reviewDone,
};

/** The day's (or week's) form, re-read whenever the journal changes (sync, another tab). */
function useForm<F>(read: () => Promise<FormDay<F>>, deps: unknown[]): FormDay<F> | null {
  const [day, setDay] = useState<FormDay<F> | null>(null);
  useEffect(() => {
    setDay(null);
    const sub = liveQuery(read).subscribe({ next: setDay, error: () => undefined });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return day;
}

/**
 * The daily log for `date`: today's (the app's day runs to 3am), or yesterday's (`yesterday`),
 * which she can still change until it is final (review I4). Yesterday's is folded until opened or
 * until something is in it.
 */
export function DailyLog({ jk, date, deviceId, yesterday = false, extra }: { jk: JournalKey; date: ISODate; deviceId: string; yesterday?: boolean; extra?: (day: FormDay<DayLogFields>) => ReactNode }) {
  const day = useForm(() => readDayLog(jk, date), [jk, date]);
  const started = !!day && (day.id !== "" || day.others.length > 0);
  return (
    <Folded
      label={yesterday ? W.logSectionYesterday : W.logSection}
      heading={yesterday ? W.logHeadingYesterday : W.logHeading}
      fold={yesterday && !started}
      line={yesterday ? W.logYesterdayLine : undefined}
    >
      {day && <FormBox key={date} jk={jk} deviceId={deviceId} day={day} newDate={date} spec={yesterday ? DAY_LOG_YESTERDAY : DAY_LOG_SPEC} />}
      {day && extra?.(day)}
    </Folded>
  );
}

/**
 * The weekly review of `today`'s week (Monday to Sunday): open on Sundays; folded the rest of the
 * week until something is in it (so she can still do it if she misses Sunday).
 */
export function WeeklyReview({ jk, today, deviceId }: { jk: JournalKey; today: ISODate; deviceId: string }) {
  const week = weekOf(today);
  const day = useForm(() => readWeekReview(jk, today), [jk, week]);
  const sunday = isReviewDay(today);
  const started = !!day && (day.id !== "" || day.others.length > 0);
  return (
    <Folded label={W.reviewSection} heading={sunday ? W.reviewHeadingSunday : W.reviewHeadingWeek} fold={!sunday && !started}>
      {day && <FormBox key={week} jk={jk} deviceId={deviceId} day={day} newDate={today} spec={WEEK_REVIEW_SPEC} />}
    </Folded>
  );
}

/**
 * A section whose box is always in the same place in the tree (review I3: folding or unfolding,
 * or something being saved, never rebuilds the box, so focus and every key typed are kept). While
 * `fold`, its heading is a button that shows or hides the box.
 */
function Folded({ label, heading, fold, line, children }: { label: string; heading: string; fold: boolean; line?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const shown = !fold || open;
  return (
    <section className="routine-placeholder" aria-label={label}>
      {fold ? (
        <button type="button" className="routine-fold" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {heading}
        </button>
      ) : (
        <h3>{heading}</h3>
      )}
      <div hidden={!shown}>
        {line && <p className="journal-muted">{line}</p>}
        {children}
      </div>
    </section>
  );
}

/**
 * The box. A session starts at the first change to a box with nothing unsaved: it writes one new
 * version (its own row, rewritten as she goes on) that replaces only the version the box held when
 * she started. Saves go one at a time.
 */
function FormBox<F extends object>({
  jk, deviceId, day, newDate, spec,
}: { jk: JournalKey; deviceId: string; day: FormDay<F>; newDate: ISODate; spec: FormSpec<F> }) {
  const [ids, setIds] = useState<string[]>([deviceId]);
  useEffect(() => {
    let live = true;
    void ownDevices(deviceId).then((o) => live && setIds([deviceId, o.current, ...o.former]), () => undefined);
    return () => {
      live = false;
    };
  }, [deviceId]);
  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState("");
  const session = useRef<FormSession | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // What this box last queued for its own row. While the version shown is that row (or its first
  // save is still on its way), that is what the box holds: a re-read that lands late (an earlier
  // save of the same row) never takes back a tap made since (two quick taps, then Done, keep both).
  const queued = useRef<{ session: FormSession; text: string } | null>(null);
  const cur = session.current;
  const own = !!queued.current && queued.current.session === cur && (cur.version === undefined || day.id === cur.version);
  const stored = own ? queued.current!.text : JSON.stringify(spec.normalise(day.fields));
  // Every new session is filed under the box's day (today for the review): a review belongs to the
  // day she pressed Done, or while not done the day she last edited it (review C1).
  const fresh = (): FormSession => ({ date: newDate, seen: [...day.seen], submittedAt: day.submittedAt, doneOn: day.doneOn });

  const enqueue = (fields: F) => {
    const s = session.current ?? (session.current = fresh());
    queued.current = { session: s, text: JSON.stringify(spec.normalise(fields)) };
    const run = queue.current.then(async () => {
      try {
        s.version = await spec.save(jk, deviceId, fields, s);
        setProblem("");
      } catch (e) {
        if (queued.current?.session === s) queued.current = null; // what is stored shows again
        setProblem(e instanceof Error && e.message ? e.message : W.saveProblem);
        throw e;
      }
    });
    queue.current = run.catch(() => undefined);
    return run;
  };
  const draft = useDraft(stored, (text) => enqueue(JSON.parse(text) as F), AUTOSAVE_MS);
  const value = JSON.parse(draft.value) as F;

  function begin() {
    // Nothing unsaved and the box holds a version this session didn't write: a new session.
    if (draft.value === stored && (!session.current || session.current.version !== day.id)) session.current = fresh();
  }
  function set(f: F, now = false) {
    begin();
    draft.set(JSON.stringify(spec.normalise(f)));
    if (now) draft.flush();
  }
  /** Done (or Save after Edit): saved now, done from then on. */
  async function done() {
    begin();
    const s = session.current ?? (session.current = fresh());
    draft.flush();
    if (s.submittedAt === null) s.submittedAt = Date.now();
    try {
      await enqueue(JSON.parse(draft.value) as F);
      setEditing(false);
    } catch {
      /* the problem line says so; the answers stay in the box */
    }
  }
  /**
   * "Use these answers": they go into the box as a new version that replaces both that version and
   * the one the box held, so one version is left and the day is settled (review I4). She chose it;
   * Done stays if either was done (review M6).
   */
  async function use(v: FormVersion<F>) {
    const prev = session.current;
    draft.flush();
    await queue.current; // anything typed is saved first
    // The box's own session row by its bare id (only this device ever writes it, and never again).
    const seen = [...new Set([...v.seen, ...day.seen, ...(prev?.version ? [prev.version] : [])])];
    session.current = { date: newDate, seen, submittedAt: v.submittedAt ?? day.submittedAt, doneOn: v.doneOn ?? day.doneOn };
    const before = draft.value;
    const text = JSON.stringify(spec.normalise(v.fields));
    draft.set(text);
    draft.flush();
    if (text === before) await enqueue(v.fields); // the same answers: still one version written
  }
  async function remove(v: FormVersion<F>) {
    try {
      await spec.remove(jk, deviceId, v);
      setProblem("");
    } catch {
      setProblem(W.saveProblem);
    }
  }

  const Fields = spec.Fields;
  const View = spec.View;
  return (
    <>
      {day.done && !editing ? (
        <div className="routine-done">
          <DoneBox title={spec.doneTitle} />
          <View fields={day.fields} />
          <button type="button" className="btn-secondary" onClick={() => setEditing(true)}>
            {W.edit}
          </button>
        </div>
      ) : (
        <div className="routine-box">
          <Fields value={value} set={set} flush={draft.flush} />
          <button type="button" disabled={!spec.rules.filled(value)} onClick={() => void done()}>
            {editing ? W.save : W.done}
          </button>
        </div>
      )}
      {problem && <p role="alert">{problem}</p>}
      <OtherVersions versions={day.others} mine={(d) => ids.includes(d)} View={View} onUse={(v) => void use(v)} onRemove={remove} />
    </>
  );
}

function OtherVersions<F>({
  versions, mine, View, onUse, onRemove,
}: {
  versions: FormVersion<F>[];
  mine: (device: string) => boolean;
  View: (p: { fields: F }) => ReactNode;
  onUse: (v: FormVersion<F>) => void;
  onRemove: (v: FormVersion<F>) => Promise<void>;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  return (
    <>
      {versions.map((v) => (
        <div key={v.id} className="routine-other">
          <p>{mine(v.device) ? W.earlierHere : W.otherDevice}</p>
          <View fields={v.fields} />
          {asking === v.id ? (
            <div role="group" aria-label={W.removeAsk}>
              <p>{W.removeAsk}</p>
              <button type="button" onClick={() => void onRemove(v).then(() => setAsking(null))}>
                {W.removeYes}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setAsking(null)}>
                {W.removeNo}
              </button>
            </div>
          ) : (
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => onUse(v)}>
                {W.useThese}
              </button>
              <button type="button" className="btn-secondary" onClick={() => setAsking(v.id)}>
                {W.remove}
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  );
}

// ---- the daily log's boxes and how it reads -----------------------------------------------------

function ChoiceButtons({ label, value, onPick }: { label: string; value: Choice | null; onPick: (c: Choice | null) => void }) {
  return (
    <div role="group" aria-label={label} className="routine-choices">
      <p className="journal-q">{label}</p>
      {CHOICES.map((c) => (
        <button key={c} type="button" aria-pressed={value === c} onClick={() => onPick(value === c ? null : c)}>
          {W.choice[c]}
        </button>
      ))}
    </div>
  );
}

function NoteBox({ label, value, max, onChange, onBlur, hint }: { label: string; value: string; max: number; onChange: (t: string) => void; onBlur: () => void; hint?: string }) {
  return (
    <label className="form-field">
      <span className="form-label">{label}</span>
      <textarea rows={2} maxLength={max} value={value} placeholder={hint} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} />
    </label>
  );
}

function DayLogBoxes({ value, set, flush }: { value: DayLogFields; set: (f: DayLogFields, now?: boolean) => void; flush: () => void }) {
  return (
    <>
      <ChoiceButtons label={W.schedule} value={value.schedule} onPick={(c) => set({ ...value, schedule: c }, true)} />
      <NoteBox label={W.scheduleNote} value={value.scheduleNote} max={MAX_LOG_NOTE} onChange={(t) => set({ ...value, scheduleNote: t })} onBlur={flush} />
      <ChoiceButtons label={W.todos} value={value.todos} onPick={(c) => set({ ...value, todos: c }, true)} />
      <NoteBox label={W.todosNote} value={value.todosNote} max={MAX_LOG_NOTE} onChange={(t) => set({ ...value, todosNote: t })} onBlur={flush} />
    </>
  );
}

const answer = (text: string | null | undefined) =>
  text && text.trim() !== "" ? <p className="journal-past-answer">{text}</p> : <p className="journal-muted">{W.notAnswered}</p>;

/** A daily log, read-only: each question with her answer and note. */
export function DayLogView({ fields }: { fields: DayLogFields }) {
  const rows: [string, Choice | null, string][] = [
    [W.schedule, fields.schedule, fields.scheduleNote],
    [W.todos, fields.todos, fields.todosNote],
  ];
  return (
    <ol className="journal-answers routine-answers">
      {rows.map(([q, c, note]) => (
        <li key={q}>
          <p className="journal-q">{q}</p>
          {answer(c && W.choice[c])}
          {note.trim() !== "" && <p className="journal-past-answer routine-note">{note}</p>}
        </li>
      ))}
    </ol>
  );
}

// ---- the weekly review's boxes and how it reads -------------------------------------------------

function WeekReviewBoxes({ value, set, flush }: { value: WeekReviewFields; set: (f: WeekReviewFields, now?: boolean) => void; flush: () => void }) {
  return (
    <>
      <NoteBox label={W.well} value={value.well} max={MAX_REVIEW_TEXT} onChange={(t) => set({ ...value, well: t })} onBlur={flush} />
      <NoteBox label={W.inWay} value={value.inWay} max={MAX_REVIEW_TEXT} onChange={(t) => set({ ...value, inWay: t })} onBlur={flush} />
      <div role="group" aria-label={W.values} className="routine-choices">
        <p className="journal-q">{W.values}</p>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" aria-pressed={value.values === n} onClick={() => set({ ...value, values: value.values === n ? null : n }, true)}>
            {n}
          </button>
        ))}
      </div>
      <NoteBox label={W.ifThen} hint={W.ifThenHint} value={value.ifThen} max={MAX_REVIEW_TEXT} onChange={(t) => set({ ...value, ifThen: t })} onBlur={flush} />
      <fieldset className="routine-days">
        <legend className="journal-q">{W.minDays}</legend>
        {WEEKDAYS.map((d) => (
          <label key={d}>
            <input
              type="checkbox"
              checked={value.minDays.includes(d)}
              onChange={(e) => set({ ...value, minDays: e.target.checked ? [...value.minDays, d] : value.minDays.filter((x) => x !== d) }, true)}
            />
            {WEEKDAY_NAMES[d]}
          </label>
        ))}
      </fieldset>
    </>
  );
}

/** A weekly review, read-only: each question with her answer. */
export function WeekReviewView({ fields }: { fields: WeekReviewFields }) {
  const rows: [string, string][] = [
    [W.well, fields.well],
    [W.inWay, fields.inWay],
    [W.values, fields.values === null ? "" : `${fields.values} out of 10`],
    [W.ifThen, fields.ifThen],
    [W.minDays, weekReviewFields(fields).minDays.map((d) => WEEKDAY_NAMES[d]).join(", ")],
  ];
  return (
    <ol className="journal-answers routine-answers">
      {rows.map(([q, a]) => (
        <li key={q}>
          <p className="journal-q">{q}</p>
          {answer(a)}
        </li>
      ))}
    </ol>
  );
}
