import { useEffect, useState } from "react";
import { reducedMotion } from "./motion";

/** A field she types into (the earned moment never interrupts typing). */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file", "image"].includes(el.type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

/** True while a text field has focus. */
export function useTyping(): boolean {
  const [typing, setTyping] = useState(() => typeof document !== "undefined" && isTypingTarget(document.activeElement));
  useEffect(() => {
    const check = () => setTyping(isTypingTarget(document.activeElement));
    // focusout fires before the next element is focused: check once focus has settled.
    const later = () => setTimeout(check, 0);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", later);
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", later);
    };
  }, []);
  return typing;
}

/** A frame counter that ticks every `ms` (stays 0 with reduced motion, or when `on` is false). */
export function useTicker(ms: number, on = true): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!on || reducedMotion()) return;
    const t = setInterval(() => setTick((n) => n + 1), ms);
    return () => clearInterval(t);
  }, [ms, on]);
  return tick;
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
