import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { db } from "../../data/db";
import { unlockJournal, type UnlockResult } from "../../journal/keyStore";
import type { ISODate } from "../../domain/types";
import { syncController } from "../../sync";
import type { SyncController } from "../../sync/controller";
import { getDeviceId } from "../../sync/engine";
import { DailyCheckIn } from "./DailyCheckIn";
import { MorningPages } from "./MorningPages";
import { useJournalKey } from "./useJournalKey";

/** The Home card's buttons land on these sections. */
export const MORNING_HASH = "#morning-pages";
export const CHECKIN_HASH = "#daily-check-in";
/** While a typed passphrase waits for sync to accept it (review C1's suggested words). */
export const CHECKING_LINE = "Checking your passphrase with sync…";

/**
 * The Journal (journal brief): morning pages, then the daily check-in. Everything here is
 * end-to-end encrypted. Only a CONFIRMED key shows or writes entries; without one the page
 * shows "Unlock journal", or "Checking your passphrase with sync…" while a typed passphrase
 * waits for sync to accept it. Synced entries still arrive and wait, sealed.
 */
export function JournalPage({ today, controller = syncController }: { today: ISODate; controller?: SyncController }) {
  const view = useJournalKey();
  const location = useLocation();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const asked = useRef(false);

  useEffect(() => {
    void getDeviceId(db).then(setDeviceId, () => setDeviceId(null));
  }, []);

  // A candidate key is confirmed by a successful sync: ask for one (once per visit).
  useEffect(() => {
    if (view.state !== "checking" || asked.current) return;
    asked.current = true;
    void controller.syncNow().catch(() => undefined);
  }, [view.state, controller]);

  const ready = view.state === "confirmed" && deviceId !== null;
  // From the Home card: bring the chosen section into view once it is there.
  useEffect(() => {
    if (!ready || !location.hash) return;
    const id = location.hash === CHECKIN_HASH ? "daily-check-in-section" : location.hash === MORNING_HASH ? "morning-pages-section" : null;
    if (!id) return;
    const t = setTimeout(() => document.getElementById(id)?.scrollIntoView?.({ block: "start" }), 0);
    return () => clearTimeout(t);
  }, [ready, location.hash]);

  return (
    <div className="journal-page">
      <h1>Journal</h1>
      {view.state === "loading" ? null : view.state === "confirmed" ? (
        deviceId && (
          <>
            <MorningPages jk={view.jk} today={today} deviceId={deviceId} />
            <DailyCheckIn jk={view.jk} today={today} deviceId={deviceId} />
            {/* A third section ("Mental health exercise") is planned below these, in a later round. */}
          </>
        )
      ) : view.state === "checking" ? (
        <section className="journal-card" aria-labelledby="unlock-journal">
          <h2 id="unlock-journal" className="journal-big">
            Unlock journal
          </h2>
          <p role="status">{CHECKING_LINE}</p>
          <p>
            <Link to="/sync">Sync</Link>
          </p>
        </section>
      ) : (
        <UnlockJournal />
      )}
    </div>
  );
}

const PROBLEMS: Record<Exclude<UnlockResult, "ok" | "checking"> | "failed", React.ReactNode> = {
  wrong: "That isn't the journal's passphrase. Try again.",
  "no-sync": (
    <>
      Set up sync on this device first, then unlock the journal here. <Link to="/sync">Sync</Link>
    </>
  ),
  "sync-unconfirmed": (
    <>
      That doesn't match the passphrase saved on the Sync page, and sync hasn't accepted that one yet. If it has a typo,
      enter it again there. <Link to="/sync">Sync</Link>
    </>
  ),
  failed: "That didn't work. Try again.",
};

/** The passphrase is held only in this field until Unlock; never stored, never logged. */
function UnlockJournal() {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<keyof typeof PROBLEMS | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const secret = passphrase;
    setPassphrase("");
    setProblem(null);
    setBusy(true);
    try {
      const result = await unlockJournal(db, secret);
      if (result !== "ok" && result !== "checking") setProblem(result);
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
      {problem && <p role="alert">{PROBLEMS[problem]}</p>}
    </section>
  );
}
