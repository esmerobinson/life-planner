import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Calls `flush` when the page is hidden (app switched away, phone locked) or being unloaded:
 * a backgrounded phone app may be ended without any blur or unmount.
 */
export function useHiddenFlush(flush: () => void): void {
  const ref = useRef(flush);
  ref.current = flush;
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") ref.current();
    };
    const onPageHide = () => ref.current();
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);
}

/** Autosave pause for typed text (round-3 brief: "debounced ~800ms"; a save delay, not motion). */
export const AUTOSAVE_MS = 800;

/**
 * A text field that saves itself: on `flush()` (blur), after a pause in typing when
 * `debounceMs` is given, and when the field goes away (panel closed or swapped), so
 * nothing typed is lost. While nothing is unsaved, a new stored value (e.g. from sync)
 * replaces the draft.
 */
export function useDraft(stored: string, save: (text: string) => Promise<unknown>, debounceMs?: number) {
  const [value, setValue] = useState(stored);
  const latest = useRef(stored);
  const saved = useRef(stored);
  const saveRef = useRef(save);
  saveRef.current = save;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Take in a new stored value only while nothing typed is waiting.
  useEffect(() => {
    if (latest.current === saved.current && stored !== saved.current) {
      latest.current = stored;
      saved.current = stored;
      setValue(stored);
    }
  }, [stored]);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const text = latest.current;
    const before = saved.current;
    if (text === before) return;
    saved.current = text;
    void saveRef.current(text).catch(() => {
      // Still unsaved, so the next flush tries again (the caller shows its save message).
      if (saved.current === text) saved.current = before;
    });
  }, []);

  const set = useCallback(
    (text: string) => {
      latest.current = text;
      setValue(text);
      if (debounceMs === undefined) return;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, debounceMs);
    },
    [debounceMs, flush],
  );

  /** Puts the field back to what is stored (no save). */
  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    latest.current = saved.current;
    setValue(saved.current);
  }, []);

  // Closing or swapping the panel unmounts the field: save what was typed.
  useEffect(() => () => flush(), [flush]);
  // The app going to the background (a phone may end it there without a blur or unmount).
  useHiddenFlush(flush);

  return { value, set, flush, reset };
}
