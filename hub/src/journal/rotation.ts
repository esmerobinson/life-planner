// Which three questions the check-in asks on a day (journal brief §2, "Rotation").
//
// - Three slots, always in this order: 1 "noticing" (Mindfulness M*, and E1 E2 E3 E7 E12),
//   2 "skill" (D*, the other E*, I*), 3 "kindness" (K*).
// - Her own starters S1–S4 may take any slot, each roughly twice a week (a day is "theirs"
//   with chance 2 in 7, decided by the date). They are meant to recur, so the no-repeat
//   window below does not apply to them.
// - Time of day picks the flavour: before 14:00 "morning" + "any", after that "evening" + "any".
// - No prompt is repeated within REPEAT_WINDOW_DAYS days of the stored history when the slot
//   has another choice; otherwise the least recently asked one is used.
// - A question she missed (skipped, or never reached) goes back into circulation (2026-11-04):
//   the missed day doesn't count as asked, and it comes first in its slot at the next check-in
//   at its time of day (still three questions). Missed twice running: normal circulation.
// - Deterministic: the same date, flavour, active list and history give the same three on
//   every device (choices are seeded by the date). Once a day's check-in is started its
//   prompts are stored in the entry, so a device never changes them afterwards.

import { addDays } from "../domain/dates";
import type { ISODate } from "../domain/types";
import { PROMPT_BY_ID, type PromptWhen } from "./prompts";

export type Slot = "noticing" | "skill" | "kindness";
export const SLOTS: readonly Slot[] = ["noticing", "skill", "kindness"];
export const REPEAT_WINDOW_DAYS = 10;
/** The hour (local) from which the evening flavour is used. */
export const EVENING_FROM_HOUR = 14;
/** Her own starters (S*) come up on about this many days in 7. */
const OWN_DAYS_PER_WEEK = 2;

const NOTICING_E = new Set(["E1", "E2", "E3", "E7", "E12"]);

/** The slot a prompt belongs to; "own" for her own starters (any slot). */
export function slotOf(id: string): Slot | "own" {
  if (id.startsWith("S")) return "own";
  if (id.startsWith("M") || NOTICING_E.has(id)) return "noticing";
  if (id.startsWith("K")) return "kindness";
  return "skill"; // D*, other E*, I*
}

export function flavourAt(hour: number): Exclude<PromptWhen, "any"> {
  return hour < EVENING_FROM_HOUR ? "morning" : "evening";
}

/** FNV-1a: a small, stable string hash (the same on every device). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const pick = <T,>(list: readonly T[], seed: string): T => list[hash(seed) % list.length]!;

export interface RotationInput {
  date: ISODate;
  /** Local hour of the day (0–23). */
  hour: number;
  /** The prompt ids switched on (Choose questions). */
  active: readonly string[];
  /**
   * Earlier check-ins (any order); days on or after `date` are ignored. `answered`: the
   * questions she wrote an answer to that day (absent: all of them). A question asked but not
   * answered (skipped, or not reached) was missed.
   */
  history: readonly { date: ISODate; prompts: readonly string[]; answered?: ReadonlySet<string> }[];
}

/**
 * The questions owed another turn (Esme, 2026-11-04: "add those questions back in circulation
 * if I miss one"): the last time each was asked she missed it, and the time before that (if
 * any) she answered it, so a question skipped twice running goes back to normal circulation
 * rather than coming back every day. Each with the day it was missed.
 */
export function owedPrompts(date: ISODate, history: RotationInput["history"]): Map<string, ISODate> {
  const asked = new Map<string, { date: ISODate; answered: boolean }[]>();
  for (const h of history) {
    if (h.date >= date) continue;
    for (const id of h.prompts) {
      const list = asked.get(id) ?? [];
      list.push({ date: h.date, answered: !h.answered || h.answered.has(id) });
      asked.set(id, list);
    }
  }
  const owed = new Map<string, ISODate>();
  for (const [id, list] of asked) {
    list.sort((a, b) => a.date.localeCompare(b.date));
    const last = list[list.length - 1]!;
    const before = list[list.length - 2];
    if (!last.answered && (!before || before.answered)) owed.set(id, last.date);
  }
  return owed;
}

/** The day's prompts (three when the active list allows), in slot order. */
export function pickPrompts({ date, hour, active, history }: RotationInput): string[] {
  const flavour = flavourAt(hour);
  const fits = (id: string) => {
    const p = PROMPT_BY_ID.get(id);
    return !!p && (p.when === "any" || p.when === flavour);
  };
  const on = [...new Set(active)].filter((id) => PROMPT_BY_ID.has(id)).sort();
  // When each prompt was last asked AND answered before today (a missed one isn't "recent").
  const lastAsked = new Map<string, ISODate>();
  for (const h of history) {
    if (h.date >= date) continue;
    for (const id of h.prompts) {
      if (h.answered && !h.answered.has(id)) continue;
      if ((lastAsked.get(id) ?? "") < h.date) lastAsked.set(id, h.date);
    }
  }
  const windowStart = addDays(date, -REPEAT_WINDOW_DAYS);
  const recent = (id: string) => (lastAsked.get(id) ?? "") > windowStart;
  // Missed last time: first in its slot today (oldest miss first), at its time of day.
  const owed = owedPrompts(date, history);
  const byOwed = (a: string, b: string) => owed.get(a)!.localeCompare(owed.get(b)!) || a.localeCompare(b);

  const chosen: (string | undefined)[] = [undefined, undefined, undefined];
  // Her own starters due today (or owed a turn) take a slot each (a seeded slot, else the next free one).
  const ownDue = on.filter(
    (id) => slotOf(id) === "own" && fits(id) && (owed.has(id) || hash(`${date}|own|${id}`) % 7 < OWN_DAYS_PER_WEEK),
  );
  for (const id of ownDue) {
    const start = hash(`${date}|slot|${id}`) % 3;
    for (let k = 0; k < 3; k++) {
      const s = (start + k) % 3;
      if (!chosen[s]) {
        chosen[s] = id;
        break;
      }
    }
  }

  const leastRecent = (ids: string[], seed: string) => {
    const oldest = ids.reduce((min, id) => ((lastAsked.get(id) ?? "") < min ? lastAsked.get(id) ?? "" : min), "￿");
    return pick(ids.filter((id) => (lastAsked.get(id) ?? "") === oldest), seed);
  };
  const choose = (ids: string[], seed: string): string | undefined => {
    if (ids.length === 0) return undefined;
    const fresh = ids.filter((id) => slotOf(id) === "own" || !recent(id));
    return fresh.length ? pick(fresh, seed) : leastRecent(ids, seed);
  };

  SLOTS.forEach((slot, s) => {
    if (chosen[s]) return;
    const taken = (id: string) => chosen.includes(id);
    const seed = `${date}|${slot}`;
    const missed = on.filter((id) => slotOf(id) === slot && fits(id) && !taken(id) && owed.has(id)).sort(byOwed);
    chosen[s] =
      // A question missed last time comes back first…
      missed[0] ??
      // The slot's own prompts for this time of day…
      choose(on.filter((id) => slotOf(id) === slot && fits(id) && !taken(id)), seed) ??
      // …else any other prompt for this time of day (she may have switched a whole slot off)…
      choose(on.filter((id) => fits(id) && !taken(id)), seed) ??
      // …else anything switched on.
      choose(on.filter((id) => !taken(id)), seed);
  });
  return chosen.filter((id): id is string => id !== undefined);
}
