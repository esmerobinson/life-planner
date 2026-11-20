import { useEffect, useRef } from "react";

/**
 * What the phone's automatic update (pwaUpdate.ts) must not interrupt (fix round 1: one rule,
 * not a list of editors to keep up to date).
 *
 * The rule: no automatic update once ANYTHING has been edited on the current page. Any input,
 * change, key or paste in a form control (input, textarea, select) or an editable area marks the
 * page edited; only a route change clears it (a route change already drops unsaved form state,
 * the same way the app always has). Controls that save the moment they change may opt out with
 * `data-reload-safe` on them or an ancestor (a tick box, the quick box, which keeps its draft on
 * the device); an unmarked control always counts.
 *
 * Also held, edited or not: any open sheet or dialog (role="dialog" / aria-modal), and the
 * registered holds (a panel in Edit mode, a sync or pairing in progress, the camera scanner, the
 * full Add form's kept draft). window.esmeworldPrepareReload (typing, saves settling) is asked
 * on top of all this. The Mac app's path does not ask these (its behaviour is unchanged).
 */

type Hold = () => string | null;

const holds = new Set<Hold>();

/** Adds a hold; returns the function that takes it off. */
export function addUpdateHold(hold: Hold): () => void {
  const entry: Hold = () => hold();
  holds.add(entry);
  return () => {
    holds.delete(entry);
  };
}

/** Holds updates while mounted and `active` (e.g. a panel in Edit mode). */
export function useUpdateHold(active: boolean, reason: string): void {
  const state = useRef({ active, reason });
  state.current = { active, reason };
  useEffect(() => addUpdateHold(() => (state.current.active ? state.current.reason : null)), []);
}

let edited = false;
let activity = 0;

/** Something was edited on this page (since it was shown). */
export function pageEdited(): boolean {
  return edited;
}

/** A route change: the page's form state is gone, so its edits no longer hold. */
export function clearPageEdits(): void {
  edited = false;
}

/** Counts every key, tap and input: any change since a decision cancels a reload (pwaUpdate). */
export function userActivity(): number {
  return activity;
}

/** Keys that move around or close, never change a value. */
const NOT_EDITING_KEYS = new Set(["Tab", "Escape", "Shift", "Control", "Alt", "Meta", "CapsLock"]);

function isEditable(el: Element): boolean {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  // (not every engine reports isContentEditable)
  const host = el.closest("[contenteditable]");
  return !!host && host.getAttribute("contenteditable") !== "false";
}

function onEdit(e: Event): void {
  const t = e.target;
  if (!(t instanceof Element) || !isEditable(t)) return;
  if (e instanceof KeyboardEvent && NOT_EDITING_KEYS.has(e.key)) return;
  if (t.closest("[data-reload-safe]")) return;
  edited = true;
}

const onActivity = () => {
  activity++;
};

const EDIT_EVENTS = ["input", "change", "keydown", "paste", "cut", "drop"] as const;
const ACTIVITY_EVENTS = ["keydown", "pointerdown", "input", "change", "paste", "compositionstart"] as const;

/** Starts noticing edits and activity on `doc` (main.tsx, via pwaRegister). Returns stop. */
export function installEditTracker(doc: Document = document): () => void {
  const opts = { capture: true, passive: true } as const;
  for (const ev of EDIT_EVENTS) doc.addEventListener(ev, onEdit, opts);
  for (const ev of ACTIVITY_EVENTS) doc.addEventListener(ev, onActivity, opts);
  return () => {
    for (const ev of EDIT_EVENTS) doc.removeEventListener(ev, onEdit, opts);
    for (const ev of ACTIVITY_EVENTS) doc.removeEventListener(ev, onActivity, opts);
  };
}

/** The first reason not to reload now, or null when nothing is in the way. */
export function currentUpdateHold(doc: Document = document): string | null {
  for (const hold of holds) {
    let reason: string | null;
    try {
      reason = hold();
    } catch {
      reason = "unknown";
    }
    if (reason) return reason;
  }
  if (edited) return "edited";
  if (doc.querySelector('[role="dialog"], [aria-modal="true"]')) return "sheet";
  return null;
}
