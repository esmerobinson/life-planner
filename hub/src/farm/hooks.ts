import { useEffect, useState, useSyncExternalStore } from "react";
import { reducedMotion } from "./motion";
import { canDraw } from "./sprites";

/** A field she types into (the earned moment never interrupts typing). */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image"].includes(el.type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

/**
 * True while a text field has focus. A press that takes focus off the field (a tap on a form's
 * Save) keeps it true until the press is released and its click has landed, so the phone nook
 * never comes back under her finger mid-tap and takes the tap instead.
 */
export function useTyping(): boolean {
  const [typing, setTyping] = useState(() => typeof document !== "undefined" && isTypingTarget(document.activeElement));
  useEffect(() => {
    let pressed = false;
    let waiting = false;
    const check = () => {
      const now = isTypingTarget(document.activeElement);
      if (!now && pressed) {
        waiting = true; // settle once the press is over
        return;
      }
      setTyping(now);
    };
    // focusout fires before the next element is focused: check once focus has settled.
    const later = () => setTimeout(check, 0);
    const down = () => {
      pressed = true;
    };
    const up = () => {
      pressed = false;
      if (waiting) {
        waiting = false;
        setTimeout(check, 0); // after the click this release makes
      }
    };
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", later);
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", later);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
    };
  }, []);
  return typing;
}

/**
 * A frame counter that ticks every `ms`. Stays put with reduced motion (followed live, review M7),
 * when `on` is false, where nothing is drawn (the test DOM), and while the page is hidden or the
 * window isn't focused (battery; review M9).
 */
export function useTicker(ms: number, on = true): number {
  const [tick, setTick] = useState(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!on || reduced || !canDraw()) return;
    const t = setInterval(() => {
      if (document.visibilityState !== "hidden" && document.hasFocus()) setTick((n) => n + 1);
    }, ms);
    return () => clearInterval(t);
  }, [ms, on, reduced]);
  return tick;
}

const REDUCED = "(prefers-reduced-motion: reduce)";
function subscribeReduced(onChange: () => void) {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => undefined;
  const q = window.matchMedia(REDUCED);
  q.addEventListener("change", onChange);
  return () => q.removeEventListener("change", onChange);
}

/** prefers-reduced-motion, following changes made while the app is open. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReduced, reducedMotion, () => false);
}

/** The local hour, re-read every minute (for the nook's sleeping at night). */
export function useHour(): number {
  const [hour, setHour] = useState(() => new Date().getHours());
  useEffect(() => {
    const t = setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => clearInterval(t);
  }, []);
  return hour;
}
