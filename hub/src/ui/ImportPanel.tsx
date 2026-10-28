import { useRef, useState } from "react";
import { importBacklog, type ImportNote } from "../import/backlog";
import { importGoogleTasks, type SkippedDuplicate } from "../import/googleTasks";
import type { ISODate } from "../domain/types";
import { useSyncState } from "../sync";
import { mergeBlocked, WAITING_FIRST_SYNC } from "../data/syncGate";

interface Props {
  today: ISODate;
  onImported?: () => void;
}

interface Outcome {
  summary: string;
  notes: ImportNote[];
  duplicates?: SkippedDuplicate[];
}

/** Shared by both sections: text box, file input, in-flight guard, result line, notes. */
function ImportSection({
  heading,
  fileLabel,
  textLabel,
  accept,
  buttonLabel,
  notesLabel,
  runImport,
  onImported,
}: {
  heading: string;
  fileLabel: string;
  textLabel: string;
  accept: string;
  buttonLabel: string;
  notesLabel: string;
  runImport: (text: string) => Promise<Outcome>;
  onImported?: () => void;
}) {
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [notes, setNotes] = useState<ImportNote[]>([]);
  const [duplicates, setDuplicates] = useState<SkippedDuplicate[]>([]);
  const [running, setRunning] = useState(false);
  const inFlight = useRef(false);
  // While this device has not finished its first sync, imports would add copies of rows
  // the server may already have; they wait.
  const waiting = mergeBlocked(useSyncState());

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setText(await file.text());
      setResult("");
      setNotes([]);
    } catch {
      setResult("That file could not be read.");
    }
  }

  async function run() {
    if (inFlight.current) return;
    setNotes([]);
    setDuplicates([]);
    if (!text.trim()) {
      setResult("Paste some text or choose a file first.");
      return;
    }
    inFlight.current = true;
    setRunning(true);
    try {
      const r = await runImport(text);
      setResult(r.summary);
      setNotes(r.notes);
      setDuplicates(r.duplicates ?? []);
      onImported?.();
    } catch (err) {
      setResult(err instanceof Error && err.message === WAITING_FIRST_SYNC ? WAITING_FIRST_SYNC : "The import did not work.");
    } finally {
      inFlight.current = false;
      setRunning(false);
    }
  }

  return (
    <section className="import-panel">
      <h2>{heading}</h2>
      <label className="form-field">
        <span className="form-label">{fileLabel}</span>
        <input type="file" accept={accept} onChange={(e) => void onFile(e)} />
      </label>
      <label className="form-field">
        <span className="form-label">{textLabel}</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} />
      </label>
      <div className="form-actions">
        <button type="button" disabled={running || waiting} onClick={() => void run()}>
          {buttonLabel}
        </button>
      </div>
      {waiting && <p>{WAITING_FIRST_SYNC}</p>}
      {result && <p>{result}</p>}
      {notes.length > 0 && (
        <details>
          <summary>{`Notes (${notes.length})`}</summary>
          <ul aria-label={notesLabel}>
            {notes.map((n, i) => (
              <li key={i}>{n.line ? `${n.reason}: ${n.line}` : n.reason}</li>
            ))}
          </ul>
        </details>
      )}
      {duplicates.length > 0 && (
        <details>
          <summary>{`Same title, not added (${duplicates.length})`}</summary>
          <ul aria-label="Same title tasks not added">
            {duplicates.map((d, i) => (
              <li key={i}>
                {`${d.title} (from ${d.listTitle})${d.hadNotes ? " - had notes" : ""}${d.hadDue ? " - had a due date" : ""}`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export const NOT_GOOGLE_EXPORT = "That is not a Google Tasks export.";

export function ImportPanel({ today, onImported }: Props) {
  return (
    <>
      <ImportSection
        heading="Import Backlog.md"
        fileLabel="Backlog file"
        textLabel="Backlog text"
        accept=".md,.txt"
        buttonLabel="Import"
        notesLabel="Backlog import notes"
        onImported={onImported}
        runImport={async (text) => {
          const r = await importBacklog(text, today);
          return {
            summary: `Added ${r.added}, already had ${r.alreadyHad}, notes ${r.skipped}`,
            notes: r.notes,
          };
        }}
      />
      <ImportSection
        heading="Google Tasks (JSON file)"
        fileLabel="Google Tasks file"
        textLabel="Google Tasks text"
        accept=".json,application/json"
        buttonLabel="Import Google Tasks"
        notesLabel="Google Tasks import notes"
        onImported={onImported}
        runImport={async (text) => {
          let data: unknown;
          try {
            data = JSON.parse(text);
          } catch {
            return { summary: NOT_GOOGLE_EXPORT, notes: [] };
          }
          const r = await importGoogleTasks(data, today);
          return {
            summary: `Added ${r.added}, already had ${r.alreadyHad}, same title as an existing task ${r.duplicateTitles}, notes ${r.skipped}`,
            notes: r.notes,
            duplicates: r.duplicates,
          };
        }}
      />
    </>
  );
}
