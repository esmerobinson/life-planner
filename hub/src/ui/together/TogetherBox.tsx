import { useEffect, useState } from "react";
import { todayISO } from "../../domain/dates";
import { isValidISODate } from "../../domain/dates";
import type { Fetch } from "../../together/client";
import { togetherRunner, type TogetherRunner } from "../../together/runner";
import { cancelStopRemoving, signInToTogether, stopTogether } from "../../together/sender";
import { useJournalKey } from "../journal/useJournalKey";
import { PrivateDayTick } from "./PrivateDayTick";
import { useRunner, useTogetherMeta } from "./useTogether";
import { TOGETHER_WORDS as W } from "./wording";
import "./together.css";

const browserFetch: Fetch = (input, init) => fetch(input, init);

/**
 * PLACEHOLDER look (magenta, system font, no easing): the Design session decides it. The
 * Together link's box on the Sync page: sign in, Send now, Stop, and a day's private ticks. Everything it keeps is on this device only (store.ts).
 */
export function TogetherBox({ runner = togetherRunner, fetchFn = browserFetch }: { runner?: TogetherRunner; fetchFn?: Fetch }) {
  const meta = useTogetherMeta();
  const run = useRunner(runner);
  const [url, setUrl] = useState("");
  const [anonKey, setAnonKey] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [note, setNote] = useState("");
  const [stopping, setStopping] = useState(false);
  const [markDeleted, setMarkDeleted] = useState(false);

  const auth = meta?.auth;
  const signedIn = !!auth?.accessToken;
  const again = !!auth && !signedIn;

  // Signing in again: the address and anon key are still known.
  useEffect(() => {
    if (again && auth) {
      setUrl((u) => u || auth.url);
      setAnonKey((k) => k || auth.anonKey);
    }
  }, [again, auth]);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setProblem("");
    setNote("");
    setBusy(true);
    const pw = password;
    setPassword(""); // the password stays only in the field until sign-in, never kept
    try {
      const r = await signInToTogether({ fetch: fetchFn }, { url, anonKey, email, password: pw });
      if (r.kind === "error") setProblem(r.message);
      else setEmail("");
    } finally {
      setBusy(false);
    }
  }

  async function finishRemoving() {
    setProblem("");
    setBusy(true);
    try {
      const r = await stopTogether({ fetch: fetchFn }, { markDeleted: true });
      if (r.kind === "error") setProblem(r.message);
      else setNote(W.stopped);
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    setProblem("");
    setBusy(true);
    try {
      const r = await stopTogether({ fetch: fetchFn }, { markDeleted });
      if (r.kind === "error") setProblem(r.message);
      else {
        setStopping(false);
        setMarkDeleted(false);
        setNote(W.stopped);
      }
    } finally {
      setBusy(false);
    }
  }

  const setAside = meta?.sent ? Object.values(meta.sent.refused) : [];
  const notCopied = setAside.filter((r) => r.what === "copy").length;
  const notHidden = setAside.filter((r) => r.what === "hide").length;
  const last = run.last;

  return (
    <section className="together-placeholder together-box" aria-labelledby="together-heading">
      <h2 id="together-heading">{W.heading}</h2>
      <p>{W.intro}</p>
      <p className="together-warning">{W.notEncrypted}</p>
      <p className="together-warning">{W.afterDayEnds}</p>
      <p className="together-warning">{W.privateWarning}</p>

      {again && <p role="alert">{W.signInAgain}</p>}

      {!signedIn ? (
        <form aria-label="Sign in to Together" onSubmit={(e) => void signIn(e)}>
          <label className="form-field">
            <span className="form-label">{W.address}</span>
            <input type="url" autoComplete="off" value={url} onChange={(e) => setUrl(e.target.value)} />
          </label>
          <label className="form-field">
            <span className="form-label">{W.anonKey}</span>
            <input type="text" autoComplete="off" spellCheck={false} value={anonKey} onChange={(e) => setAnonKey(e.target.value)} />
          </label>
          <label className="form-field">
            <span className="form-label">{W.email}</span>
            <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          <label className="form-field">
            <span className="form-label">{W.password}</span>
            <input type="password" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <p>{W.onlyThisDevice}</p>
          <div className="form-actions">
            <button type="submit" disabled={busy || !url || !anonKey || !email || !password}>
              {busy ? W.signingIn : W.signIn}
            </button>
          </div>
        </form>
      ) : (
        <>
          {meta?.sent?.removing ? (
            <div role="alert">
              <p>{W.paused}</p>
              <div className="form-actions">
                <button type="button" disabled={busy} onClick={() => void finishRemoving()}>
                  {W.finishRemoving}
                </button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => void cancelStopRemoving()}>
                  {W.cancelRemoving}
                </button>
              </div>
            </div>
          ) : (
            <p>{W.copying}</p>
          )}
          <p>{W.onlyThisDevice}</p>
          <p>{meta?.sent?.lastCopiedAt ? W.lastSent(new Date(meta.sent.lastCopiedAt).toLocaleString()) : W.notSentYet}</p>
          {meta?.sent?.held && <p>{W.daysWaiting}</p>}
          {last?.kind === "offline" && <p role="status">{W.offline}</p>}
          {notHidden > 0 && <p role="alert">{W.notHidden(notHidden)}</p>}
          {notCopied > 0 && <p>{W.setAside(notCopied)}</p>}
          <div className="form-actions">
            <button type="button" className="btn-secondary" disabled={run.running || busy} onClick={() => void runner.sendNow()}>
              {run.running ? W.sending : W.sendNow}
            </button>
            {!stopping && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => setStopping(true)}>
                {W.stop}
              </button>
            )}
          </div>
          {stopping && (
            <div role="group" aria-label={W.stop}>
              <label>
                <input type="checkbox" checked={markDeleted} onChange={(e) => setMarkDeleted(e.target.checked)} /> {W.stopMarkDeleted}
              </label>
              <div className="form-actions">
                <button type="button" disabled={busy} onClick={() => void stop()}>
                  {W.stopConfirm}
                </button>
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => setStopping(false)}>
                  {W.cancel}
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {problem && <p role="alert">{problem}</p>}
      {note && <p role="status">{note}</p>}

      <PrivateDays />
    </section>
  );
}

/** A day's two private ticks (any day: today's are on the Journal page too). */
function PrivateDays() {
  const key = useJournalKey();
  const [date, setDate] = useState(() => todayISO());
  return (
    <fieldset>
      <legend>{W.privateHeading}</legend>
      {key.state !== "confirmed" ? (
        <p>{W.privateLocked}</p>
      ) : (
        <>
          <label className="form-field">
            <span className="form-label">{W.privateDay}</span>
            <input type="date" value={date} onChange={(e) => isValidISODate(e.target.value) && setDate(e.target.value)} />
          </label>
          <PrivateDayTick jk={key.jk} date={date} part="exercise" label={W.privateExercise} />
          <PrivateDayTick jk={key.jk} date={date} part="checkin" label={W.privateCheckin} />
        </>
      )}
    </fieldset>
  );
}
