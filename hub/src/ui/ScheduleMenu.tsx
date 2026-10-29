import { useEffect, useRef, useState } from "react";
import { pinTo, updateItem } from "../data/repo";
import { addDays, isValidISODate } from "../domain/dates";
import { nextFriday, nextMonday } from "../domain/display";
import type { ISODate } from "../domain/types";
import { CALENDAR_GLYPH, IconPopover } from "./IconPopover";
import { useSaveError } from "./messages";

type Close = (refocus?: boolean) => void;

/**
 * One labelled part of the menu: quick choices, then a day field with Set, then (when
 * offered) Clear. The day field is saved only on an explicit action: Set, Enter, or
 * leaving the field for somewhere outside the popover. Never on each change: typing
 * passes through real days on the way (30 Oct before 30 Nov), and an early save could
 * move the row away mid-edit. Only a real day, today or later, that differs from the
 * current value is saved.
 */
function DayPart({
  heading,
  quick,
  current,
  today,
  fieldLabel,
  save,
  clearable,
  close,
  pressing,
}: {
  heading: string;
  quick: { text: string; date: ISODate }[];
  current?: ISODate;
  today: ISODate;
  fieldLabel: string;
  /** Saves a day, or clears with undefined. */
  save: (date: ISODate | undefined, close: Close) => void;
  /** Whether Clear is offered. */
  clearable: boolean;
  close: Close;
  /**
   * Set when a button in this popover is pressed. Safari/WebKit (the Mac app and iPhone)
   * give a clicked button no focus, so the day field's blur arrives with no relatedTarget
   * and would otherwise save the typed day before the pressed choice runs.
   */
  pressing: { current: boolean };
}) {
  const [day, setDay] = useState(current ?? "");
  useEffect(() => setDay(current ?? ""), [current]);
  const press = () => {
    pressing.current = true;
  };

  function commitDay() {
    if (!isValidISODate(day) || day < today || day === current) return;
    save(day, close);
  }

  return (
    <div role="group" aria-label={heading}>
      <div className="pop-menu-label" aria-hidden="true">
        {heading}
      </div>
      {quick.map((q) => (
        <button key={q.text} type="button" onPointerDown={press} onClick={() => save(q.date, close)}>
          {q.text}
        </button>
      ))}
      <hr />
      <input
        type="date"
        aria-label={fieldLabel}
        min={today}
        value={day}
        onChange={(e) => setDay(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commitDay();
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
          commitDay();
        }}
      />
      <button type="button" onPointerDown={press} onClick={commitDay}>
        Set
      </button>
      {clearable && (
        <>
          <hr />
          <button type="button" onPointerDown={press} onClick={() => save(undefined, close)}>
            Clear
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The calendar icon, in two labelled parts. "Do it on": Today, Tomorrow, Next week (next
 * Monday), a day, or Clear; sets the item's pinnedDate (the day it shows on Today), never
 * its due date. "Deadline": Today, Tomorrow, Friday, Next week, a day, or Clear (only when
 * a deadline is set); sets the item's due date, never its pinnedDate.
 */
export function ScheduleMenu({
  itemId,
  pinnedDate,
  due,
  today,
  onScheduled,
  label,
}: {
  itemId: string;
  pinnedDate?: ISODate;
  due?: ISODate;
  today: ISODate;
  onScheduled: () => void | Promise<void>;
  label: string;
}) {
  const { attempt, saveError } = useSaveError();
  const pressing = useRef(false);

  async function run(write: () => Promise<void>, close: Close) {
    const ok = await attempt(write);
    close(!ok);
    if (ok) await onScheduled();
  }
  const pin = (date: ISODate | undefined, close: Close) => void run(() => pinTo(itemId, date, today), close);
  const setDue = (date: ISODate | undefined, close: Close) =>
    void run(() => updateItem(itemId, { due: date }, today), close);

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
          <DayPart
            heading="Do it on"
            quick={[
              { text: "Today", date: today },
              { text: "Tomorrow", date: addDays(today, 1) },
              { text: "Next week", date: nextMonday(today) },
            ]}
            current={pinnedDate}
            today={today}
            fieldLabel={`Day for ${label}`}
            save={pin}
            clearable
            close={close}
            pressing={pressing}
          />
          <hr />
          <DayPart
            heading="Deadline"
            quick={[
              { text: "Today", date: today },
              { text: "Tomorrow", date: addDays(today, 1) },
              { text: "Friday", date: nextFriday(today) },
              { text: "Next week", date: nextMonday(today) },
            ]}
            current={due}
            today={today}
            fieldLabel={`Deadline for ${label}`}
            save={setDue}
            clearable={due !== undefined}
            close={close}
            pressing={pressing}
          />
        </>
      )}
    </IconPopover>
  );
}
