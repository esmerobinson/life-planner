import { useCallback, useEffect, useState } from "react";
import type { HubDB } from "../../data/db";
import { giveOldPassphrase, journalNeedsOldPassphrase } from "../../journal/keyStore";
import { useDbChanges } from "./useJournalKey";

// Placeholder wording (Esme may reword; journal-rekey report lists it). Shown once, on the
// Sync page and on the Journal, when sync has accepted a new passphrase but this device's
// journal key was set up before the re-key update, so it can't carry the journal over by itself.
export const OLD_PASSPHRASE_HEADING = "Type your old passphrase once";
export const OLD_PASSPHRASE_LINE =
  "Sync now uses your new passphrase. So that the new one also opens your journal on your other devices, type your old passphrase here once.";
export const OLD_PASSPHRASE_LABEL = "Old passphrase";
export const OLD_PASSPHRASE_WRONG = "That isn't your old passphrase. Try again.";
export const OLD_PASSPHRASE_DONE = "Done. Your new passphrase now opens your journal on your other devices too.";
const FAILED = "That didn't work. Try again.";

/** Whether this device should ask for the old passphrase, re-checked whenever the database changes. */
function useNeedsOldPassphrase(db: HubDB): boolean {
  const [needs, setNeeds] = useState(false);
  const check = useCallback(() => {
    void journalNeedsOldPassphrase(db).then(setNeeds, () => setNeeds(false));
  }, [db]);
  useEffect(check, [check]);
  useDbChanges(check);
  return needs;
}

/**
 * The one-time old-passphrase prompt (journal-rekey brief point 5). The passphrase is held only
 * in this field until Save; never stored, never logged. Renders nothing when not needed.
 */
export function OldPassphrasePrompt({ db, className }: { db: HubDB; className?: string }) {
  const needs = useNeedsOldPassphrase(db);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !passphrase) return;
    const secret = passphrase;
    setPassphrase("");
    setProblem("");
    setBusy(true);
    try {
      if ((await giveOldPassphrase(db, secret)) === "ok") setDone(true);
      else setProblem(OLD_PASSPHRASE_WRONG);
    } catch {
      setProblem(FAILED);
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className={className} role="status">
        {OLD_PASSPHRASE_DONE}
      </p>
    );
  }
  if (!needs) return null;
  return (
    <section className={className} aria-labelledby="old-passphrase-heading">
      <h2 id="old-passphrase-heading">{OLD_PASSPHRASE_HEADING}</h2>
      <p>{OLD_PASSPHRASE_LINE}</p>
      <form onSubmit={(e) => void submit(e)}>
        <label className="form-field">
          <span className="form-label">{OLD_PASSPHRASE_LABEL}</span>
          <input type="password" autoComplete="off" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={busy || !passphrase}>
            Save
          </button>
        </div>
      </form>
      {problem && <p role="alert">{problem}</p>}
    </section>
  );
}
