import { useContext, useEffect, useRef, useState } from "react";
import { isActive } from "../domain/goalCounts";
import { createBook, createGoal, createItem, listGoals } from "../data/repo";
import { BOOK_AREA, BOOK_LIMITS, BOOK_STATUSES, BOOK_STATUS_LABEL, type BookStatus } from "../domain/books";
import { MAX_GOAL_NOTES, MAX_NOTES_TEXT } from "../data/validate";
import { DEFAULT_SESSIONS, MAX_SESSIONS, MIN_SESSIONS, newSessions } from "../domain/projects";
import type { AreaId, Goal, ISODate, Priority, Weekday } from "../domain/types";
import { BASE_ADD_DEFAULTS, type AddDefaults, type AddType } from "./addContext";
import { AREA_CHOICES, GOAL_AREAS, GOAL_AREAS_BY_SIDEBAR } from "./areas";
import { useGrow } from "./ItemPanel";
import { SAVE_ERROR } from "./messages";
import { ShellContext } from "./shellContext";

const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** A goal is never in the inbox: the first area in the sidebar stands in. */
const goalArea = (a: AreaId): AreaId => (a === "inbox" ? GOAL_AREAS_BY_SIDEBAR[0].id : a);

/** What the form can make: the page defaults' types, plus a project to-do (3A). */
type FormType = AddType | "project";

/** Everything typed or chosen in the form. */
export interface AddDraft {
  title: string;
  type: FormType;
  areaId: AreaId;
  goalId: string;
  priority: Priority;
  due: string;
  recur: Weekday[];
  notes: string;
  goalKind: Goal["kind"];
  deadline: string;
  target: string;
  sessionCount: string;
  /** A book's author and status (Type "Book"). Optional so a draft kept by an older build still reads. */
  author?: string;
  bookStatus?: BookStatus;
}

/** Something was typed (a draft worth keeping); only choosing type or area is not. */
export function draftHasContent(d: AddDraft): boolean {
  return Boolean(d.title.trim() || d.notes.trim() || d.due || d.deadline || d.target.trim() || d.recur.length || d.author?.trim());
}

/**
 * The Add form. It opens pre-set from the page Add was pressed on (`defaults`, see
 * addContext.ts); type and area can still be changed. Notes are saved with the item (or
 * the goal) as its page. Type "Project" (3A) makes a to-do with unnamed sessions and a
 * deadline. With `onCancel` it offers Cancel (the pop-up and the phone sheet).
 */
export function QuickAdd({
  today,
  onAdded,
  onCancel,
  defaults = BASE_ADD_DEFAULTS,
  autoFocus = false,
  initial,
  onDraft,
}: {
  today: ISODate;
  onAdded: () => void;
  onCancel?: () => void;
  defaults?: AddDefaults;
  /** Focus the title when the form appears. */
  autoFocus?: boolean;
  /** What was typed when the form last closed without Cancel (fix round 1, I-5). */
  initial?: AddDraft;
  /** Hears every change, so the shell can keep it when the form closes. */
  onDraft?: (draft: AddDraft) => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [type, setType] = useState<FormType>(initial?.type ?? defaults.type);
  const [areaId, setAreaId] = useState<AreaId>(
    initial?.areaId ?? (defaults.type === "goal" ? goalArea(defaults.areaId) : defaults.areaId),
  );
  const [goalId, setGoalId] = useState(initial?.goalId ?? "");
  const [priority, setPriority] = useState<Priority>(initial?.priority ?? 2);
  const [due, setDue] = useState(initial?.due ?? "");
  const [recur, setRecur] = useState<Weekday[]>(initial?.recur ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [goalKind, setGoalKind] = useState<Goal["kind"]>(initial?.goalKind ?? "finite");
  const [deadline, setDeadline] = useState(initial?.deadline ?? "");
  const [target, setTarget] = useState(initial?.target ?? "");
  const [sessionCount, setSessionCount] = useState(initial?.sessionCount ?? String(DEFAULT_SESSIONS));
  const [author, setAuthor] = useState(initial?.author ?? "");
  const [bookStatus, setBookStatus] = useState<BookStatus>(initial?.bookStatus ?? "want");
  /** The area chosen before Type was set to Book (which shows Mind). */
  const areaBeforeBook = useRef<AreaId>(initial?.areaId ?? defaults.areaId);
  const draftRef = useRef(onDraft);
  draftRef.current = onDraft;
  useEffect(() => {
    draftRef.current?.({
      title, type, areaId, goalId, priority, due, recur, notes, goalKind, deadline, target, sessionCount, author, bookStatus,
    });
  }, [title, type, areaId, goalId, priority, due, recur, notes, goalKind, deadline, target, sessionCount, author, bookStatus]);
  const [message, setMessage] = useState("");
  const [goals, setGoals] = useState<Goal[]>([]);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const notesRef = useGrow(notes);
  // Re-read goals when the shell reports a change (e.g. a goal created on /goals).
  const version = useContext(ShellContext)?.version ?? 0;

  useEffect(() => {
    let live = true;
    listGoals().then(
      (g) => {
        if (live) setGoals(g);
      },
      () => {}, // the goal list just stays as it was; saving still works without a goal
    );
    return () => {
      live = false;
    };
  }, [version]);

  const isGoal = type === "goal";
  const isBookType = type === "book";
  const areaGoals = goals.filter((g) => g.areaId === areaId && isActive(g));
  const notesCap = isGoal ? MAX_GOAL_NOTES : MAX_NOTES_TEXT;

  function toggleDay(d: Weekday) {
    setRecur((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));
  }

  function changeType(next: FormType) {
    // Leaving Book puts back the area it had before Book set it to Mind (review M-11).
    const from = type === "book" ? areaBeforeBook.current : areaId;
    setType(next);
    if (next === "book") {
      // Books always live under Mind.
      if (type !== "book") areaBeforeBook.current = areaId;
      setAreaId(BOOK_AREA);
      setGoalId("");
      return;
    }
    if (type === "book") setAreaId(from);
    if (next === "goal") {
      setAreaId(goalArea(from));
      setGoalId("");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    // A half-typed date (12/11/yyyy) reads as "", so without this it would save with no date (M-1).
    const dates = Array.from((e.currentTarget as HTMLFormElement).querySelectorAll<HTMLInputElement>('input[type="date"]'));
    if (dates.some((d) => d.validity.badInput)) return setMessage("A date is not finished. Finish it or clear it.");
    const trimmed = title.trim();
    if (!trimmed) {
      setMessage("A title is needed.");
      return;
    }
    let monthlyTarget: number | undefined;
    if (isGoal) {
      if (goalKind === "finite" && !deadline) return setMessage("A finite goal needs a deadline.");
      if (target.trim() !== "") {
        monthlyTarget = Number(target);
        if (!Number.isInteger(monthlyTarget) || monthlyTarget < 1) {
          return setMessage("A monthly target is a whole number, 1 or more.");
        }
      }
    }
    let count = 0;
    if (type === "project") {
      count = Number(sessionCount);
      if (sessionCount.trim() === "" || !Number.isInteger(count) || count < MIN_SESSIONS || count > MAX_SESSIONS) {
        return setMessage(`Sessions is a whole number from ${MIN_SESSIONS} to ${MAX_SESSIONS}.`);
      }
      if (!deadline) return setMessage("A project needs a deadline.");
    }
    if (isBookType && author.trim().length > BOOK_LIMITS.author) {
      return setMessage(`An author is at most ${BOOK_LIMITS.author} characters.`);
    }
    if (notes.length > notesCap) {
      return setMessage(`Notes are at most ${notesCap.toLocaleString("en-GB")} characters here.`);
    }
    setMessage("");
    inFlight.current = true;
    setSaving(true);
    try {
      await save(trimmed, monthlyTarget, count);
    } catch {
      setMessage(SAVE_ERROR);
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  async function save(trimmed: string, monthlyTarget: number | undefined, count: number) {
    const page = notes.trim() ? { notes } : {};
    if (isBookType) {
      await createBook({ title: trimmed, author, bookStatus, ...page }, today);
    } else if (isGoal) {
      await createGoal(
        {
          title: trimmed,
          areaId,
          kind: goalKind,
          ...(goalKind === "finite" ? { deadline } : {}),
          ...(monthlyTarget !== undefined ? { monthlyTarget } : {}),
          ...page,
        },
        today,
      );
    } else if (type === "project") {
      await createItem(
        {
          kind: "task",
          title: trimmed,
          areaId,
          priority,
          links: [],
          ...page,
          ...(goalId ? { goalId } : {}),
          due: deadline,
          sessions: newSessions(count),
        },
        today,
      );
    } else {
      await createItem(
        {
          kind: type,
          title: trimmed,
          areaId,
          priority,
          links: [],
          ...page,
          ...(goalId ? { goalId } : {}),
          ...(type === "task" && due ? { due } : {}),
          ...(type === "task" && recur.length ? { recur: WEEKDAYS.filter((d) => recur.includes(d)) } : {}),
        },
        today,
      );
    }
    // Ready for the next one, pre-set as the form opened.
    setTitle("");
    setType(defaults.type);
    setAreaId(defaults.type === "goal" ? goalArea(defaults.areaId) : defaults.areaId);
    setGoalId("");
    setPriority(2);
    setDue("");
    setRecur([]);
    setNotes("");
    setGoalKind("finite");
    setDeadline("");
    setTarget("");
    setSessionCount(String(DEFAULT_SESSIONS));
    setAuthor("");
    setBookStatus("want");
    onAdded();
  }

  return (
    // noValidate: the form's own plain messages, not the browser's bubbles (min/max still set the spinners).
    <form className="quick-add form-grid" noValidate onSubmit={(e) => void submit(e)}>
      <label className="form-field form-full">
        <span className="form-label">Title</span>
        <input type="text" value={title} autoFocus={autoFocus} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="form-field">
        <span className="form-label">Type</span>
        <select value={type} onChange={(e) => changeType(e.target.value as FormType)}>
          <option value="task">To-do</option>
          <option value="project">Project</option>
          <option value="idea">Idea</option>
          <option value="book">Book</option>
          <option value="goal">Goal</option>
        </select>
      </label>
      <label className="form-field">
        <span className="form-label">Area</span>
        <select
          // A book always lives under Mind: shown, not changeable.
          disabled={isBookType}
          value={isBookType ? BOOK_AREA : areaId}
          onChange={(e) => {
            setAreaId(e.target.value as AreaId);
            setGoalId("");
          }}
        >
          {(isGoal ? GOAL_AREAS : AREA_CHOICES).map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      {isBookType ? (
        <>
          <label className="form-field">
            <span className="form-label">Author</span>
            <input type="text" maxLength={BOOK_LIMITS.author} value={author} onChange={(e) => setAuthor(e.target.value)} />
          </label>
          <label className="form-field">
            <span className="form-label">Status</span>
            <select value={bookStatus} onChange={(e) => setBookStatus(e.target.value as BookStatus)}>
              {BOOK_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {BOOK_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : isGoal ? (
        <>
          <label className="form-field">
            <span className="form-label">Kind of goal</span>
            <select value={goalKind} onChange={(e) => setGoalKind(e.target.value as Goal["kind"])}>
              <option value="finite">Finish by a date</option>
              <option value="practice">Practice</option>
            </select>
          </label>
          {goalKind === "finite" && (
            <label className="form-field">
              <span className="form-label">Deadline</span>
              <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </label>
          )}
          <label className="form-field">
            <span className="form-label">Monthly target</span>
            <input type="number" min={1} step={1} value={target} onChange={(e) => setTarget(e.target.value)} />
          </label>
        </>
      ) : (
        <>
          {type === "project" && (
            <>
              <label className="form-field">
                <span className="form-label">Sessions</span>
                <input
                  type="number"
                  min={MIN_SESSIONS}
                  max={MAX_SESSIONS}
                  step={1}
                  value={sessionCount}
                  onChange={(e) => setSessionCount(e.target.value)}
                />
              </label>
              <label className="form-field">
                <span className="form-label">Deadline</span>
                <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
              </label>
            </>
          )}
          <label className="form-field">
            <span className="form-label">Goal</span>
            <select value={goalId} onChange={(e) => setGoalId(e.target.value)}>
              <option value="">None</option>
              {areaGoals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
          <label className="form-field">
            <span className="form-label">Priority</span>
            <select value={priority} onChange={(e) => setPriority(Number(e.target.value) as Priority)}>
              <option value="1">1</option>
              <option value="2">2</option>
              <option value="3">3</option>
            </select>
          </label>
        </>
      )}
      {type === "task" && (
        <>
          <label className="form-field">
            <span className="form-label">Due</span>
            <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
          <fieldset className="form-full">
            <legend>Repeats on</legend>
            <div className="form-checks">
            {WEEKDAYS.map((d) => (
              <label key={d} className="form-check">
                <input type="checkbox" checked={recur.includes(d)} onChange={() => toggleDay(d)} />
                {d}
              </label>
            ))}
            </div>
          </fieldset>
        </>
      )}
      <label className="form-field form-full">
        <span className="form-label">Notes</span>
        <textarea
          ref={notesRef}
          rows={2}
          className="quick-add-notes"
          maxLength={notesCap}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      {message && <p className="form-message form-full">{message}</p>}
      <div className="form-actions form-full">
        <button type="submit" disabled={saving}>
          Add item
        </button>
        {onCancel && (
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
