import { useRef, useState } from "react";
import { importBacklog, type ImportNote } from "../import/backlog";
import { importGoogleTasks } from "../import/googleTasks";
import type { ISODate } from "../domain/types";

interface Props {
  today: ISODate;
  onImported?: () => void;
}

interface Outcome {
  summary: string;
  notes: ImportNote[];
}

/** Shared by both sections: text box, file input, in-flight guard, result line, notes. */
function ImportSection({
  heading,
  fileLabel,
  textLabel,
  accept,
  buttonLabel,
  runImport,
  onImported,
}: {
  heading: string;
  fileLabel: string;
  textLabel: string;
  accept: string;
  buttonLabel: string;
  runImport: (text: string) => Promise<Outcome>;
  onImported?: () => void;
}) {
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [notes, setNotes] = useState<ImportNote[]>([]);
  const [running, setRunning] = useState(false);
  const inFlight = useRef(false);

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
      onImported?.();
    } catch {
      setResult("The import did not work.");
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
        <button type="button" disabled={running} onClick={() => void run()}>
          {buttonLabel}
        </button>
      </div>
      {result && <p>{result}</p>}
      {notes.length > 0 && (
        <details>
          <summary>{`Notes (${notes.length})`}</summary>
          <ul aria-label="Import notes">
            {notes.map((n, i) => (
              <li key={i}>{n.line ? `${n.reason}: ${n.line}` : n.reason}</li>
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
          };
        }}
      />
    </>
  );
}
