import { useSyncExternalStore } from "react";

/**
 * Phone layout below 700px wide (VISUAL-LANGUAGE.md "Phone layout"; the phone brief).
 * The one switch: the shell adds `is-phone` from this, and phone.css keys off that class.
 */
export const PHONE_QUERY = "(max-width: 699.98px)";

function query(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(PHONE_QUERY)
    : null;
}

function subscribe(onChange: () => void) {
  const q = query();
  q?.addEventListener("change", onChange);
  return () => q?.removeEventListener("change", onChange);
}

/** True at phone width. False where matchMedia is missing (tests default to desktop). */
export function usePhone(): boolean {
  return useSyncExternalStore(subscribe, () => query()?.matches ?? false, () => false);
}
