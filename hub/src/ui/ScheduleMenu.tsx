import { useEffect, useRef, useState } from "react";
import { pinTo } from "../data/repo";
import { addDays, isValidISODate } from "../domain/dates";
import { nextMonday } from "../domain/display";
import type { ISODate } from "../domain/types";
import { CALENDAR_GLYPH, IconPopover } from "./IconPopover";
import { useSaveError } from "./messages";

/**
 * The calendar icon (Schedule for): Today, Tomorrow, Next week (next Monday), a day, or
 * Clear. Sets the item's pinnedDate (the day it shows on Today); never its due date.
 */
export function ScheduleMenu({
  itemId,
  pinnedDate,
  today,
  onScheduled,
  label,
}: {
  itemId: string;
  pinnedDate?: ISODate;
  today: ISODate;
  onScheduled: () => void | Promise<void>;
  label: string;
}) {
  const { attempt, saveError } = useSaveError();
  const [day, setDay] = useState(pinnedDate ?? "");
  useEffect(() => setDay(pinnedDate ?? ""), [pinnedDate]);
  /**
   * Set when a button in this popover is pressed. Safari/WebKit (the Mac app and iPhone)
   * give a clicked button no focus, so the day field's blur arrives with no relatedTarget
   * and would otherwise save the typed day before the pressed choice runs.
   */
  const pressing = useRef(false);
  const press = () => {
    pressing.current = true;
  };

  async function pin(date: ISODate | undefined, close?: (refocus?: boolean) => void) {
    const ok = await attempt(() => pinTo(itemId, date, today));
    close?.(!ok);
    if (ok) await onScheduled();
  }

  /**
   * The typed or picked day is saved only on an explicit action: Set, Enter, or leaving
   * the field for somewhere outside the popover. Never on each change: typing passes
   * through real days on the way (30 Oct before 30 Nov), and on Today an early save
   * would move the row away mid-edit. Only a real day, today or later, that differs
   * from the current pin is saved.
   */
  function commitDay(close: (refocus?: boolean) => void) {
    if (!isValidISODate(day) || day < today || day === pinnedDate) return;
    void pin(day, close);
  }

  return (
    <IconPopover
      icon={CALENDAR_GLYPH}
      label={`Schedule for: ${label}`}
      tooltip="Schedule for"
      groupLabel={`Schedule ${label} for`}
      message={saveError}
    >
      {(close) => (
        <>
          <button type="button" onPointerDown={press} onClick={() => void pin(today, close)}>
            Today
          </button>
          <button type="button" onPointerDown={press} onClick={() => void pin(addDays(today, 1), close)}>
            Tomorrow
          </button>
          <button type="button" onPointerDown={press} onClick={() => void pin(nextMonday(today), close)}>
            Next week
          </button>
          <hr />
          <input
            type="date"
            aria-label={`Day for ${label}`}
            min={today}
            value={day}
            onChange={(e) => setDay(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDay(close);
              }
            }}
            onFocus={() => {
              pressing.current = false;
            }}
            onBlur={(e) => {
              // Moving to another choice in this popover is not "leaving" it: the pressed
              // choice runs on its own click (and Set saves the typed day itself).
              if (pressing.current) {
                pressing.current = false;
                return;
              }
              const next = e.relatedTarget as Node | null;
              if (next && e.currentTarget.closest(".pop-menu")?.contains(next)) return;
              commitDay(close);
            }}
          />
          <button type="button" onPointerDown={press} onClick={() => commitDay(close)}>
            Set
          </button>
          <hr />
          <button type="button" onPointerDown={press} onClick={() => void pin(undefined, close)}>
            Clear
          </button>
        </>
      )}
    </IconPopover>
  );
}
