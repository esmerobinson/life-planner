import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DidEntry, ISODate, Item } from "../../domain/types";
import { DidBox } from "./DidBox";
import { DID_WORDS as W } from "./words";

/** Remembered on this device once the "not locked" line has been seen (review I2, N4). */
const SEEN_KEY = "esmeworld-did-seen";
/** Open this long, the line counts as seen (review N4; a reading time, not a motion timing). */
export const SEEN_AFTER_MS = 3000;
function seenBefore(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}
function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Blocked storage: the line shows again next time.
  }
}

/** The page's room under its last row while the phone card is open (review I3), a CSS variable. */
export const CARD_SPACE_VAR = "--did-card-space";

/** Which card set the page's room last (a newer card's room is never taken away by an older one). */
let spaceOwner = 0;
/** A pointer is down (the card is being closed by a tap that has yet to land). */
let pressing = false;

/**
 * Takes the page's room away, unless a newer card owns it. Closed by a tap: only after that tap
 * has landed, so the page never shrinks under her finger and the tap still hits what she aimed at.
 */
function releaseSpace(owner: number): void {
  const drop = () => {
    if (spaceOwner === owner) document.documentElement.style.removeProperty(CARD_SPACE_VAR);
  };
  if (!pressing) return drop();
  const done = () => {
    pressing = false;
    window.removeEventListener("click", done, true);
    window.removeEventListener("pointercancel", done, true);
    setTimeout(drop, 0);
  };
  window.addEventListener("click", done, true);
  window.addEventListener("pointercancel", done, true);
}
let cards = 0;

/** How it was closed: a button or Escape gives the focus somewhere sensible; a click or Tab elsewhere leaves it there. */
type Why = "button" | "away";

/**
 * "What did you do?" (Esme, 19 Nov 2026): after a to-do is ticked (it is already done, the
 * sparkle already playing), a small card with the box focused, Save and Skip, and Attach files
 * (the Mac app only; elsewhere "Attach files on your Mac").
 *
 * It never costs a click (review I1): nothing dims or covers the page. A click anywhere else saves
 * what was typed, closes it, and still does what was clicked (ticking the next to-do ticks it and
 * asks about that one). Escape (wherever the focus is) and tabbing out close it too (review N2);
 * whatever was typed is saved however it closes. After Save, Skip or Escape the focus goes to the
 * next to-do's tick box (or the one before, or the list's heading): the ticked one has moved.
 *
 * Built from what exists: the Add card (add.css .add-pop) just above the round +. On the phone
 * (review I3) it is compact (the box and its buttons on two rows), sits above the round + so the +
 * stays tappable, and the page gets room under its last row equal to the card, so every to-do can
 * scroll clear of it.
 */
export function WhatIDidSheet({
  item, at, today, phone, back = [], onClose, onSaved,
}: {
  item: Item;
  at: Pick<DidEntry, "id" | "on" | "session">;
  today: ISODate;
  phone: boolean;
  /** Where the focus goes after Save, Skip or Escape: the first of these still on the page. */
  back?: readonly (HTMLElement | null | undefined)[];
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const why = useRef<Why>("away");
  const headingId = useId();
  const [firstUse] = useState(() => !seenBefore());
  const backRef = useRef(back);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const close = useCallback((w: Why) => {
    why.current = w;
    closeRef.current();
  }, []);

  // The "not locked" line counts as seen once it has been up a few seconds, or she types (N4).
  useEffect(() => {
    if (!firstUse) return;
    const t = setTimeout(markSeen, SEEN_AFTER_MS);
    return () => clearTimeout(t);
  }, [firstUse]);

  // Focus after closing with a button or Escape: the next to-do's box (or the one before, or the heading).
  useEffect(
    () => () => {
      if (why.current !== "button") return;
      const to = backRef.current.find((el) => el && el.isConnected);
      if (!to) return;
      if (!to.matches("input, button, a, select, textarea, [tabindex]")) to.setAttribute("tabindex", "-1");
      to.focus();
    },
    [],
  );

  useEffect(() => {
    // A press anywhere outside closes it (its box saves as it goes) and is left to do its own thing.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t || sheet.current?.contains(t)) return;
      pressing = true;
      close("away");
    };
    // Escape, wherever the focus is (N2). First, so the side panel under it stays open.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector(".pop-menu")) return; // an open icon menu closes first
      e.preventDefault();
      e.stopPropagation();
      close("button");
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [close]);

  // The phone: room under the page's last row while the card is open (I3).
  useEffect(() => {
    const el = sheet.current;
    if (!phone || !el) return;
    const root = document.documentElement;
    const me = ++cards;
    spaceOwner = me;
    const set = () => {
      if (spaceOwner === me) root.style.setProperty(CARD_SPACE_VAR, `${Math.ceil(el.getBoundingClientRect().height)}px`);
    };
    set();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      releaseSpace(me);
    };
  }, [phone]);

  return (
    <div
      ref={sheet}
      className={phone ? "add-pop did-sheet did-phone" : "add-pop did-sheet"}
      role="dialog"
      aria-labelledby={headingId}
      // Tabbing out of it (the focus moving to something on the page) saves and closes it (N2).
      // Not when the window itself loses focus (the Mac's file panel, another app): no relatedTarget.
      onBlur={(e) => {
        const to = e.relatedTarget as Node | null;
        if (to && !e.currentTarget.contains(to)) close("away");
      }}
    >
      <div className={phone ? "visually-hidden" : "add-head"}>
        <h2 id={headingId}>{W.sheetTitle}</h2>
      </div>
      <p className="choose-muted did-sheet-todo">{item.title}</p>
      {firstUse && <p className="choose-muted did-sheet-todo">{W.notLocked}</p>}
      <DidBox
        item={item}
        at={at}
        today={today}
        label={W.sheetBox}
        labelHidden
        compact={phone}
        autoFocus
        onSaved={onSaved}
        onEnter={() => close("button")}
        onTyped={markSeen}
        actions={
          <>
            <button type="button" onClick={() => close("button")}>
              {W.save}
            </button>
            <button type="button" className="btn-secondary" onClick={() => close("button")}>
              {W.skip}
            </button>
          </>
        }
      />
    </div>
  );
}
