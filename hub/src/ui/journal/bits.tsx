import { useCallback, useEffect, useState } from "react";
import type { ISODate } from "../../domain/types";
import { loadTimeout } from "./loadTimeout";

/** A Journal section whose own read failed or never answered (2026-11-02). */
export const SECTION_CANT_OPEN = "Can't open this on this device right now.";
/** While a Journal read is still pending: quiet, never blank. */
export const LOADING_LINE = "Loading…";

export interface LoadGuard {
  /** The first read failed, or took longer than loadTimeout.ms. */
  failed: boolean;
  /** Call when the read throws (ignored once something has loaded). */
  fail: () => void;
  /** "Try again": a fresh read and a fresh timeout. */
  retry: () => void;
}

/**
 * Guards a section's first read: while `pending`, a failure or a read that takes longer than
 * loadTimeout.ms turns into `failed`. A late answer still shows (`pending` goes false).
 */
export function useLoadGuard(pending: boolean, load: () => unknown): LoadGuard {
  const [thrown, setThrown] = useState(false);
  const [slow, setSlow] = useState(false);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    setSlow(false);
    if (!pending) return;
    const t = setTimeout(() => setSlow(true), loadTimeout.ms);
    return () => clearTimeout(t);
  }, [pending, tries]);
  useEffect(() => {
    if (!pending) setThrown(false);
  }, [pending]);
  const fail = useCallback(() => setThrown(true), []);
  const retry = useCallback(() => {
    setThrown(false);
    setTries((n) => n + 1);
    void load();
  }, [load]);
  return { failed: pending && (thrown || slow), fail, retry };
}

/** Under a section's strip while its read is pending: "Loading…", or the line and "Try again". */
export function LoadLine({ guard, line = SECTION_CANT_OPEN }: { guard: LoadGuard; line?: React.ReactNode }) {
  if (!guard.failed) {
    return (
      <p className="journal-muted" role="status">
        {LOADING_LINE}
      </p>
    );
  }
  return (
    <div role="alert">
      <p>{line}</p>
      <button type="button" className="btn-secondary" onClick={guard.retry}>
        Try again
      </button>
    </div>
  );
}

/** "Wednesday 28 October" for a calendar date (no timezone shift). */
export function longDate(date: ISODate): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/** "October", or "October 2025" outside the current year. */
export function monthLabel(month: string, today: ISODate): string {
  const [y, m] = month.split("-").map(Number);
  const name = new Date(y!, m! - 1, 1).toLocaleDateString("en-GB", { month: "long" });
  return month.slice(0, 4) === today.slice(0, 4) ? name : `${name} ${y}`;
}

/** The done box: a tick, a bold line and a small line under it. */
export function DoneBox({ title, line }: { title: string; line?: React.ReactNode }) {
  return (
    <div className="journal-done">
      <span className="journal-tick" aria-hidden="true">
        ✓
      </span>
      <div>
        <b>{title}</b>
        {line && (
          <div className="journal-muted">{line}</div>
        )}
      </div>
    </div>
  );
}

/** A prompt's text, with the bank's *emphasis* shown as emphasis. */
export function PromptText({ text }: { text: string }) {
  const parts = text.split(/(\*[^*]+\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((p, i) => (p.startsWith("*") && p.endsWith("*") && p.length > 2 ? <em key={i}>{p.slice(1, -1)}</em> : p))}
    </>
  );
}
