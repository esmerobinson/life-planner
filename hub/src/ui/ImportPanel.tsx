import { useRef, useState } from "react";
import { importBacklog, type ImportNote } from "../import/backlog";
import type { ISODate } from "../domain/types";

export function ImportPanel({ today, onImported }: { today: ISODate; onImported?: () => void }) {
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
      const r = await importBacklog(text, today);
      setResult(`Added ${r.added}, already had ${r.alreadyHad}, notes ${r.skipped}`);
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
      <h2>Import Backlog.md</h2>
      <label className="form-field">
        <span className="form-label">Backlog file</span>
        <input type="file" accept=".md,.txt" onChange={(e) => void onFile(e)} />
      </label>
      <label className="form-field">
        <span className="form-label">Backlog text</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} />
      </label>
      <div className="form-actions">
        <button type="button" disabled={running} onClick={() => void run()}>
          Import
        </button>
      </div>
      {result && <p>{result}</p>}
      {notes.length > 0 && (
        <details>
          <summary>{`Notes (${notes.length})`}</summary>
          <ul aria-label="Import notes">
            {notes.map((n, i) => (
              <li key={i}>{`${n.reason}: ${n.line}`}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
