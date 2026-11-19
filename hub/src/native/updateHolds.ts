import { useEffect, useRef } from "react";

/**
 * What the phone's automatic update (pwaUpdate.ts) must not interrupt. Each hold answers, when
 * asked, why not now ("syncing", "journal", ...) or null. On top of the typing/saving check the
 * Mac app also uses (window.esmeworldPrepareReload), these are the PWA's own extra rules:
 * an open sheet with text, a field being edited, the journal, a sync in progress.
 * The Mac app's path does not ask these (its behaviour is unchanged).
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

/** Holds updates while mounted and `active` (e.g. the journal page). */
export function useUpdateHold(active: boolean, reason: string): void {
  const state = useRef({ active, reason });
  state.current = { active, reason };
  useEffect(() => addUpdateHold(() => (state.current.active ? state.current.reason : null)), []);
}

const NOT_TEXT = new Set(["checkbox", "radio", "button", "submit", "reset", "hidden", "range", "color", "file", "image"]);

/** The text typed in a field, or "" if it is not a text field. */
function typed(el: Element): string {
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLInputElement) return NOT_TEXT.has(el.type) ? "" : el.value;
  if (el instanceof HTMLElement && editable(el)) return el.textContent ?? "";
  return "";
}

/** contenteditable (the attribute too: not every engine reports isContentEditable). */
function editable(el: HTMLElement): boolean {
  if (el.isContentEditable) return true;
  const v = el.getAttribute("contenteditable");
  return v !== null && v !== "false";
}

const FIELDS = 'input, textarea, [contenteditable]:not([contenteditable="false"])';

/**
 * What the page shows right now that a reload would interrupt: a pop-up sheet (role="dialog")
 * with something typed in it ("sheet"), or a field with text in it that has the focus
 * ("editing"). Pages themselves are saved and come back after a reload (the open panel is in
 * the address), so text on a page alone does not hold.
 */
export function pageHold(doc: Document = document): string | null {
  const active = doc.activeElement;
  if (active && active !== doc.body && typed(active).trim()) return "editing";
  for (const sheet of doc.querySelectorAll('[role="dialog"], [aria-modal="true"]')) {
    for (const f of sheet.querySelectorAll(FIELDS)) if (typed(f).trim()) return "sheet";
  }
  return null;
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
  return pageHold(doc);
}
