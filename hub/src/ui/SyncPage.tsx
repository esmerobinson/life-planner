import { useEffect, useRef, useState } from "react";
import { syncController, useSyncState } from "../sync";
import type { SyncController } from "../sync/controller";
import { DEFAULT_SYNC_URL, getMeta, saveSyncSettings, stopSyncing } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { confirmJournalKey, giveOldPassphrase, journalSecretForPairing, saveJournalKeyFromPairing, saveJournalKeyFromSync } from "../journal/keyStore";
import { pairingCodeForDevice } from "../pairing/devicePairing";
import { MAX_PAIRING_PASSPHRASE, pairingText, type PairingPayload } from "../pairing/pairingText";
import { CODE_FAILED, PairingCode, ScanPairingCode, SYNC_ONLY_NOTE, TOO_LONG } from "./Pairing";
import { TogetherBox } from "./together/TogetherBox";
import { OldPassphrasePrompt } from "./journal/OldPassphrasePrompt";

/** Placeholder copy (Esme may reword): the server limits wrong passphrases (5 per 15 minutes). */
export const LOCKOUT_LINE =
  "After several wrong passphrases, sync stops accepting tries for 15 minutes. Wait, then try again.";
/** Placeholder copy (Esme may reword), 2026-11-17: above the passphrase field for a v1 code. */
export const PASSPHRASE_CODE_LINE =
  "Or type your passphrase to show a code made from it. Use this if the other device has an older version of Esmeworld.";
/** Placeholder copy (Esme may reword): a v2 code whose address isn't https (or this machine). */
export const BAD_CODE_ADDRESS = "That pairing code's sync address can't be used here.";

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

/** The page or app is in the background (a code made meanwhile is not shown). */
const backgrounded = () => typeof document !== "undefined" && document.visibilityState === "hidden";

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
  // Pairing (pair a device by QR code). "Pair another device" shows this device's v2 code (its
  // sync token, address and copy of the journal secret: no passphrase needed). The passphrase
  // saved in THIS page visit is kept only in memory as a fallback while the journal key is
  // still being confirmed (a v1 code then); gone when the page is left or a code is hidden.
  const [savedSecret, setSavedSecret] = useState<string | null>(null);
  // The pairing text on screen (null: hidden), and whether it carries the journal. Only in memory.
  const [shown, setShown] = useState<{ text: string; journal: boolean } | null>(null);
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
    setShown(null);
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
   * A v2 code (2026-11-17): set up from what another device that syncs keeps, no passphrase.
   * The token and address are saved like Save's; the journal secret becomes a candidate bound
   * to that token, confirmed only by the verifier (or the server accepting the token).
   */
  async function commitCode(code: Extract<PairingPayload, { v: 2 }>) {
    const secret = code.secret;
    try {
      if (busy) return;
      setNote("");
      setProblem("");
      const serverUrl = code.serverUrl ?? DEFAULT_SYNC_URL;
      if (!validAddress(serverUrl)) {
        setProblem(BAD_CODE_ADDRESS);
        return;
      }
      setShown(null);
      setSavedSecret(null);
      setBusy(true);
      try {
        await saveSyncSettings(controller.db, { serverUrl, token: code.token });
        addressEdited.current = false;
        setAddress(serverUrl);
        controller.clearError();
        await controller.reload();
        setNote("Saved.");
      } catch {
        setProblem("That did not save. Try again.");
        setBusy(false);
        return;
      }
      const journal = secret ? saveJournalKeyFromPairing(controller.db, secret, code.token).catch(() => undefined) : undefined;
      const sync = controller.syncNow();
      try {
        await journal;
      } finally {
        secret?.fill(0);
        setBusy(false);
      }
      await sync;
      await confirmJournalKey(controller.db).catch(() => undefined);
    } finally {
      secret?.fill(0);
    }
  }

  /** A scanned or pasted code of either version. */
  function takeCode(code: PairingPayload) {
    return code.v === 1 ? commit(code.passphrase) : commitCode(code);
  }

  /**
   * "Pair another device": this device's v2 code, made at the tap. Carries the journal when this
   * device has its copy of the journal secret; otherwise the passphrase saved in this visit (a
   * v1 code) if there is one, else a sync-only code with a note.
   */
  async function pairAnother() {
    setShowProblem("");
    let made: Awaited<ReturnType<typeof pairingCodeForDevice>> = null;
    try {
      made = await pairingCodeForDevice(controller.db);
    } catch {
      made = null;
    }
    // Gone to the background while the code was being made: it is not shown behind her back.
    if (backgrounded()) return;
    if (made?.journal) setShown(made);
    else if (savedSecret !== null) setShown({ text: pairingText(savedSecret), journal: true });
    else if (made) setShown(made);
    else setShowProblem(CODE_FAILED);
  }

  /**
   * The code was hidden (Hide, after 60 s, or the app going to the background): it is
   * forgotten, and so is any passphrase from this visit. Showing it again is another tap.
   */
  function hideCode() {
    setShown(null);
    setSavedSecret(null);
    setShowField("");
  }

  /**
   * "Show pairing code" from a typed passphrase (a v1 code, which older app versions read):
   * only the one this device syncs with. When this device has no copy of the journal secret yet
   * (a key from before the re-key update), the passphrase also stores it, if it gives this
   * journal's key, so the next "Pair another device" carries the journal by itself.
   */
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
    if (!backgrounded()) setShown({ text: pairingText(secret), journal: true });
    try {
      const have = await journalSecretForPairing(controller.db);
      if (have) have.fill(0);
      else await giveOldPassphrase(controller.db, secret);
    } catch {
      /* the code is shown either way */
    }
  }

  async function stop() {
    setNote("");
    setProblem("");
    setShown(null);
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
      <OldPassphrasePrompt db={controller.db} />

      <h2>Pair a device</h2>
      <p>Set up another device without typing: show a pairing code here, then scan it on the other device.</p>
      {shown !== null ? (
        <PairingCode text={shown.text} note={shown.journal ? undefined : SYNC_ONLY_NOTE} onHide={hideCode} />
      ) : (
        canPair && (
          <>
            <div className="form-actions">
              <button type="button" className="btn-secondary" onClick={() => void pairAnother()}>
                Pair another device
              </button>
            </div>
            <form onSubmit={(e) => void showFromField(e)}>
              <p>{PASSPHRASE_CODE_LINE}</p>
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
          </>
        )
      )}
      <ScanPairingCode busy={busy} onCode={takeCode} />

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

      <TogetherBox />
    </section>
  );
}
