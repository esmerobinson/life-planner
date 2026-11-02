import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { db } from "../../data/db";
import { isKeychainError, unlockJournal, type UnlockResult } from "../../journal/keyStore";
import type { ISODate } from "../../domain/types";
import { syncController } from "../../sync";
import type { SyncController } from "../../sync/controller";
import { getDeviceId } from "../../sync/engine";
import { ScanPairingCode } from "../Pairing";
import { LOADING_LINE, longDate } from "./bits";
import { CHECKIN_META, DailyCheckIn } from "./DailyCheckIn";
import { JournalStripHead, type TickState } from "./JournalStrip";
import { loadTimeout } from "./loadTimeout";
import { EXERCISE_META, MentalHealthExercise } from "./MentalHealthExercise";
import { MorningPages } from "./MorningPages";
import { useJournalKey } from "./useJournalKey";

/** The Home card's rows land on these sections. */
export const MORNING_HASH = "#morning-pages";
export const CHECKIN_HASH = "#daily-check-in";
export const EXERCISE_HASH = "#mental-health-exercise";
/** Each hash's section (the element scrolled to). */
const SECTION_FOR_HASH: Record<string, string> = {
  [MORNING_HASH]: "morning-pages-section",
  [CHECKIN_HASH]: "daily-check-in-section",
  [EXERCISE_HASH]: "mental-health-exercise-section",
};
/** How long a section opened from Home is kept in view while the page above it fills in. */
const KEEP_IN_VIEW_MS = 3000;
const HER_OWN_MOVES = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
/** While a typed passphrase waits for sync to accept it (review C1's suggested words). */
export const CHECKING_LINE = "Checking your passphrase with sync…";
/** The key check or the device id failed, or didn't answer in time (2026-11-02). */
export const CANT_OPEN_JOURNAL = "Can't open your journal on this device right now.";
/** The macOS keychain refused the stored journal key (Mac app). Nothing is deleted. */
export const KEYCHAIN_LINE =
  "This Mac's keychain didn't let Esmeworld open your journal key. Quit and reopen Esmeworld, enter your Mac login password and choose Always Allow.";

/**
 * The Journal (journal brief): morning pages, the daily check-in, then the mental health
 * exercise card (exercise brief). Everything here is
 * end-to-end encrypted. Only a CONFIRMED key shows or writes entries; without one the page
 * shows "Unlock journal", or "Checking your passphrase with sync…" while a typed passphrase
 * waits for sync to accept it. Synced entries still arrive and wait, sealed.
 */
export function JournalPage({ today, controller = syncController }: { today: ISODate; controller?: SyncController }) {
  const view = useJournalKey();
  const location = useLocation();
  const device = useDeviceId();
  const asked = useRef(false);

  // A candidate key is confirmed by a successful sync: ask for one (once per visit).
  useEffect(() => {
    if (view.state !== "checking" || asked.current) return;
    asked.current = true;
    void controller.syncNow().catch(() => undefined);
  }, [view.state, controller]);

  const deviceId = device.state === "ok" ? device.id : null;
  const ready = view.state === "confirmed" && deviceId !== null;
  // From the Home card: bring the chosen section into view once it is there. The sections
  // above it fill in after it appears and push it down, so it is brought back into view as the
  // page grows, until she scrolls, taps or types herself (or after KEEP_IN_VIEW_MS).
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ready || !location.hash) return;
    const id = SECTION_FOR_HASH[location.hash];
    if (!id) return;
    const go = () => document.getElementById(id)?.scrollIntoView?.({ block: "start" });
    const t = setTimeout(go, 0);
    const ro = typeof ResizeObserver === "undefined" || !pageRef.current ? null : new ResizeObserver(go);
    if (ro && pageRef.current) ro.observe(pageRef.current);
    const stop = () => ro?.disconnect();
    const cap = setTimeout(stop, KEEP_IN_VIEW_MS);
    for (const e of HER_OWN_MOVES) window.addEventListener(e, stop, { passive: true });
    return () => {
      clearTimeout(t);
      clearTimeout(cap);
      stop();
      for (const e of HER_OWN_MOVES) window.removeEventListener(e, stop);
    };
  }, [ready, location.hash]);

  // Never blank (2026-11-02): until the journal opens, the three section strips still show
  // (no entries, no ticks) under whatever this device can say: Loading…, Unlock, Checking,
  // or a can't-open line with Try again.
  const keyProblem = view.state === "error" ? view.problem : null;
  const deviceProblem = view.state === "confirmed" && device.state === "error";
  const loading = view.state === "loading" || (view.state === "confirmed" && device.state === "loading");
  // Until the journal opens here: the strips with no entries, no ticks, no streaks.
  const open = view.state === "confirmed" && deviceId ? { jk: view.jk, deviceId } : null;
  const closedTick: TickState = loading ? "loading" : "locked";
  const retry = () => {
    if (keyProblem) view.retry();
    if (device.state === "error") device.retry();
  };
  return (
    <div className="journal-page" ref={pageRef}>
      <h1>Journal</h1>
      {loading ? (
        <p className="journal-muted" role="status">
          {LOADING_LINE}
        </p>
      ) : keyProblem || deviceProblem ? (
        <div className="journal-card" role="alert">
          <p>{keyProblem === "keychain" ? KEYCHAIN_LINE : CANT_OPEN_JOURNAL}</p>
          <button type="button" className="btn-secondary" onClick={retry}>
            Try again
          </button>
        </div>
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
      ) : view.state === "locked" ? (
        <UnlockJournal />
      ) : null}
      {/* The sections stay the same elements while the journal opens (only their insides change). */}
      <section className="journal-card" aria-labelledby="morning-pages" id="morning-pages-section">
        {open ? (
          <MorningPages jk={open.jk} today={today} deviceId={open.deviceId} />
        ) : (
          <JournalStripHead id="morning-pages" title="Morning pages" tick={closedTick} streak={0} meta={longDate(today)} />
        )}
      </section>
      <section className="journal-card" aria-labelledby="daily-check-in" id="daily-check-in-section">
        {open ? (
          <DailyCheckIn jk={open.jk} today={today} deviceId={open.deviceId} />
        ) : (
          <JournalStripHead id="daily-check-in" title="Daily check-in" tick={closedTick} streak={0} meta={CHECKIN_META} />
        )}
      </section>
      <section className="journal-card" aria-labelledby="mental-health-exercise" id="mental-health-exercise-section">
        {open ? (
          <MentalHealthExercise jk={open.jk} today={today} deviceId={open.deviceId} />
        ) : (
          <JournalStripHead id="mental-health-exercise" title="Mental health exercise" tick={closedTick} streak={0} meta={EXERCISE_META} />
        )}
      </section>
    </div>
  );
}

type DeviceView = { state: "loading" } | { state: "ok"; id: string } | { state: "error" };

/** This device's id, never stuck: a failure, or no answer within loadTimeout.ms, is "error". */
function useDeviceId(): DeviceView & { retry: () => void } {
  const [view, setView] = useState<DeviceView>({ state: "loading" });
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let alive = true;
    setView({ state: "loading" });
    const timer = setTimeout(() => alive && setView((v) => (v.state === "loading" ? { state: "error" } : v)), loadTimeout.ms);
    void getDeviceId(db)
      .then(
        (id) => alive && setView({ state: "ok", id }),
        () => alive && setView({ state: "error" }),
      )
      .finally(() => clearTimeout(timer));
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [tries]);
  const retry = useCallback(() => setTries((n) => n + 1), []);
  return { ...view, retry };
}

const PROBLEMS: Record<Exclude<UnlockResult, "ok" | "checking"> | "failed" | "keychain", React.ReactNode> = {
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
  keychain: KEYCHAIN_LINE,
};

/** The passphrase is held only in this field until Unlock; never stored, never logged. */
function UnlockJournal() {
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<keyof typeof PROBLEMS | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const secret = passphrase;
    setPassphrase("");
    await unlock(secret);
  }

  /** Unlock: the one routine for a typed passphrase and for a scanned or pasted pairing code. */
  async function unlock(secret: string) {
    if (busy) return;
    setProblem(null);
    setBusy(true);
    try {
      const result = await unlockJournal(db, secret);
      if (result !== "ok" && result !== "checking") setProblem(result);
    } catch (e) {
      setProblem(isKeychainError(e) ? "keychain" : "failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="journal-card" aria-labelledby="unlock-journal">
      <h2 id="unlock-journal" className="journal-big">
        Unlock journal
      </h2>
      <p>Your journal is private to you. Type your sync passphrase, or scan a pairing code, to open it on this device.</p>
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
      <ScanPairingCode busy={busy} onPassphrase={(secret) => unlock(secret)} />
      {problem && <p role="alert">{PROBLEMS[problem]}</p>}
    </section>
  );
}
