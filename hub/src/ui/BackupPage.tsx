import { useContext, useEffect, useRef, useState } from "react";
import { exportBackup, INVALID_BACKUP, restoreBackup } from "../data/backup";
import { requestPersistence, type PersistenceStatus } from "../data/storage";
import type { ISODate } from "../domain/types";
import { ShellContext } from "./shellContext";

const PERSISTENCE_TEXT: Record<PersistenceStatus, string> = {
  persisted: "Your browser has agreed to keep this data.",
  "not-persisted": "Your browser has not promised to keep this data. Download backups regularly.",
  unsupported: "This browser cannot promise to keep data.",
};

export function BackupPage({ today }: { today: ISODate }) {
  const shell = useContext(ShellContext);
  const [ownStatus, setOwnStatus] = useState<PersistenceStatus | null>(null);
  const persistence = shell?.persistence ?? ownStatus;
  const [text, setText] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  // Inside the shell the status comes from its single start-up request.
  const inShell = shell !== null;
  useEffect(() => {
    if (inShell) return;
    let live = true;
    void requestPersistence().then((s) => live && setOwnStatus(s));
    return () => {
      live = false;
    };
  }, [inShell]);

  async function download() {
    setError("");
    try {
      const file = await exportBackup(today);
      const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `life-hub-backup-${file.exportedOn}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMessage("Backup downloaded.");
    } catch {
      setMessage("");
      setError("The backup could not be made. Try again.");
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setMessage("");
    setError("");
    setConfirmed(false);
    if (!file) return;
    try {
      setText(await file.text());
      setFileName(file.name);
    } catch {
      setText(null);
      setFileName("");
      setError("That file could not be read.");
    }
  }

  async function restore() {
    if (inFlight.current || text === null) return;
    if (mode === "replace" && !confirmed) return;
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const r = await restoreBackup(text, mode);
      setMessage(
        `Added ${r.addedItems} ${r.addedItems === 1 ? "task" : "tasks"} and ${r.addedGoals} ${
          r.addedGoals === 1 ? "goal" : "goals"
        }. ${r.skipped} already here.`,
      );
      setConfirmed(false);
      await shell?.refresh();
    } catch (err) {
      setError(err instanceof Error && err.message === INVALID_BACKUP ? INVALID_BACKUP : "The restore did not work. Nothing was changed.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const replacing = mode === "replace";

  return (
    <section className="backup-page">
      <h1>Backup</h1>
      <p>Your tasks are saved in this browser only.</p>
      {persistence && <p>{PERSISTENCE_TEXT[persistence]}</p>}

      <h2>Download a backup</h2>
      <button type="button" onClick={() => void download()}>
        Download backup
      </button>

      <h2>Restore from a backup</h2>
      <label>
        Backup file
        <input type="file" accept=".json,application/json" onChange={(e) => void onFile(e)} />
      </label>
      {fileName && <p>{`Chosen: ${fileName}`}</p>}
      <fieldset>
        <legend>How to restore</legend>
        <label>
          <input type="radio" name="restore-mode" checked={!replacing} onChange={() => setMode("merge")} />
          Merge (add what is missing)
        </label>
        <label>
          <input type="radio" name="restore-mode" checked={replacing} onChange={() => setMode("replace")} />
          Replace everything
        </label>
      </fieldset>

      {!replacing && (
        <button type="button" disabled={busy || text === null} onClick={() => void restore()}>
          Merge
        </button>
      )}
      {replacing && (
        <div>
          <p>Download a backup first.</p>
          <button type="button" onClick={() => void download()}>
            Download backup
          </button>
          <p>Replace removes everything here and puts the file's tasks and goals in its place.</p>
          <label>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I understand replace removes what is here now
          </label>
          <button type="button" disabled={busy || text === null || !confirmed} onClick={() => void restore()}>
            Replace
          </button>
        </div>
      )}

      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
