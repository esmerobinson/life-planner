import { useEffect, useState } from "react";
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

  async function pin(date: ISODate | undefined, close?: (refocus?: boolean) => void) {
    const ok = await attempt(() => pinTo(itemId, date, today));
    close?.(!ok);
    if (ok) await onScheduled();
  }

  /**
   * A typed or picked day saves as soon as it is a real day, today or later, and the
   * popover stays open (typing a year digit by digit passes through early years, which
   * are skipped; a later correction simply saves again).
   */
  function onDay(value: string) {
    setDay(value);
    if (isValidISODate(value) && value >= today) void pin(value);
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
          <button type="button" onClick={() => void pin(today, close)}>
            Today
          </button>
          <button type="button" onClick={() => void pin(addDays(today, 1), close)}>
            Tomorrow
          </button>
          <button type="button" onClick={() => void pin(nextMonday(today), close)}>
            Next week
          </button>
          <hr />
          <input
            type="date"
            aria-label={`Day for ${label}`}
            min={today}
            value={day}
            onChange={(e) => onDay(e.target.value)}
          />
          <hr />
          <button type="button" onClick={() => void pin(undefined, close)}>
            Clear
          </button>
        </>
      )}
    </IconPopover>
  );
}
