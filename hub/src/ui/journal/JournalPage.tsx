import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { db } from "../../data/db";
import { isKeychainError, unlockJournal, type UnlockResult } from "../../journal/keyStore";
import type { RowStatus } from "../../journal/rows";
import type { ISODate } from "../../domain/types";
import { syncController } from "../../sync";
import type { SyncController } from "../../sync/controller";
import { getDeviceId } from "../../sync/engine";
import { ScanPairingCode } from "../Pairing";
import { Streak } from "../Streak";
import { LOADING_LINE } from "./bits";
import { DailyCheckIn } from "./DailyCheckIn";
import { ReadOnlyTick, type TickState } from "./JournalStrip";
import { loadTimeout } from "./loadTimeout";
import { MentalHealthExercise } from "./MentalHealthExercise";
import { MorningPages } from "./MorningPages";
import { ReadBack } from "./ReadBack";
import { JOURNAL_TABS, TAB_FOR_HASH, tabPath, type JournalTabId } from "./tabs";
import { useJournalKey } from "./useJournalKey";
import { useJournalRows } from "./useJournalRows";
import { useTabsStacked } from "./useTabsFit";
import { usePhone } from "../usePhone";

/** While a typed passphrase waits for sync to accept it (review C1's suggested words). */
export const CHECKING_LINE = "Checking your passphrase with sync…";
/** The key check or the device id failed, or didn't answer in time (2026-11-02). */
export const CANT_OPEN_JOURNAL = "Can't open your journal on this device right now.";
/**
 * The stored journal key can't be read any more (in the Mac app: it was stored by a build
 * that used the macOS keychain, 2026-11-02). Shown above the passphrase field. Nothing is deleted.
 */
export const UNLOCK_AGAIN_LINE = "Unlock your journal once more with your passphrase.";
/** WebCrypto threw while reading or storing the journal key (Mac app). Nothing is deleted. */
export const KEYCHAIN_LINE =
  "This Mac's keychain didn't let Esmeworld open your journal key. Quit and reopen Esmeworld, enter your Mac login password and choose Always Allow.";

const isTab = (t: string | undefined): t is JournalTabId => JOURNAL_TABS.some((x) => x.id === t);

/**
 * The Journal (journal brief; Journal v2): big tabs, in her order: Mental health exercise ·
 * Morning pages · Daily check-in · Read back, each at its own address (`/journal` opens the
 * exercise). Each of the first three shows a small read-only tick when that part is done
 * today, and its streak. Everything here is end-to-end encrypted. Only a CONFIRMED key shows
 * or writes entries; without one the page shows "Unlock journal" (or "Checking your
 * passphrase with sync…", or a can't-open line with Try again) above the tabs. Synced entries
 * still arrive and wait, sealed.
 */
export function JournalPage({ today, controller = syncController }: { today: ISODate; controller?: SyncController }) {
  const { tab } = useParams();
  const location = useLocation();
  const view = useJournalKey();
  const device = useDeviceId();
  const rows = useJournalRows(today);
  const asked = useRef(false);
  const tabsRef = useRef<HTMLElement>(null);
  const stacked = useTabsStacked(tabsRef, usePhone());

  // A candidate key is confirmed by a successful sync: ask for one (once per visit).
  useEffect(() => {
    if (view.state !== "checking" || asked.current) return;
    asked.current = true;
    void controller.syncNow().catch(() => undefined);
  }, [view.state, controller]);

  // `/journal` (or an earlier `/journal#morning-pages` link, or an unknown tab) opens a tab.
  if (!isTab(tab)) return <Navigate to={tabPath(TAB_FOR_HASH[location.hash] ?? "exercise")} replace />;

  const deviceId = device.state === "ok" ? device.id : null;
  // Never blank (2026-11-02): until the journal opens, the tabs still show (no ticks) under
  // whatever this device can say: Loading…, Unlock, Checking, or a can't-open line with Try again.
  const keyProblem = view.state === "error" ? view.problem : null;
  const deviceProblem = view.state === "confirmed" && device.state === "error";
  const loading = view.state === "loading" || (view.state === "confirmed" && device.state === "loading");
  const open = view.state === "confirmed" && deviceId ? { jk: view.jk, deviceId } : null;
  const retry = () => {
    if (keyProblem) view.retry();
    if (device.state === "error") device.retry();
  };
  const status: Record<Exclude<JournalTabId, "read-back">, RowStatus | null> =
    rows.state === "ok" ? { exercise: rows.exercise, morning: rows.morning, "check-in": rows.checkin } : { exercise: null, morning: null, "check-in": null };
  const unknown: TickState = loading || rows.state === "loading" ? "loading" : "locked";
  const current = JOURNAL_TABS.find((t) => t.id === tab)!;

  return (
    <div className="journal-page">
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
      ) : view.state === "unreadable" ? (
        <UnlockJournal again />
      ) : null}
      <nav ref={tabsRef} className={stacked ? "journal-tabs is-stacked" : "journal-tabs"} aria-label="Journal parts">
        {JOURNAL_TABS.map((t) => {
          const selected = t.id === tab;
          const s = t.id === "read-back" ? undefined : status[t.id];
          return (
            <Link
              key={t.id}
              to={t.path}
              className={selected ? "journal-tab is-selected" : "journal-tab"}
              aria-current={selected ? "page" : undefined}
            >
              {t.id !== "read-back" && (
                <ReadOnlyTick state={open && s ? (s.done ? "done" : "todo") : unknown} title={t.title} inLink />
              )}
              <span className="journal-tab-label">{t.title}</span>
              {open && s && <Streak n={s.streak} week={s.week} />}
            </Link>
          );
        })}
      </nav>
      {open && (
        <section className="journal-card journal-panel" aria-labelledby="journal-panel-heading">
          <h2 id="journal-panel-heading" className="visually-hidden">
            {current.title}
          </h2>
          {tab === "exercise" && <MentalHealthExercise jk={open.jk} today={today} deviceId={open.deviceId} />}
          {tab === "morning" && <MorningPages jk={open.jk} today={today} deviceId={open.deviceId} />}
          {tab === "check-in" && <DailyCheckIn jk={open.jk} today={today} deviceId={open.deviceId} />}
          {tab === "read-back" && <ReadBack jk={open.jk} today={today} />}
        </section>
      )}
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

/**
 * The passphrase is held only in this field until Unlock; never stored, never logged.
 * `again`: a key is stored here but can't be read any more, so it asks for the passphrase once more.
 */
function UnlockJournal({ again = false }: { again?: boolean }) {
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
      <p>
        {again
          ? UNLOCK_AGAIN_LINE
          : "Your journal is private to you. Type your sync passphrase, or scan a pairing code, to open it on this device."}
      </p>
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
