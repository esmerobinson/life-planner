import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { db } from "../../data/db";
import { unlockJournal } from "../../journal/keyStore";
import type { ISODate } from "../../domain/types";
import { DailyCheckIn } from "./DailyCheckIn";
import { MorningPages } from "./MorningPages";
import { useJournalKey } from "./useJournalKey";

/** The Home card's buttons land on these sections. */
export const MORNING_HASH = "#morning-pages";
export const CHECKIN_HASH = "#daily-check-in";

/**
 * The Journal (journal brief): morning pages, then the daily check-in. Everything here is
 * end-to-end encrypted; without the journal key on this device it shows only "Unlock
 * journal" and never shows or writes an entry (synced entries still arrive and wait).
 */
export function JournalPage({ today }: { today: ISODate }) {
  const { loaded, key } = useJournalKey();
  const location = useLocation();

  // From the Home card: bring the chosen section into view once it is there.
  useEffect(() => {
    if (!key || !location.hash) return;
    const id = location.hash === CHECKIN_HASH ? "daily-check-in-section" : location.hash === MORNING_HASH ? "morning-pages-section" : null;
    if (!id) return;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView?.({ block: "start" }), 0);
    return () => clearTimeout(t);
  }, [key, location.hash]);

  return (
    <div className="journal-page">
      <h1>Journal</h1>
      {!loaded ? null : key ? (
        <>
          <MorningPages cryptoKey={key} today={today} />
          <DailyCheckIn cryptoKey={key} today={today} />
          {/* A third section ("Mental health exercise") is planned below these, in a later round. */}
        </>
      ) : (
        <UnlockJournal />
      )}
    </div>
  );
}

/** The passphrase is held only in this field until Unlock; never stored, never logged. */
function UnlockJournal() {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<"wrong" | "no-sync" | "failed" | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const secret = passphrase;
    setPassphrase("");
    setProblem(null);
    setBusy(true);
    try {
      const result = await unlockJournal(db, secret);
      if (result !== "ok") setProblem(result);
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="journal-card" aria-labelledby="unlock-journal">
      <h2 id="unlock-journal" className="journal-big">
        Unlock journal
      </h2>
      <p>Your journal is private to you. Type your sync passphrase to open it on this device.</p>
      <form onSubmit={(e) => void submit(e)}>
        <label className="form-field">
          <span className="form-label">Sync passphrase</span>
          <input
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </label>
        <div className="form-actions">
          <button type="submit" disabled={busy || !passphrase}>
            Unlock
          </button>
        </div>
      </form>
      {problem === "wrong" && <p role="alert">That isn't the sync passphrase for this device. Try again.</p>}
      {problem === "no-sync" && (
        <p role="alert">
          Set up sync on this device first, then unlock the journal here. <Link to="/sync">Sync</Link>
        </p>
      )}
      {problem === "failed" && <p role="alert">That didn't work. Try again.</p>}
    </section>
  );
}
