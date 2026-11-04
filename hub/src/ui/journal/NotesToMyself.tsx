import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  CANT_OPEN, clearNoteDraft, deleteNote, listNoteReads, listNotes, newNoteId, saveNote, saveNoteDraft, setNoteRead,
  type Note, type NoteDraft, type NoteFields, type NoteReads, type NoteVersion,
} from "../../data/repo";
import type { ISODate } from "../../domain/types";
import type { JournalKey } from "../../journal/crypto";
import { NOTE_GROUPS, todaysNotes } from "../../journal/notes";
import { LOADING_LINE, LoadLine, useLoadGuard } from "./bits";
import { JournalSheet } from "./JournalSheet";
import { useDbChanges } from "./useJournalKey";
import { AutoGrowTextarea } from "../useAutoGrow";
import { AUTOSAVE_MS, useHiddenFlush } from "../useDraft";
import { whenWritten } from "./ResponseView";

/** The button at the top of the Journal (every tab). */
export const HARD_MOMENT = "Hard moment";
export const NOTES_INTRO =
  "Write these when you feel steady, in your own words. Read one or two each day, so your steady self has a voice when things are hard.";
const THOUGHT = "When I think…";
const STEADY = "What I know when I'm steady…";
const MEMORY = "A memory or evidence";
const SKILL = "A skill to try";
const SAVE_PROBLEM = "That didn't save. Try again.";
const ALL_PROMPTS = new Set(NOTE_GROUPS.flatMap((g) => g.prompts));

/** Over another version of a note, read-only, so nothing she wrote is lost (review I1). */
export const anotherVersion = (at: number) => `Another version (from ${whenWritten(at)})`;
/** Over her open note when another device deleted it while she was writing (review I2). */
export const DELETED_ELSEWHERE = "This note was deleted on another device. Save it to keep it.";

/**
 * What is open in the editor: a note to change, or a new one (its id made when she starts, so
 * what she types is kept as this device's draft), with what she started from.
 */
type Editing = { id: string; prompt: string | null; isNew: boolean; seen: string[]; start: NoteFields };

const fieldsOf = (n: NoteFields): NoteFields => ({ prompt: n.prompt, thought: n.thought, steady: n.steady, memory: n.memory, skill: n.skill });

/**
 * Notes to myself (journal v3; her partner's idea): while steady, she writes her own answers to
 * the thoughts that come up in hard moments. The tab shows one or two of her notes to reread
 * today (a gentle "I read this today" tick: no streak, no count), then the nine groups of
 * starter prompts (prompts only; every answer is hers), each with "+ Write your answer", then
 * her own thoughts and "+ My own thought". Every note is sealed like the rest of the journal
 * and always readable. This tab never ticks and isn't a Home or Today row. A note she is
 * writing is kept as she types (this device's draft) and opens again where she left it.
 */
export function NotesToMyself({ jk, today, deviceId }: { jk: JournalKey; today: ISODate; deviceId: string }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [drafts, setDrafts] = useState<NoteDraft[]>([]);
  const [reads, setReads] = useState<NoteReads | null>(null);
  const [unreadable, setUnreadable] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [problem, setProblem] = useState("");
  // A tick shows at once; a failed save puts it back.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const guardFail = useRef<() => void>(() => undefined);
  const reopened = useRef(false);
  // What she has typed in each open editor, so an editor that moves (its note deleted on another
  // device) opens again with every word.
  const typed = useRef(new Map<string, NoteFields>());

  const load = useCallback(async () => {
    try {
      const [n, r] = await Promise.all([listNotes(jk, deviceId), listNoteReads(jk)]);
      setNotes(n.notes);
      setDrafts(n.drafts);
      setUnreadable(n.unreadable);
      setReads(r);
      setTicked({});
    } catch {
      guardFail.current();
    }
  }, [jk, deviceId]);
  useEffect(() => void load(), [load]);
  useDbChanges(() => void load());
  // Never blank: "Loading…", then the can't-open line and Try again.
  const guard = useLoadGuard(notes === null, load);
  guardFail.current = guard.fail;

  // Back on the tab (a reload, another tab, the phone closing the app): her note in progress
  // opens again with what she had typed.
  useEffect(() => {
    if (notes === null || reopened.current) return;
    reopened.current = true;
    const d = drafts[0];
    if (!d || editing) return;
    const note = notes.find((n) => n.id === d.id);
    setEditing({ id: d.id, prompt: note ? note.prompt : d.fields.prompt, isNew: !note, seen: d.seen, start: d.fields });
  }, [notes, drafts, editing]);

  const byDay = reads?.byDay ?? new Map<ISODate, Set<string>>();
  const today2 = useMemo(() => (notes ? todaysNotes(notes, byDay, today) : []), [notes, byDay, today]);
  // The box shows this device's own tick (review M1: an untick here sticks).
  const readHere = reads?.ownOn(today, deviceId) ?? new Set<string>();

  async function tick(n: Note, on: boolean) {
    setTicked((t) => ({ ...t, [n.id]: on }));
    try {
      await setNoteRead(jk, today, deviceId, n.id, on);
      setProblem("");
    } catch {
      setTicked((t) => {
        const { [n.id]: _drop, ...rest } = t;
        return rest;
      });
      setProblem(SAVE_PROBLEM);
    }
  }

  /**
   * Opens the editor for a note's version shown (or, with `version`, one of its other versions),
   * or a new note (her draft of it, if she has one). Saving or deleting replaces that one
   * version only; the others stay (R-I1).
   */
  function edit(note: Note | null, prompt: string | null, version?: NoteVersion) {
    if (note) {
      const d = drafts.find((x) => x.id === note.id);
      const v = version ?? note;
      return setEditing({ id: note.id, prompt: note.prompt, isNew: false, seen: d ? d.seen : [v.vid], start: d ? d.fields : fieldsOf(v) });
    }
    const known = new Set(notes?.map((n) => n.id));
    const own = (p: string | null) => p === null || !ALL_PROMPTS.has(p);
    const d = drafts.find((x) => !known.has(x.id) && (prompt === null ? own(x.fields.prompt) : x.fields.prompt === prompt));
    if (d) return setEditing({ id: d.id, prompt, isNew: true, seen: d.seen, start: d.fields });
    setEditing({ id: newNoteId(today), prompt, isNew: true, seen: [], start: { prompt, thought: prompt ?? "", steady: "", memory: "", skill: "" } });
  }

  async function save(e: Editing, fields: NoteFields) {
    await saveNote(jk, today, deviceId, fields, { id: e.id, seen: e.seen });
    typed.current.delete(e.id);
    setEditing(null);
    setProblem("");
    await load();
  }
  /** Cancel: the editor closes at once; her draft is let go once any save still landing has. */
  async function cancel(e: Editing, landing: Promise<unknown>) {
    typed.current.delete(e.id);
    setEditing(null);
    await landing.catch(() => undefined);
    await clearNoteDraft(jk, deviceId, e.id).catch(() => undefined);
  }
  async function remove(e: Editing) {
    await deleteNote(jk, deviceId, e.id, e.seen);
    typed.current.delete(e.id);
    setEditing(null);
    setProblem("");
    await load();
  }

  if (notes === null) return <LoadLine guard={guard} />;

  const editor = (e: Editing, gone = false, after?: React.ReactNode) => (
    <li key={`editor|${e.id}`}>
      {gone && <p className="journal-muted">{DELETED_ELSEWHERE}</p>}
      <NoteEditor
        key={e.id}
        jk={jk}
        deviceId={deviceId}
        editing={e}
        start={typed.current.get(e.id) ?? e.start}
        onTyped={(f) => typed.current.set(e.id, f)}
        onCancel={(landing) => void cancel(e, landing)}
        onSave={(f) => save(e, f)}
        onDelete={!e.isNew && !gone ? () => remove(e) : undefined}
        onProblem={setProblem}
      />
      {after}
    </li>
  );
  const card = (n: Note) =>
    editing?.id === n.id ? (
      // Every other version stays in view while she writes (bug #22): Save changes only hers.
      editor(editing, false, <ReadOnlyVersions versions={[n, ...n.others].filter((v) => !editing.seen.includes(v.vid))} />)
    ) : (
      <li key={n.id} className="strip no-tick notes-card">
        <div>
          <NoteBody note={n} />
          <ReadOnlyVersions versions={n.others} onEdit={(v) => edit(n, n.prompt, v)} />
        </div>
        <div className="strip-actions">
          <button type="button" className="quiet-link" aria-label={`Edit: ${n.thought}`} onClick={() => edit(n, n.prompt)}>
            Edit
          </button>
        </div>
      </li>
    );
  const own = notes.filter((n) => n.prompt === null || !ALL_PROMPTS.has(n.prompt));
  // A note deleted on another device while she was changing it here: her editor stays open.
  const orphan = editing && !editing.isNew && !notes.some((n) => n.id === editing.id) ? editing : null;
  const newOwn = editing && editing.isNew && (editing.prompt === null || !ALL_PROMPTS.has(editing.prompt)) ? editing : null;

  return (
    <div className="notes">
      <p className="journal-muted">{NOTES_INTRO}</p>
      {unreadable > 0 && <p className="journal-muted">{CANT_OPEN}</p>}
      {today2.length > 0 && (
        <Group title="To read today">
          {today2.map((n) => (
            <TodayNote key={n.id} note={n} read={ticked[n.id] ?? readHere.has(n.id)} onTick={(on) => void tick(n, on)} />
          ))}
        </Group>
      )}
      {NOTE_GROUPS.map((g) => (
        <Group key={g.id} title={g.title}>
          {g.prompts.flatMap((p) => {
            const mine = notes.filter((n) => n.prompt === p);
            if (editing && editing.isNew && editing.prompt === p) return [...mine.map(card), editor(editing)];
            // A new answer she started here and hasn't saved keeps its way back in, even once the
            // prompt has a note (one from another device, say: bug #27).
            const started = drafts.some((d) => d.fields.prompt === p && !notes.some((n) => n.id === d.id));
            if (mine.length > 0 && !started) return mine.map(card);
            return [
              ...mine.map(card),
              <li key={p} className="strip no-tick notes-prompt">
                <div className="strip-body">
                  <div className="strip-title">{p}</div>
                </div>
                <div className="strip-actions">
                  <button type="button" className="quiet-link" aria-label={`+ Write your answer: ${p}`} onClick={() => edit(null, p)}>
                    + Write your answer
                  </button>
                </div>
              </li>,
            ];
          })}
        </Group>
      ))}
      <Group title="My own thoughts">
        {orphan && editor(orphan, true)}
        {own.map(card)}
        {newOwn && editor(newOwn)}
      </Group>
      {!newOwn && (
        <div className="btn-group">
          <button type="button" className="quiet-link" onClick={() => edit(null, null)}>
            + My own thought
          </button>
        </div>
      )}
      {problem && <p role="alert">{problem}</p>}
    </div>
  );
}

/**
 * A note's other versions (written on another device without seeing the one shown), each under
 * "Another version (from …)", and with `onEdit` its own Edit: changing or deleting one leaves
 * every other version as it is (R-I1).
 */
function ReadOnlyVersions({ versions, onEdit }: { versions: NoteVersion[]; onEdit?: (v: NoteVersion) => void }) {
  if (versions.length === 0) return null;
  return (
    <>
      {versions.map((o) => (
        <div key={o.vid}>
          <p className="journal-muted">
            {anotherVersion(o.at)}
            {onEdit && (
              <>
                {" "}
                <button type="button" className="quiet-link" aria-label={`Edit another version: ${o.thought}`} onClick={() => onEdit(o)}>
                  Edit
                </button>
              </>
            )}
          </p>
          <NoteBody note={o} />
        </div>
      ))}
    </>
  );
}

/** A titled group of strips (her own exercise label heading over a strip list). */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  const items = Array.isArray(children) ? children.flat().filter(Boolean) : children ? [children] : [];
  return (
    <div role="group" aria-labelledby={id} className="notes-group">
      <h3 id={id} className="exercise-label">
        {title}
      </h3>
      {items.length > 0 && <ul className="strip-list">{children}</ul>}
    </div>
  );
}

/** A note's words: the thought, her steady answer, and the memory and skill if she wrote them. */
function NoteBody({ note }: { note: NoteVersion }) {
  return (
    <div className="strip-body notes-body">
      <div className="strip-meta">{THOUGHT}</div>
      <div className="strip-title">{note.thought}</div>
      <div className="strip-meta">{STEADY}</div>
      <p className="notes-steady">{note.steady}</p>
      {note.memory.trim() && (
        <>
          <div className="strip-meta">{MEMORY}</div>
          <p>{note.memory}</p>
        </>
      )}
      {note.skill.trim() && (
        <>
          <div className="strip-meta">{SKILL}</div>
          <p>{note.skill}</p>
        </>
      )}
    </div>
  );
}

/** One of today's notes to reread: the strip's own tick box, "I read this today". */
function TodayNote({ note, read, onTick }: { note: Note; read: boolean; onTick: (on: boolean) => void }) {
  const id = useId();
  return (
    <li className="strip notes-today">
      <input
        id={id}
        type="checkbox"
        className="tick"
        aria-label={`I read this today: ${note.thought}`}
        checked={read}
        onChange={(e) => onTick(e.target.checked)}
      />
      <div>
        <NoteBody note={note} />
        <ReadOnlyVersions versions={note.others} />
        <label htmlFor={id} className="strip-meta notes-read-label">
          I read this today
        </label>
      </div>
      <div className="strip-actions" />
    </li>
  );
}

/**
 * Writing or changing a note: the thought (a prompt's words to start), her answer, and the two
 * optional boxes. What she types is kept as this device's draft after a pause, on leaving a
 * box, when the app is hidden and when the editor goes away (review I2).
 */
function NoteEditor({
  jk, deviceId, editing, start, onTyped, onSave, onCancel, onDelete, onProblem,
}: {
  jk: JournalKey;
  deviceId: string;
  editing: Editing;
  start: NoteFields;
  onTyped: (f: NoteFields) => void;
  onSave: (f: NoteFields) => Promise<void>;
  /** Cancelled: `landing` settles once any draft save still in flight has landed. */
  onCancel: (landing: Promise<unknown>) => void;
  onDelete?: () => Promise<void>;
  onProblem: (p: string) => void;
}) {
  const [f, setF] = useState<NoteFields>(start);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const ready = f.thought.trim() !== "" && f.steady.trim() !== "";
  const latest = useRef(f);
  const saved = useRef(JSON.stringify(editing.start));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  // Saved, cancelled or deleted: nothing more is kept as a draft.
  const closed = useRef(false);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (closed.current) return;
    const v = latest.current;
    const k = JSON.stringify(v);
    if (k === saved.current) return;
    saved.current = k;
    queue.current = queue.current
      .then(() => saveNoteDraft(jk, deviceId, editing.id, v, editing.seen))
      .catch(() => {
        if (saved.current === k) saved.current = "";
        onProblem(SAVE_PROBLEM);
      });
  }, [jk, deviceId, editing.id, editing.seen, onProblem]);
  useEffect(() => () => flush(), [flush]);
  useHiddenFlush(flush);

  function set(part: Partial<NoteFields>) {
    const next = { ...latest.current, ...part };
    latest.current = next;
    setF(next);
    onTyped(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, AUTOSAVE_MS);
  }

  /** Cancel closes at once (no waiting on a slow save); nothing more is kept as a draft. */
  function cancelNow() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    closed.current = true;
    onCancel(queue.current);
  }

  /** Saving or deleting: the draft stops, and waits for one in flight to land first. */
  async function close(fn: () => Promise<void> | void) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    closed.current = true;
    setBusy(true);
    try {
      await queue.current;
      await fn();
    } catch {
      closed.current = false; // still hers: keep keeping it
      onProblem(SAVE_PROBLEM);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="notes-editor"
      aria-label="Your note"
      onBlur={flush}
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void close(() => onSave(latest.current));
      }}
    >
      <label className="form-field">
        <span className="form-label">{THOUGHT}</span>
        <AutoGrowTextarea rows={2} value={f.thought} onChange={(e) => set({ thought: e.target.value })} />
      </label>
      <label className="form-field">
        <span className="form-label">{STEADY}</span>
        <AutoGrowTextarea className="journal-answer" rows={4} value={f.steady} onChange={(e) => set({ steady: e.target.value })} autoFocus />
      </label>
      <label className="form-field">
        <span className="form-label">{`${MEMORY} (optional)`}</span>
        <AutoGrowTextarea rows={2} value={f.memory} onChange={(e) => set({ memory: e.target.value })} />
      </label>
      <label className="form-field">
        <span className="form-label">{`${SKILL} (optional)`}</span>
        <AutoGrowTextarea rows={2} value={f.skill} onChange={(e) => set({ skill: e.target.value })} />
      </label>
      {asking && onDelete ? (
        <div className="btn-group">
          <p>Delete this note?</p>
          <button type="button" disabled={busy} onClick={() => void close(onDelete)}>
            Delete it
          </button>
          <button type="button" className="btn-secondary" onClick={() => setAsking(false)}>
            Keep it
          </button>
        </div>
      ) : (
        <div className="btn-group">
          <button type="submit" disabled={busy || !ready}>
            Save
          </button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={cancelNow}>
            Cancel
          </button>
          {onDelete && (
            <button type="button" className="btn-secondary" onClick={() => setAsking(true)}>
              Delete
            </button>
          )}
        </div>
      )}
    </form>
  );
}

/**
 * "Hard moment" (journal v3): every note she has written, straight away, in the Journal's
 * pop-up (full screen on the phone). Nothing to do here but read.
 */
export function HardMomentView({ jk, onClose }: { jk: JournalKey; onClose: () => void }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [unreadable, setUnreadable] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    listNotes(jk).then(
      (r) => {
        if (!alive) return;
        setNotes(r.notes);
        setUnreadable(r.unreadable);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [jk]);
  return (
    <JournalSheet title="Notes to myself" line="Written by you, when you felt steady." onClose={onClose} className="notes-hard">
      {unreadable > 0 && !failed && <p className="journal-muted">{CANT_OPEN}</p>}
      {failed ? (
        <p>{CANT_OPEN}</p>
      ) : notes === null ? (
        <p className="journal-muted" role="status">
          {LOADING_LINE}
        </p>
      ) : notes.length === 0 ? (
        <p className="notes-hard-empty">
          You haven't written any notes yet. When you feel steady, you can write some in{" "}
          <Link to="/journal/notes" onClick={onClose}>
            Notes to myself
          </Link>
          .
        </p>
      ) : (
        <ul className="strip-list notes-hard-list">
          {notes.map((n) => (
            <li key={n.id} className="strip no-tick notes-card">
              <div>
                <NoteBody note={n} />
                <ReadOnlyVersions versions={n.others} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </JournalSheet>
  );
}
