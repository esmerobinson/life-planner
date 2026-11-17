import { addDays, daysBetween, mondayOf } from "./dates";
import type { ISODate, Item } from "./types";

// Fixed English names (the design asks for "Mon 26 Oct", not the browser's locale).
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function parts(d: ISODate) {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, day, dow: new Date(Date.UTC(y, m - 1, day)).getUTCDay() };
}

/** "26 Oct", with the year added when it is not today's year. */
export function shortDate(d: ISODate, today: ISODate): string {
  const { y, m, day } = parts(d);
  const year = String(y) === today.slice(0, 4) ? "" : ` ${y}`;
  return `${day} ${MONTHS[m - 1]}${year}`;
}

/** "Mon 26 Oct", with the year added when it is not today's year. */
export function dayLabel(d: ISODate, today: ISODate): string {
  return `${DAYS[parts(d).dow]} ${shortDate(d, today)}`;
}

/** "October". */
export function monthName(d: ISODate): string {
  return MONTH_NAMES[parts(d).m - 1];
}

/** The Monday of next week. */
export function nextMonday(today: ISODate): ISODate {
  return addDays(mondayOf(today), 7);
}

/** The next Friday after today; when today is a Friday, the Friday a week later. */
export function nextFriday(today: ISODate): ISODate {
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(today, ((5 - dow + 7) % 7) || 7);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** A to-do's "HH:MM" as she reads it: "3:00pm", "9:30am", "12:15am". PROVISIONAL wording. */
export function timeLabel(time: string): string {
  const h = Number(time.slice(0, 2));
  return `${h % 12 === 0 ? 12 : h % 12}:${time.slice(3, 5)}${h < 12 ? "am" : "pm"}`;
}

/**
 * The small line under a task's title: its due date (late when overdue), the day it is
 * pinned to (only a pin for today or later; pickToday ignores older pins), and its time
 * (only when it has a day).
 */
export function dueLine(item: Item, today: ISODate): { due?: string; late?: boolean; on?: string; time?: string } {
  const out: { due?: string; late?: boolean; on?: string; time?: string } = {};
  if (item.time && (item.due !== undefined || item.pinnedDate !== undefined)) out.time = timeLabel(item.time);
  if (item.due !== undefined) {
    const n = daysBetween(today, item.due);
    if (n === 0) out.due = "Due today";
    else if (n === 1) out.due = "Due tomorrow";
    else if (n > 1) out.due = `Due ${dayLabel(item.due, today)}`;
    else out.due = `Due ${dayLabel(item.due, today)} · ${plural(-n, "day")} late`;
    out.late = n < 0;
  }
  if (item.pinnedDate !== undefined && item.pinnedDate >= today) out.on = `On ${dayLabel(item.pinnedDate, today)}`;
  return out;
}
