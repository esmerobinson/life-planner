import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { DidEntry, ISODate, Item } from "../../domain/types";
import { DidBox } from "./DidBox";
import { DID_WORDS as W } from "./words";

/** Remembered on this device once the "not locked" line has been shown (review I2: first use). */
const SEEN_KEY = "esmeworld-did-seen";
function seenBefore(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * "What did you do?" (Esme, 19 Nov 2026): after a to-do is ticked (it is already done, the
 * sparkle already playing), a small card with the box focused, Attach files (the Mac app only;
 * elsewhere "Attach files on your Mac"), Save and Skip.
 *
 * It never costs a click (review I1, the coordinator's call for Esme): nothing dims or covers the
 * page. A click anywhere else saves what was typed, closes it, and still does what was clicked
 * (ticking the next to-do ticks it and asks about that one). Skip, Save and Escape close it too;
 * whatever was typed is saved however it closes.
 *
 * Built from what exists: on a computer the Add card (add.css .add-pop, just above the round +);
 * on the phone the Add sheet's look at the bottom, without its shade, so the list above stays
 * usable. It sits over the side panel and under the tick's sparkle (whatIDid.css).
 */
export function WhatIDidSheet({
  item, at, today, phone, onClose, onSaved,
}: {
  item: Item;
  at: Pick<DidEntry, "id" | "on" | "session">;
  today: ISODate;
  phone: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  /** Closed by a click elsewhere: the focus stays where she clicked. */
  const outside = useRef(false);
  const headingId = useId();
  const [firstUse] = useState(() => !seenBefore());

  useEffect(() => {
    opener.current = document.activeElement;
    try {
      localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Blocked storage: the line shows again next time.
    }
    return () => {
      if (outside.current) return;
      const back = opener.current as HTMLElement | null;
      if (back && back.isConnected && typeof back.focus === "function") back.focus();
    };
  }, []);

  // A press anywhere outside closes it (its box saves as it goes) and is left to do its own thing.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onDown = (e: PointerEvent | MouseEvent) => {
      const t = e.target as Node | null;
      if (!t || sheet.current?.contains(t)) return;
      outside.current = true;
      close.current();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation(); // the side panel under it stays open
    onClose();
  }

  return (
    <div
      ref={sheet}
      className={phone ? "add-sheet did-sheet did-bottom" : "add-pop did-sheet"}
      role="dialog"
      aria-labelledby={headingId}
      onKeyDown={onKey}
    >
      <div className="add-head">
        <h2 id={headingId}>{W.sheetTitle}</h2>
      </div>
      <p className="choose-muted did-sheet-todo">{item.title}</p>
      {firstUse && <p className="choose-muted did-sheet-todo">{W.notLocked}</p>}
      <DidBox item={item} at={at} today={today} label={W.sheetBox} labelHidden autoFocus onSaved={onSaved} onEnter={onClose} />
      <div className="form-actions">
        <button type="button" onClick={onClose}>
          {W.save}
        </button>
        <button type="button" className="btn-secondary" onClick={onClose}>
          {W.skip}
        </button>
      </div>
    </div>
  );
}
