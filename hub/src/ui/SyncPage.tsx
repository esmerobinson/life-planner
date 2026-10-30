import { useEffect, useRef, useState } from "react";
import { syncController, useSyncState } from "../sync";
import type { SyncController } from "../sync/controller";
import { DEFAULT_SYNC_URL, getMeta, saveSyncSettings, stopSyncing } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { confirmJournalKey, saveJournalKeyFromSync } from "../journal/keyStore";
import { MAX_PAIRING_PASSPHRASE } from "../pairing/pairingText";
import { PairingCode, ScanPairingCode, TOO_LONG } from "./Pairing";

/** Placeholder copy (Esme may reword): the server limits wrong passphrases (5 per 15 minutes). */
export const LOCKOUT_LINE =
  "After several wrong passphrases, sync stops accepting tries for 15 minutes. Wait, then try again.";

/** "Last synced" time: the time today, or the date and time on another day. */
function when(ms: number): string {
  const d = new Date(ms);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/** https anywhere; plain http only for this machine (a local test server). */
function validAddress(text: string): boolean {
  try {
    const u = new URL(text);
    return u.protocol === "https:" || (u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname));
  } catch {
    return false;
  }
}

export function SyncPage({ controller = syncController }: { controller?: SyncController }) {
  const state = useSyncState(controller);
  // A saved address (applied below once read) wins; else the build's VITE_SYNC_URL; else the
  // deployed server, so on a new device only the passphrase has to be typed.
  const [address, setAddress] = useState<string>(import.meta.env.VITE_SYNC_URL || DEFAULT_SYNC_URL);
  const addressEdited = useRef(false);
  // Never logged, never stored; cleared the moment it is used.
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState("");
  // Pairing (pair a device by QR code). The passphrase saved in THIS page visit, kept only in
  // memory so "Pair another device" can show it as a code; gone when the page is left.
  const [savedSecret, setSavedSecret] = useState<string | null>(null);
  // The passphrase whose code is on screen (null: hidden). Also only in memory.
  const [shownSecret, setShownSecret] = useState<string | null>(null);
  // "Show pairing code" later: the passphrase pasted for it. Cleared once used.
  const [showField, setShowField] = useState("");
  const [showProblem, setShowProblem] = useState("");

  useEffect(() => {
    void controller.reload();
  }, [controller]);

  // Show the stored address once it has been read (unless the field was already edited).
  useEffect(() => {
    if (state.serverUrl && !addressEdited.current) setAddress(state.serverUrl);
  }, [state.serverUrl]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!validAddress(address.trim()) || !passphrase) {
      await commit(passphrase); // says what is missing; the typed passphrase stays in the field
      return;
    }
    const secret = passphrase;
    setPassphrase("");
    await commit(secret);
  }

  /**
   * Save: the one routine for a typed passphrase and for a scanned or pasted pairing code.
   * Derives the sync token and the journal's candidate key from `secret`.
   */
  async function commit(secret: string) {
    if (busy) return;
    setNote("");
    setProblem("");
    const serverUrl = address.trim();
    if (!validAddress(serverUrl)) {
      setProblem("Enter the sync address, starting with https://.");
      return;
    }
    if (!secret) {
      setProblem("Enter the passphrase.");
      return;
    }
    setShownSecret(null);
    setSavedSecret(null);
    // Save stays disabled until the whole save (both derivations) is done, so two Saves never
    // overlap (security re-review, fix round 2).
    setBusy(true);
    try {
      const token = await deriveToken(secret);
      await saveSyncSettings(controller.db, { serverUrl, token });
      controller.clearError();
      await controller.reload();
      setNote("Saved.");
    } catch {
      setProblem("That did not save. Try again.");
      setBusy(false);
      return;
    }
    setSavedSecret(secret);
    // The journal's key from the same passphrase is only a candidate, bound to this token: it
    // can't seal anything until the verifier or the server accepting exactly this token
    // confirms it (review C1). Sync is saved either way; a failure here only means the Journal
    // asks to unlock.
    const journal = saveJournalKeyFromSync(controller.db, secret).catch(() => undefined);
    const sync = controller.syncNow();
    try {
      await journal;
    } finally {
      setBusy(false);
    }
    await sync;
    await confirmJournalKey(controller.db).catch(() => undefined);
  }

  /**
   * The code was hidden (Hide, after 60 s, or the app going to the background): the passphrase
   * is forgotten too, so showing it again needs the passphrase typed or pasted.
   */
  function hideCode() {
    setShownSecret(null);
    setSavedSecret(null);
    setShowField("");
  }

  /** "Show pairing code" from a pasted passphrase: only the one this device syncs with. */
  async function showFromField(e: React.FormEvent) {
    e.preventDefault();
    const secret = showField;
    setShowField("");
    setShowProblem("");
    if (!secret) return;
    if (secret.length > MAX_PAIRING_PASSPHRASE) {
      setShowProblem(TOO_LONG);
      return;
    }
    try {
      const token = await getMeta<string>(controller.db, "token");
      if (token && (await deriveToken(secret)) !== token) {
        setShowProblem("That isn't the passphrase this device syncs with.");
        return;
      }
    } catch {
      setShowProblem("That didn't work. Try again.");
      return;
    }
    setShownSecret(secret);
  }

  async function stop() {
    setNote("");
    setProblem("");
    setShownSecret(null);
    setSavedSecret(null);
    try {
      await stopSyncing(controller.db);
      await controller.reload();
    } catch {
      setProblem("That did not save. Try again.");
    }
  }

  const waiting = state.pendingCount;
  // A refused passphrase is never offered as a code.
  const canPair = state.configured && state.status !== "needs-passphrase";

  return (
    <section className="sync-page">
      <h1>Sync</h1>
      <p>
        Sync keeps your tasks and goals the same on every device where you enter the passphrase. Everything still works
        without a connection and syncs when one is back.
      </p>

      <form onSubmit={(e) => void save(e)}>
        <label className="form-field">
          <span className="form-label">Sync address</span>
          <input
            type="url"
            value={address}
            onChange={(e) => {
              addressEdited.current = true;
              setAddress(e.target.value);
            }}
          />
        </label>
        <label className="form-field">
          <span className="form-label">Passphrase</span>
          <input
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </label>
        <p>
          The passphrase itself is not kept. A key made from it is stored on this device so sync can run by itself;
          Stop syncing removes it. The same passphrase also unlocks your journal on this device.
        </p>
        <p>{LOCKOUT_LINE}</p>
        <div className="form-actions">
          <button type="submit" disabled={busy}>
            Save
          </button>
        </div>
      </form>

      <h2>Pair a device</h2>
      <p>Set up another device without typing: show a pairing code here, then scan it on the other device.</p>
      {shownSecret !== null ? (
        <PairingCode passphrase={shownSecret} onHide={hideCode} />
      ) : savedSecret !== null && canPair ? (
        <div className="form-actions">
          <button type="button" className="btn-secondary" onClick={() => setShownSecret(savedSecret)}>
            Pair another device
          </button>
        </div>
      ) : (
        canPair && (
          <form onSubmit={(e) => void showFromField(e)}>
            <label className="form-field">
              <span className="form-label">Passphrase for the pairing code</span>
              <input type="password" autoComplete="off" value={showField} onChange={(e) => setShowField(e.target.value)} />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn-secondary" disabled={!showField}>
                Show pairing code
              </button>
            </div>
            {showProblem && <p role="alert">{showProblem}</p>}
          </form>
        )
      )}
      <ScanPairingCode busy={busy} onPassphrase={(secret) => commit(secret)} />

      <h2>Status</h2>
      {!state.syncOn && <p>Sync is off on this device.</p>}
      {state.status === "syncing" && <p role="status">Syncing.</p>}
      {state.configured && (state.lastSyncedAt ? <p>{`Last synced ${when(state.lastSyncedAt)}`}</p> : <p>Not synced yet.</p>)}
      {waiting > 0 && <p>{waiting === 1 ? "1 change waiting" : `${waiting} changes waiting`}</p>}
      {state.stuckCount > 0 && (
        <p>
          {state.stuckCount === 1
            ? "1 change could not be sent. It is kept on this device."
            : `${state.stuckCount} changes could not be sent. They are kept on this device.`}
        </p>
      )}
      {state.quarantineCount > 0 && (
        <p>
          {state.quarantineCount === 1
            ? "1 item from another device couldn't be read yet"
            : `${state.quarantineCount} items from another device couldn't be read yet`}
        </p>
      )}
      {state.message && <p role="alert">{state.message}</p>}
      {note && <p role="status">{note}</p>}
      {problem && <p role="alert">{problem}</p>}

      <div className="form-actions">
        <button
          type="button"
          className="btn-secondary"
          disabled={!state.configured || state.status === "syncing"}
          onClick={() => void controller.syncNow()}
        >
          Sync now
        </button>
        {/* Also after a refused passphrase, so Replace, Merge and imports are never stuck behind it. */}
        {state.syncOn && (
          <button type="button" className="btn-secondary" onClick={() => void stop()}>
            Stop syncing on this device
          </button>
        )}
      </div>
    </section>
  );
}
