import { useRef, useState } from "react";
import { importBacklog } from "../import/backlog";
import type { ISODate } from "../domain/types";

export function ImportPanel({ today, onImported }: { today: ISODate; onImported?: () => void }) {
  const [text, setText] = useState("");
  const [result, setResult] = useState("");
  const [running, setRunning] = useState(false);
  const inFlight = useRef(false);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setText(await file.text());
      setResult("");
    } catch {
      setResult("That file could not be read.");
    }
  }

  async function run() {
    if (inFlight.current) return;
    if (!text.trim()) {
      setResult("Paste some text or choose a file first.");
      return;
    }
    inFlight.current = true;
    setRunning(true);
    try {
      const r = await importBacklog(text, today);
      setResult(`Added ${r.added}, already had ${r.alreadyHad}, notes ${r.skipped}`);
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
      <label>
        Backlog file
        <input type="file" accept=".md,.txt" onChange={(e) => void onFile(e)} />
      </label>
      <label>
        Backlog text
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} />
      </label>
      <button type="button" disabled={running} onClick={() => void run()}>
        Import
      </button>
      {result && <p>{result}</p>}
    </section>
  );
}
