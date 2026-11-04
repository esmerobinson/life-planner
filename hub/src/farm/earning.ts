// Esme's Farm: earning (game design v2, section 7 and 8). Pure functions.
//
// Earned stickers are COMPUTED from her real data, never stored as events, so every device
// agrees. Only activity on or after the farm's start counts (a fresh start): a to-do created
// earlier but ticked later counts; each thing counts once. Everything is a total, never a run:
// there are no streaks and nothing "in a row", and a missed day is never looked at.
//   - Morning pages count mornings, not words.
//   - Exercises count days, not cards.

import { addDays, daysBetween, endOfMonth, mondayOf, monthOf, weekdayOf } from "../domain/dates";
import { monthHit, type GoalSources } from "../domain/goalCounts";
import { isHabit } from "../domain/habits";
import { milestoneProgress, isSortedTask, tickOffDates } from "../domain/progress";
import { isProject } from "../domain/projects";
import { AREA_IDS, type Goal, type ISODate, type Item } from "../domain/types";
import { MONTHS, STICKERS, type Source, type Sticker } from "./catalogue";

/** What the journal tells the farm, read in memory with the confirmed key (farm/journalFacts.ts). */
export interface JournalFacts {
  /** Days with a finished morning page or a morning photo. */
  morning: ReadonlySet<ISODate>;
  /** Days with a finished morning page shorter than the 1,000-word page. */
  shortPages: ReadonlySet<ISODate>;
  /** Days she checked in (every question moved past). */
  checkins: ReadonlySet<ISODate>;
  /** Exercise cards done (or tracker days logged): one per card per day. */
  exercise: readonly { date: ISODate; card: string }[];
  /** Workbook chapters finished, with the day the last card of each was first done. */
  chapters: readonly { track: string; chapter: number; doneOn: ISODate }[];
  /** The day each whole workbook was finished (null: not yet). */
  workbooks: { dbt: ISODate | null; bpd: ISODate | null };
}

export interface EarningInput {
  /** The farm's start. */
  start: ISODate;
  today: ISODate;
  /** Live items (open and done; listItems). */
  items: readonly Item[];
  /** Live goals (listGoals). */
  goals: readonly Goal[];
  /** Days Today's list was seen finished (farm state). */
  todayDone: readonly ISODate[];
  /** Null while the journal is locked on this device: journal stickers then wait. */
  journal: JournalFacts | null;
}

export type Counters = ReadonlyMap<Source, number>;

const on = (start: ISODate) => (d: ISODate | undefined): d is ISODate => d !== undefined && d >= start;

/**
 * The items as if nothing had been done before `start`: earlier tick-offs, habit sessions and
 * project sessions are taken off (the rows themselves are never changed).
 */
export function clipItems(items: readonly Item[], start: ISODate): Item[] {
  const after = on(start);
  return items.map((it) => {
    let out = it;
    if (it.doneDates) out = { ...out, doneDates: it.doneDates.filter(after) };
    if (it.sessions) out = { ...out, sessions: it.sessions.map((s) => (s.doneOn && !after(s.doneOn) ? { ...s, doneOn: undefined } : s)) };
    if (it.status === "done" && !after(it.completedAt)) {
      const { completedAt: _c, ...rest } = out;
      out = { ...rest, status: "open" };
    }
    return out;
  });
}

/** Distinct days, sorted. */
const days = (ds: Iterable<ISODate>): ISODate[] => [...new Set(ds)].sort();

/** How many times consecutive days are at least `away` days apart (days with nothing between). */
function gaps(sorted: readonly ISODate[], away: number): number {
  let n = 0;
  for (let i = 1; i < sorted.length; i++) if (daysBetween(sorted[i - 1]!, sorted[i]!) - 1 >= away) n++;
  return n;
}

/** A plain to-do (not a habit) that is done. */
const doneTodo = (it: Item) => isSortedTask(it) && !isHabit(it) && it.status === "done" && it.completedAt !== undefined;

/** Planned sessions of a habit between two days (inclusive), by its weekdays. */
function planned(it: Item, from: ISODate, to: ISODate): number {
  const want = new Set(it.recur ?? []);
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (want.has(weekdayOf(d))) n++;
  return n;
}

/** Months from `from`'s month to `to`'s, "YYYY-MM". */
function monthsBetween(from: ISODate, to: ISODate): string[] {
  const out: string[] = [];
  let [y, m] = monthOf(from).split("-").map(Number) as [number, number];
  const last = monthOf(to);
  for (;;) {
    const key = `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`;
    if (key > last) break;
    out.push(key);
    m++;
    if (m === 13) { m = 1; y++; }
  }
  return out;
}

/** Every counter the stickers read. Journal counters are absent while the journal is locked. */
export function counters(input: EarningInput): Counters {
  const { start, today, journal } = input;
  const after = on(start);
  const items = clipItems(input.items, start);
  const c = new Map<Source, number>();
  const set = (k: Source, v: number) => c.set(k, v);

  set("started", 1);

  // To-dos per area: each done to-do once, on the day it was ticked (habits are sessions instead).
  for (const area of AREA_IDS) {
    if (area === "inbox") continue;
    set(`todos:${area}`, items.filter((it) => doneTodo(it) && it.areaId === area).length);
  }
  set("projects", items.filter((it) => isProject(it) && it.status === "done").length);
  set("late-ticks", items.filter((it) => doneTodo(it) && it.due !== undefined && it.completedAt! > it.due).length);

  // Habits: sessions, weeks with one, months finished, and coming back to one after a week off.
  const habits = items.filter((it) => isSortedTask(it) && isHabit(it) && it.status === "open");
  const sessions = habits.flatMap((h) => days(h.doneDates ?? []));
  set("habit-sessions", sessions.length);
  set("habit-weeks", new Set(sessions.map(mondayOf)).size);
  let monthsDone = 0;
  for (const h of habits) {
    for (const month of monthsBetween(start, today)) {
      const [y, m] = month.split("-").map(Number) as [number, number];
      const from = `${month}-01` < start ? start : `${month}-01`;
      const to = endOfMonth(y, m);
      const want = planned(h, from, to);
      const did = (h.doneDates ?? []).filter((d) => d >= from && d <= to).length;
      if (want > 0 && did >= want) monthsDone++;
    }
  }
  set("habit-months", monthsDone);
  set("habit-after-week-off", habits.some((h) => gaps(days(h.doneDates ?? []), 7) > 0) ? 1 : 0);

  set("today-finished", days(input.todayDone.filter(after)).length);

  // Goals: monthly goals reached (counted with only what happened since the start), whole goals done.
  const journalDays = journal ? new Set([...journal.morning, ...journal.checkins].filter(after)) : new Set<ISODate>();
  const src: GoalSources = {
    journalDays,
    exercise: journal ? journal.exercise.filter((e) => after(e.date)) : null,
    items,
  };
  let hits = 0;
  for (const g of input.goals) {
    const clipped: Goal = {
      ...g,
      monthGoals: g.monthGoals?.map((m) => (m.log ? { ...m, log: m.log.filter(after) } : m)),
    };
    for (const month of monthsBetween(start, today)) if (monthHit(clipped, month, src) === true) hits++;
  }
  set("monthly-goals", hits);
  let whole = 0;
  for (const g of input.goals) {
    if (g.kind !== "finite") continue;
    const p = milestoneProgress(g, input.items as Item[]);
    if (!p || p.total === 0 || p.done < p.total) continue;
    const linked = input.items.filter((it) => it.goalId === g.id && !isHabit(it) && (p.flagged ? it.milestone : true));
    const last = linked.map((it) => it.completedAt).filter((d): d is ISODate => !!d).sort().pop();
    if (after(last)) whole++;
  }
  set("whole-goals", whole);

  // The journal (only while it opens here).
  if (journal) {
    set("morning-pages", [...journal.morning].filter(after).length);
    set("short-pages", [...journal.shortPages].some(after) ? 1 : 0);
    const checkins = days([...journal.checkins].filter(after));
    set("checkins", checkins.length);
    set("checkin-after-gap", gaps(checkins, 3) > 0 ? 1 : 0);
    set("exercise-days", new Set(journal.exercise.map((e) => e.date).filter(after)).size);
    set("chapters", journal.chapters.filter((ch) => after(ch.doneOn)).length);
    set("workbook:dbt", after(journal.workbooks.dbt ?? undefined) ? 1 : 0);
    set("workbook:bpd", after(journal.workbooks.bpd ?? undefined) ? 1 : 0);
  }

  // Coming back (the start day counts: she opened the farm), and the months she did anything at all.
  const active = days([
    ...items.flatMap(tickOffDates),
    ...items.flatMap((it) => (it.sessions ?? []).map((s) => s.doneOn).filter(after)),
    ...input.todayDone.filter(after),
    ...(journal ? [...journal.morning, ...journal.checkins, ...journal.exercise.map((e) => e.date)].filter(after) : []),
  ].filter((d) => d <= today));
  set("returns", gaps(days([start, ...active]), 3));
  for (const month of new Set(active.map((d) => MONTHS[Number(d.slice(5, 7)) - 1]!))) set(`month:${month}`, 1);

  return c;
}

/** Whether a sticker's counter has reached it. */
export const reached = (s: Sticker, c: Counters): boolean => !s.later && (c.get(s.rule.source) ?? 0) >= s.rule.at;

/** The stickers her data has earned (keys, book order). */
export function derivedEarned(c: Counters): string[] {
  return STICKERS.filter((s) => reached(s, c)).map((s) => s.key);
}

/**
 * Everything earned: what the data earns now, plus anything already seen or placed (nothing is
 * ever lost, even if a to-do is later unticked). Book order.
 */
export function allEarned(c: Counters | null, seen: ReadonlySet<string>, placed: ReadonlyMap<string, string>): string[] {
  const derived = new Set(c ? derivedEarned(c) : []);
  return STICKERS.filter((s) => derived.has(s.key) || seen.has(s.key) || placed.has(s.key)).map((s) => s.key);
}

// ---- workbooks -----------------------------------------------------------------------------

export interface CardLike {
  id: string;
  track: string;
  chapter: number | null;
  optional: boolean;
  day: number | null;
}

/**
 * Chapters finished: every card of the chapter (in the daily sequence) done at least once; the
 * chapter's day is when its last card was first done. A workbook (a track whose title or id
 * names DBT or BPD) is finished when all its chapters are.
 */
export function workbookProgress(
  cards: readonly CardLike[],
  tracks: readonly { id: string; title: string }[],
  marks: readonly { date: ISODate; id: string; done: boolean }[],
): Pick<JournalFacts, "chapters" | "workbooks"> {
  const first = new Map<string, ISODate>();
  for (const m of marks) {
    if (!m.done) continue;
    const had = first.get(m.id);
    if (!had || m.date < had) first.set(m.id, m.date);
  }
  const byChapter = new Map<string, { track: string; chapter: number; cards: CardLike[] }>();
  for (const card of cards) {
    if (card.optional || card.day === null || card.chapter === null) continue;
    const k = `${card.track}\u0000${card.chapter}`;
    const ch = byChapter.get(k) ?? { track: card.track, chapter: card.chapter, cards: [] };
    ch.cards.push(card);
    byChapter.set(k, ch);
  }
  const chapters: { track: string; chapter: number; doneOn: ISODate }[] = [];
  const perTrack = new Map<string, { total: number; done: ISODate[] }>();
  for (const ch of byChapter.values()) {
    const t = perTrack.get(ch.track) ?? { total: 0, done: [] };
    t.total++;
    perTrack.set(ch.track, t);
    const dates = ch.cards.map((c) => first.get(c.id));
    if (dates.some((d) => d === undefined)) continue;
    const doneOn = (dates as ISODate[]).sort().pop()!;
    chapters.push({ track: ch.track, chapter: ch.chapter, doneOn });
    t.done.push(doneOn);
  }
  const finished = (kind: RegExp): ISODate | null => {
    for (const [id, t] of perTrack) {
      const title = tracks.find((x) => x.id === id)?.title ?? "";
      if (!kind.test(`${id} ${title}`)) continue;
      if (t.total > 0 && t.done.length === t.total) return t.done.sort().pop()!;
    }
    return null;
  };
  return { chapters, workbooks: { dbt: finished(/\bDBT\b/i), bpd: finished(/\bBPD\b/i) } };
}
