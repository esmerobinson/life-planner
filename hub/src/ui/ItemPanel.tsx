import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isActive } from "../domain/goalCounts";
import { getItem, makeBook, saveItemNotes, setBookStatus, unBook, updateItem } from "../data/repo";
import { CHANGED_TO_BOOK, leftReadingList, MOVED_TO_READING_LIST, useRowUndo, useSessionsUndo } from "./undoSessions";
import { BOOK_AREA, BOOK_LIMITS, BOOK_STATUSES, BOOK_STATUS_LABEL, bookLine, isBook, isWebLink } from "../domain/books";
import { ProgressBar } from "./ProgressBar";
import { RepeatBox } from "./RepeatBox";
import { needsALook } from "../domain/attention";
import { daysBetween } from "../domain/dates";
import { dayLabel } from "../domain/display";
import type { AreaId, Goal, ISODate, Item, Priority } from "../domain/types";
import { GOAL_AREAS } from "./areas";
import { areaLabel } from "./GoalProgress";
import { FLAG_GLYPH } from "./IconPopover";
import { useSaveError } from "./messages";
import { usePanel } from "./panelContext";
import { PanelTop } from "./PanelTop";
import type { EscapeHandler } from "./SidePanel";
import { PageEditor } from "./PageEditor";
import { ProjectSummary, SessionList } from "./ProjectPanel";
import { DEFAULT_SESSIONS, isProject, newSessions, withSessions } from "../domain/projects";
import { AUTOSAVE_MS, useDraft } from "./useDraft";

/** The Type property: a project is a to-do with sessions, a book an idea on the reading list, each shown as its own type. */
type PanelKind = Item["kind"] | "project" | "book";
const TYPE_LABEL: Record<PanelKind, string> = { task: "To-do", project: "Project", idea: "Idea", book: "Book" };
const kindOf = (it: Item): PanelKind => (isProject(it) ? "project" : isBook(it) ? "book" : it.kind);

interface Fields {
  kind: PanelKind;
  areaId: AreaId;
  due: string;
  goalId: string;
  priority: Priority;
  milestone: boolean;
  /** A book's fields, as typed. */
  author: string;
  pages: string;
  pageAt: string;
  link: string;
}

const fieldsOf = (it: Item): Fields => ({
  kind: kindOf(it),
  areaId: it.areaId,
  due: it.due ?? "",
  goalId: it.goalId ?? "",
  priority: it.priority,
  milestone: it.milestone === true,
  author: it.author ?? "",
  pages: it.pages === undefined ? "" : String(it.pages),
  pageAt: it.pageAt === undefined ? "" : String(it.pageAt),
  link: it.link ?? "",
});

/** A page number as typed: blank is none; otherwise a whole number in range, or null when it isn't. */
function pageNumber(text: string, min: number): number | undefined | null {
  const t = text.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isInteger(n) && n >= min && n <= BOOK_LIMITS.pages ? n : null;
}

/**
 * The book fields typed in Edit, checked, as a patch for the row (undefined removes a field),
 * or the plain message that says what to fix.
 */
function bookFieldsPatch(f: Fields, was: Fields): { patch: Partial<Item> } | { message: string } {
  const patch: Partial<Item> = {};
  const author = f.author.trim();
  if (author.length > BOOK_LIMITS.author) return { message: `An author is at most ${BOOK_LIMITS.author} characters.` };
  if (author !== was.author.trim()) patch.author = author || undefined;
  const link = f.link.trim();
  if (link && (link.length > BOOK_LIMITS.link || !isWebLink(link))) return { message: "A link starts with https:// (or http://)." };
  if (link !== was.link.trim()) patch.link = link || undefined;
  const pages = pageNumber(f.pages, 1);
  if (pages === null) return { message: "Pages is a whole number, 1 or more." };
  let pageAt = pageNumber(f.pageAt, 0);
  if (pageAt === null) return { message: "The page reached is a whole number, 0 or more." };
  if (pages !== undefined && pageAt !== undefined && pageAt > pages) pageAt = pages;
  if (f.pages !== was.pages || f.pageAt !== was.pageAt) Object.assign(patch, { pages, pageAt });
  return { patch };
}

/**
 * A task or idea in the side panel: the title (always editable, saved on blur), the
 * properties (Type, Area, Due, Goal, Priority; Milestone when it has a goal), editable
 * after Edit, then the notes page (always typeable, saved as you pause). An Inbox item has
 * no type until it is sorted, so it shows no Type and its area changes only through Sort.
 */
export function ItemPanel({
  item,
  goals,
  today,
  phone,
  onChanged,
  escape,
}: {
  item: Item;
  goals: Goal[];
  today: ISODate;
  phone: boolean;
  onChanged: () => Promise<void>;
  escape: EscapeHandler;
}) {
  const panel = usePanel();
  const { attempt, saveError } = useSaveError();
  const offerUndo = useSessionsUndo(today);
  const offerRowUndo = useRowUndo(today);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [fields, setFields] = useState<Fields>(() => fieldsOf(item));
  const [snapshot, setSnapshot] = useState<Fields>(() => fieldsOf(item));
  const [busy, setBusy] = useState(false);
  const inbox = item.areaId === "inbox";

  async function write(fn: () => Promise<unknown>) {
    const ok = await attempt(fn);
    if (ok) await onChanged();
    if (!ok) throw new Error("not saved");
  }

  const title = useDraft(item.title, async (t) => {
    if (!t.trim()) return; // a blank title is not saved; the stored one comes back on reopen
    await write(() => updateItem(item.id, { title: t.trim() }, today));
  });
  const notes = useDraft(item.notes ?? "", (t) => write(() => saveItemNotes(item.id, t, today)), AUTOSAVE_MS);

  // Escape while editing discards the field changes instead of closing the panel.
  useEffect(() => {
    escape.current = editing
      ? () => {
          setEditing(false);
          setFieldError(null);
          return true;
        }
      : null;
    return () => {
      escape.current = null;
    };
  }, [editing, escape]);

  function startEdit() {
    const now = fieldsOf(item);
    setFields(now);
    setSnapshot(now);
    setFieldError(null);
    setEditing(true);
  }

  async function done() {
    if (busy) return;
    // Only what was changed in Edit is written, so a change synced in meanwhile is kept (review M-3).
    const f = fields;
    const was = snapshot;
    const patch: Partial<Item> = {};
    setFieldError(null);
    if (f.priority !== was.priority) patch.priority = f.priority;
    const toBook = !inbox && f.kind === "book" && was.kind !== "book";
    const fromBook = !inbox && was.kind === "book" && f.kind !== "book";
    if (f.kind === "book") {
      const book = bookFieldsPatch(f, was);
      if ("message" in book) {
        setFieldError(book.message);
        return;
      }
      Object.assign(patch, book.patch);
    }
    if (toBook || fromBook) {
      // As the arrow menu's Change to: makeBook / unBook put the fields the new type doesn't
      // show away (nothing is lost) and bring back what was put away; then what was typed here.
      if (fromBook && f.areaId !== was.areaId) patch.areaId = f.areaId;
      if (fromBook && f.kind !== "idea") {
        if (f.due !== was.due) patch.due = f.due || undefined;
        if (f.goalId !== was.goalId) patch.goalId = f.goalId || undefined;
      }
      setBusy(true);
      const before: { row?: Item } = {};
      try {
        await write(async () => {
          before.row = await getItem(item.id);
          if (toBook) await makeBook(item.id, today);
          else await unBook(item.id, f.kind === "project" ? "project" : f.kind === "task" ? "task" : "idea", today);
          if (Object.keys(patch).length) await updateItem(item.id, patch, today);
        });
        const row = before.row;
        if (row && toBook) offerRowUndo(row.areaId !== BOOK_AREA ? MOVED_TO_READING_LIST : CHANGED_TO_BOOK, row);
        else if (row) offerRowUndo(leftReadingList(f.kind === "book" ? "idea" : f.kind), row);
        setEditing(false);
      } catch {
        // The save message shows; stay in Edit mode with the changes.
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!inbox && f.kind !== was.kind) {
      // Project <-> to-do: the sessions come or go (a project does not repeat); an idea has none.
      // A done to-do made a project is open again: a project is done only when its sessions are (I-1).
      if (f.kind === "project") {
        Object.assign(patch, { kind: "task", sessions: item.sessions ?? newSessions(DEFAULT_SESSIONS), recur: undefined });
        // The status follows the sessions (R-5): done, with completedAt, only when every one is ticked.
        const { status, completedAt } = withSessions(item, patch.sessions!, today);
        if ((item.status === "open" || item.status === "done") && (status !== item.status || completedAt !== item.completedAt)) Object.assign(patch, { status, completedAt });
      } else patch.kind = f.kind === "book" ? "idea" : f.kind;
      if (was.kind === "project" && f.kind !== "project") patch.sessions = undefined;
    }
    // A book's area is always Mind (the select is shown but not changeable).
    if (!inbox && f.kind !== "book" && f.areaId !== was.areaId) patch.areaId = f.areaId;
    if (inbox || (f.kind !== "idea" && f.kind !== "book")) {
      if (f.due !== was.due) patch.due = f.due || undefined;
      if (f.goalId !== was.goalId) patch.goalId = f.goalId || undefined;
      const flag = Boolean(f.goalId && f.milestone);
      if (flag !== was.milestone) patch.milestone = flag ? true : undefined;
    } else if (patch.kind === "idea") {
      // An idea has no due date, repeat or day on Today (as Change to → Idea does).
      Object.assign(patch, { due: undefined, recur: undefined, pinnedDate: undefined, hiddenOn: undefined, milestone: undefined });
    }
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setBusy(true);
    // A project made a to-do or an idea loses its sessions: keep the whole row for Undo (I-2).
    const dropsSessions = "sessions" in patch && patch.sessions === undefined;
    const before: { row?: Item } = {};
    try {
      await write(async () => {
        if (dropsSessions) before.row = await getItem(item.id);
        await updateItem(item.id, patch, today);
      });
      const row = before.row;
      if (dropsSessions && row) offerUndo(f.kind === "idea" ? "idea" : "task", row);
      setEditing(false);
    } catch {
      // The save message shows; stay in Edit mode with the changes.
    } finally {
      setBusy(false);
    }
  }

  const goal = goals.find((g) => g.id === item.goalId);
  // Days untouched, when it is in Needs a look's "Not looked at in a while" group.
  const stale = needsALook([item], today).stale.length > 0 ? daysBetween(item.touchedAt, today) : null;
  const isTask = inbox || item.kind === "task";
  const showGoal = editing ? inbox || (fields.kind !== "idea" && fields.kind !== "book") : isTask;
  const project = isProject(item);
  const book = isBook(item);
  // The book properties show for a book, and in Edit once Type is Book.
  const showBook = !inbox && (editing ? fields.kind === "book" : book);
  // A project's due date is its deadline (2C).
  const dueKey = (editing ? fields.kind === "project" : project) ? "Deadline" : "Due";

  return (
    <div className="peek-body">
      <PanelTop
        phone={phone}
        kicker={project ? "Project" : book ? "Book" : undefined}
        editing={editing}
        busy={busy}
        onEdit={startEdit}
        onDone={() => void done()}
        onCancel={() => {
          setFieldError(null);
          setEditing(false);
        }}
      />
      <div className="peek-content">
      <TitleBox value={title.value} onChange={title.set} onBlur={title.flush} />
      {saveError && <p className="form-message">{saveError}</p>}
      {fieldError && <p className="form-message">{fieldError}</p>}
      <RepeatBox item={item} today={today} onChanged={onChanged} />
      <div className="peek-props">
        {!inbox && (
          <>
            <span className="peek-key">Type</span>
            {editing ? (
              <select
                aria-label="Type"
                value={fields.kind}
                onChange={(e) => setFields({ ...fields, kind: e.target.value as PanelKind })}
              >
                <option value="task">To-do</option>
                <option value="project">Project</option>
                <option value="idea">Idea</option>
                <option value="book">Book</option>
              </select>
            ) : (
              <span>
                <span className="chip">{TYPE_LABEL[kindOf(item)]}</span>
              </span>
            )}
          </>
        )}
        {showBook && (
          <>
            {book && (
              <>
                <span className="peek-key">Status</span>
                {/* Always live (not only in Edit): tapping a pill changes the status at once. */}
                <div role="group" aria-label="Status" className="btn-group book-status">
                  {BOOK_STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={item.bookStatus === s}
                      onClick={() => {
                        if (item.bookStatus !== s) void write(() => setBookStatus(item.id, s, today)).catch(() => {});
                      }}
                    >
                      {BOOK_STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </>
            )}
            <span className="peek-key">Author</span>
            {editing ? (
              <input
                type="text"
                aria-label="Author"
                maxLength={BOOK_LIMITS.author}
                value={fields.author}
                onChange={(e) => setFields({ ...fields, author: e.target.value })}
              />
            ) : (
              <span>{item.author ?? "None"}</span>
            )}
          </>
        )}
        <span className="peek-key">Area</span>
        {editing && !inbox ? (
          <select
            aria-label="Area"
            // A book always lives under Mind: shown, not changeable.
            disabled={fields.kind === "book"}
            value={fields.kind === "book" ? BOOK_AREA : fields.areaId}
            onChange={(e) => setFields({ ...fields, areaId: e.target.value as AreaId })}
          >
            {GOAL_AREAS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        ) : (
          <span>
            <span className="chip">{inbox ? "Inbox" : areaLabel(item.areaId)}</span>
          </span>
        )}
        {showBook && <BookPages item={item} editing={editing} fields={fields} setFields={setFields} today={today} />}
        {/* The stale reason left the Needs-a-look strip (compact strips); read-only here. */}
        {stale !== null && (
          <>
            <span className="peek-key">Needs a look</span>
            <span>{`Not looked at for ${stale} ${stale === 1 ? "day" : "days"}. What do you want to do with this?`}</span>
          </>
        )}
        {/* Tags no longer show on the strip (compact strips); read-only here, as chips. */}
        {item.tags && item.tags.length > 0 && (
          <>
            <span className="peek-key">Tags</span>
            <span className="peek-tags">
              {item.tags.map((t) => (
                <span key={t} className="chip">{`#${t}`}</span>
              ))}
            </span>
          </>
        )}
        {showGoal && (
          <>
            <span className="peek-key">{dueKey}</span>
            {editing ? (
              <input type="date" aria-label={dueKey} value={fields.due} onChange={(e) => setFields({ ...fields, due: e.target.value })} />
            ) : (
              <span>{item.due ? dayLabel(item.due, today) : "None"}</span>
            )}
            {project && (
              <>
                <span className="peek-key">Sessions</span>
                <span>{item.sessions!.length}</span>
              </>
            )}
            <span className="peek-key">Goal</span>
            {editing ? (
              <select aria-label="Goal" value={fields.goalId} onChange={(e) => setFields({ ...fields, goalId: e.target.value })}>
                <option value="">None</option>
                {goals.filter((g) => isActive(g) || g.id === item.goalId).map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            ) : goal ? (
              <span>
                <button type="button" className="chip chip-link" onClick={() => panel?.open(goal.id)}>
                  {goal.title}
                </button>
              </span>
            ) : (
              <span>None</span>
            )}
            {(editing ? fields.goalId : goal) && (
              <>
                <span className="peek-key">Milestone</span>
                {editing ? (
                  <label className="form-check">
                    <input
                      type="checkbox"
                      checked={fields.milestone}
                      onChange={(e) => setFields({ ...fields, milestone: e.target.checked })}
                    />
                    <span className="flag" aria-hidden="true">
                      {FLAG_GLYPH}
                    </span>
                    Milestone
                  </label>
                ) : (
                  <span>
                    {item.milestone ? (
                      <>
                        <span className="flag" aria-hidden="true">
                          {FLAG_GLYPH}
                        </span>
                        Yes
                      </>
                    ) : (
                      "No"
                    )}
                  </span>
                )}
              </>
            )}
            <span className="peek-key">Priority</span>
            {editing ? (
              <select
                aria-label="Priority"
                value={fields.priority}
                onChange={(e) => setFields({ ...fields, priority: Number(e.target.value) as Priority })}
              >
                <option value="1">1</option>
                <option value="2">2</option>
                <option value="3">3</option>
              </select>
            ) : (
              <span>{item.priority}</span>
            )}
          </>
        )}
      </div>
      {project && (
        <>
          <ProjectSummary item={item} today={today} onChanged={onChanged} />
          <SessionList item={item} today={today} write={write} />
        </>
      )}
      <PageEditor value={notes.value} onChange={notes.set} onBlur={notes.flush} today={today} />
      </div>
    </div>
  );
}

/**
 * A book's Pages, Finished and Link properties: "page 120 of 300" over a bar, the day it was
 * marked Read, and its link (opens in a new tab). In Edit: the page reached, the page count and
 * the link as fields.
 */
function BookPages({
  item, editing, fields, setFields, today,
}: { item: Item; editing: boolean; fields: Fields; setFields: (f: Fields) => void; today: ISODate }) {
  const { pageLine, ratio } = bookLine(item);
  const pagesView = pageLine ?? (item.pages ? `${item.pages} pages` : "None");
  return (
    <>
      <span className="peek-key">Pages</span>
      {editing ? (
        <span className="book-page-fields">
          <input
            type="number"
            aria-label="Page reached"
            min={0}
            max={BOOK_LIMITS.pages}
            step={1}
            value={fields.pageAt}
            onChange={(e) => setFields({ ...fields, pageAt: e.target.value })}
          />
          <span>of</span>
          <input
            type="number"
            aria-label="Pages"
            min={1}
            max={BOOK_LIMITS.pages}
            step={1}
            value={fields.pages}
            onChange={(e) => setFields({ ...fields, pages: e.target.value })}
          />
        </span>
      ) : (
        <span>
          {pagesView}
          {ratio !== null && (
            <span className="book-panel-bar">
              <ProgressBar ratio={ratio} label={`${item.title}: ${pageLine}`} />
            </span>
          )}
        </span>
      )}
      {!editing && item.bookStatus === "read" && item.finishedOn && (
        <>
          <span className="peek-key">Finished</span>
          <span>{dayLabel(item.finishedOn, today)}</span>
        </>
      )}
      <span className="peek-key">Link</span>
      {editing ? (
        <input
          type="url"
          aria-label="Link"
          maxLength={BOOK_LIMITS.link}
          placeholder="https://"
          value={fields.link}
          onChange={(e) => setFields({ ...fields, link: e.target.value })}
        />
      ) : item.link ? (
        <span className="book-link">
          <a href={item.link} target="_blank" rel="noopener noreferrer">
            {linkLabel(item.link)}
          </a>
        </span>
      ) : (
        <span>None</span>
      )}
    </>
  );
}

/** A link shown by its address without the scheme ("library.example.test/lantern"). */
function linkLabel(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/$/, "");
}

/** A textarea that is always as tall as its text (also when the panel is resized). */
export function useGrow(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [value]);
  return ref;
}

/** The task title: typed straight into, wraps like the heading it is, saved on blur or Enter. */
function TitleBox({ value, onChange, onBlur }: { value: string; onChange: (v: string) => void; onBlur: () => void }) {
  const ref = useGrow(value);
  return (
    <textarea
      ref={ref}
      rows={1}
      className="peek-title"
      aria-label="Title"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\n/g, " "))}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        e.currentTarget.blur();
      }}
    />
  );
}
