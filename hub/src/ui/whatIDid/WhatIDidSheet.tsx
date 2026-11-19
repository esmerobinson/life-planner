import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import type { DidEntry, ISODate, Item } from "../../domain/types";
import { sheetKeys } from "../ChooseGoalsSheet";
import { DidBox } from "./DidBox";
import { DID_WORDS as W } from "./words";

/**
 * "What did you do?" (Esme, 19 Nov 2026): after a to-do is ticked (it is already done, the
 * sparkle already playing), a small sheet with the box focused, Attach files (the Mac app only;
 * elsewhere "Attach files on your Mac"), Save and Skip. Skip, Escape or a click on the dimmed
 * page close it and the to-do stays done; whatever was typed is saved however it closes.
 *
 * Built from what exists (nothing new is designed): on a computer the Choose goals pop-up
 * (goals.css .choose-shade / .choose-sheet) at the Add card's 440px width; on the phone the Add
 * sheet from the bottom (add.css .add-shade / .add-sheet). It sits over the side panel (a tick
 * there asks too) and under the tick's sparkle (whatIDid.css).
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
  const headingId = useId();

  useEffect(() => {
    opener.current = document.activeElement;
    return () => {
      const back = opener.current as HTMLElement | null;
      if (back && back.isConnected && typeof back.focus === "function") back.focus();
    };
  }, []);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => sheetKeys(e, sheet.current, onClose);

  return (
    <div
      className={phone ? "add-shade did-shade" : "choose-shade did-shade"}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheet}
        className={phone ? "add-sheet did-sheet" : "choose-sheet did-sheet"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        onKeyDown={onKey}
      >
        <div className="add-head">
          <h2 id={headingId}>{W.sheetTitle}</h2>
        </div>
        <p className="choose-muted did-sheet-todo">{item.title}</p>
        <DidBox
          item={item}
          at={at}
          today={today}
          label={W.sheetBox}
          labelHidden
          autoFocus
          onSaved={onSaved}
          onEnter={onClose}
        />
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            {W.save}
          </button>
          <button type="button" className="btn-secondary" onClick={onClose}>
            {W.skip}
          </button>
        </div>
      </div>
    </div>
  );
}
