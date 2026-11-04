import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CANT_OPEN, deleteNote, listNoteReads, listNotes, saveNote, setNoteRead, type Note, type NoteFields } from "../../data/repo";
import type { ISODate } from "../../domain/types";
import type { JournalKey } from "../../journal/crypto";
import { NOTE_GROUPS, todaysNotes } from "../../journal/notes";
import { LOADING_LINE, LoadLine, useLoadGuard } from "./bits";
import { JournalSheet } from "./JournalSheet";
import { useDbChanges } from "./useJournalKey";

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

/** What is open in the editor: a new note (for a prompt, or her own thought) or one to change. */
type Editing = { id: string | null; prompt: string | null };

/**
 * Notes to myself (journal v3; her partner's idea): while steady, she writes her own answers to
 * the thoughts that come up in hard moments. The tab shows one or two of her notes to reread
 * today (a gentle "I read this today" tick: no streak, no count), then the nine groups of
 * starter prompts (prompts only; every answer is hers), each with "+ Write your answer", then
 * her own thoughts and "+ My own thought". Every note is sealed like the rest of the journal
 * and always readable. This tab never ticks and isn't a Home or Today row.
 */
export function NotesToMyself({ jk, today, deviceId }: { jk: JournalKey; today: ISODate; deviceId: string }) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [byDay, setByDay] = useState<Map<ISODate, Set<string>>>(new Map());
  const [unreadable, setUnreadable] = useState(0);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [problem, setProblem] = useState("");
  // A tick shows at once; a failed save puts it back.
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const guardFail = useRef<() => void>(() => undefined);

  const load = useCallback(async () => {
    try {
      const [n, r] = await Promise.all([listNotes(jk), listNoteReads(jk)]);
      setNotes(n.notes);
      setUnreadable(n.unreadable);
      setByDay(r.byDay);
      setTicked({});
    } catch {
      guardFail.current();
    }
  }, [jk]);
  useEffect(() => void load(), [load]);
  useDbChanges(() => void load());
  // Never blank: "Loading…", then the can't-open line and Try again.
  const guard = useLoadGuard(notes === null, load);
  guardFail.current = guard.fail;

  const today2 = useMemo(() => (notes ? todaysNotes(notes, byDay, today) : []), [notes, byDay, today]);
  const readToday = byDay.get(today) ?? new Set<string>();

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

  async function save(fields: NoteFields, id: string | null) {
    await saveNote(jk, today, fields, id ?? undefined);
    setEditing(null);
    setProblem("");
    await load();
  }
  async function remove(id: string) {
    await deleteNote(jk, id);
    setEditing(null);
    setProblem("");
    await load();
  }

  if (notes === null) return <LoadLine guard={guard} />;

  const editor = (e: Editing, note: Note | null) => (
    <li key={`editor|${e.id ?? e.prompt ?? "own"}`}>
      <NoteEditor
        note={note}
        prompt={e.prompt}
        onCancel={() => setEditing(null)}
        onSave={(f) => save(f, e.id)}
        onDelete={note ? () => remove(note.id) : undefined}
        onProblem={setProblem}
      />
    </li>
  );
  const card = (n: Note) =>
    editing?.id === n.id ? (
      editor(editing, n)
    ) : (
      <li key={n.id} className="strip no-tick notes-card">
        <NoteBody note={n} />
        <div className="strip-actions">
          <button type="button" className="quiet-link" aria-label={`Edit: ${n.thought}`} onClick={() => setEditing({ id: n.id, prompt: n.prompt })}>
            Edit
          </button>
        </div>
      </li>
    );
  const own = notes.filter((n) => n.prompt === null || !ALL_PROMPTS.has(n.prompt));

  return (
    <div className="notes">
      <p className="journal-muted">{NOTES_INTRO}</p>
      {unreadable > 0 && <p className="journal-muted">{CANT_OPEN}</p>}
      {today2.length > 0 && (
        <Group title="To read today">
          {today2.map((n) => (
            <TodayNote key={n.id} note={n} read={ticked[n.id] ?? readToday.has(n.id)} onTick={(on) => void tick(n, on)} />
          ))}
        </Group>
      )}
      {NOTE_GROUPS.map((g) => (
        <Group key={g.id} title={g.title}>
          {g.prompts.flatMap((p) => {
            const mine = notes.filter((n) => n.prompt === p);
            if (editing && editing.id === null && editing.prompt === p) return [...mine.map(card), editor(editing, null)];
            if (mine.length > 0) return mine.map(card);
            return [
              <li key={p} className="strip no-tick notes-prompt">
                <div className="strip-body">
                  <div className="strip-title">{p}</div>
                </div>
                <div className="strip-actions">
                  <button
                    type="button"
                    className="quiet-link"
                    aria-label={`+ Write your answer: ${p}`}
                    onClick={() => setEditing({ id: null, prompt: p })}
                  >
                    + Write your answer
                  </button>
                </div>
              </li>,
            ];
          })}
        </Group>
      ))}
      <Group title="My own thoughts">
        {own.map(card)}
        {editing && editing.id === null && editing.prompt === null && editor(editing, null)}
      </Group>
      {!(editing && editing.id === null && editing.prompt === null) && (
        <div className="btn-group">
          <button type="button" className="quiet-link" onClick={() => setEditing({ id: null, prompt: null })}>
            + My own thought
          </button>
        </div>
      )}
      {problem && <p role="alert">{problem}</p>}
    </div>
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
function NoteBody({ note }: { note: Note }) {
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
        <label htmlFor={id} className="strip-meta notes-read-label">
          I read this today
        </label>
      </div>
      <div className="strip-actions" />
    </li>
  );
}

/** Writing or changing a note: the thought (a prompt's words to start), her answer, and the two optional boxes. */
function NoteEditor({
  note, prompt, onSave, onCancel, onDelete, onProblem,
}: {
  note: Note | null;
  prompt: string | null;
  onSave: (f: NoteFields) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
  onProblem: (p: string) => void;
}) {
  const [thought, setThought] = useState(note?.thought ?? prompt ?? "");
  const [steady, setSteady] = useState(note?.steady ?? "");
  const [memory, setMemory] = useState(note?.memory ?? "");
  const [skill, setSkill] = useState(note?.skill ?? "");
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const ready = thought.trim() !== "" && steady.trim() !== "";

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch {
      onProblem(SAVE_PROBLEM);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="notes-editor"
      aria-label="Your note"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) void run(() => onSave({ prompt: note ? note.prompt : prompt, thought, steady, memory, skill }));
      }}
    >
      <label className="form-field">
        <span className="form-label">{THOUGHT}</span>
        <textarea rows={2} value={thought} onChange={(e) => setThought(e.target.value)} />
      </label>
      <label className="form-field">
        <span className="form-label">{STEADY}</span>
        <textarea className="journal-answer" rows={4} value={steady} onChange={(e) => setSteady(e.target.value)} autoFocus />
      </label>
      <label className="form-field">
        <span className="form-label">{`${MEMORY} (optional)`}</span>
        <textarea rows={2} value={memory} onChange={(e) => setMemory(e.target.value)} />
      </label>
      <label className="form-field">
        <span className="form-label">{`${SKILL} (optional)`}</span>
        <textarea rows={2} value={skill} onChange={(e) => setSkill(e.target.value)} />
      </label>
      {asking && onDelete ? (
        <div className="btn-group">
          <p>Delete this note?</p>
          <button type="button" disabled={busy} onClick={() => void run(onDelete)}>
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
          <button type="button" className="btn-secondary" onClick={onCancel}>
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
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    listNotes(jk).then(
      (r) => alive && setNotes(r.notes),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [jk]);
  return (
    <JournalSheet title="Notes to myself" line="Written by you, when you felt steady." onClose={onClose} className="notes-hard">
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
              <NoteBody note={n} />
            </li>
          ))}
        </ul>
      )}
    </JournalSheet>
  );
}
