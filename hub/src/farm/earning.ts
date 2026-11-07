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
import { milestoneProgress, isSortedTask } from "../domain/progress";
import { isBook } from "../domain/books";
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

/** Not in the Bin. Archived things still count: archiving never takes anything away (review I3). */
const kept = (it: Item) => it.status !== "deleted" && it.status !== "purged";

/** A plain to-do (not a habit) that was done: done, or done and then archived. */
const doneTodo = (it: Item) =>
  isSortedTask(it) && !isHabit(it) && (it.status === "done" || it.status === "archived") && it.completedAt !== undefined;

/** A habit month counts at 80% of its planned sessions, in any order (Esme, 2026-11-04). */
export const HABIT_MONTH_SHARE = 0.8;

/** The Great oak (Esme, 2026-11-06): YEAR_GOOD good months of one habit within YEAR_WINDOW in a row. */
export const YEAR_WINDOW = 12;
export const YEAR_GOOD = 9;

/**
 * The most `true`s in any `size` consecutive entries. Near the end the window just runs out, so
 * 9 good months in a row count as soon as the ninth is done.
 */
export function bestWindow(flags: readonly boolean[], size: number): number {
  let best = 0;
  for (let i = 0; i < flags.length; i++) {
    let n = 0;
    for (let j = i; j < Math.min(flags.length, i + size); j++) if (flags[j]) n++;
    best = Math.max(best, n);
  }
  return best;
}

/**
 * When an archived habit was archived. There's no archivedAt field: every archive (repo.ts) sets
 * `touchedAt` to that day and nothing ticks an archived habit, so its `touchedAt` is the archive
 * day or later; never before its last tick, so a session is never left outside its own month.
 */
function archivedOn(h: Item): ISODate | null {
  if (h.status !== "archived") return null;
  const last = [...(h.doneDates ?? [])].sort().pop();
  return last !== undefined && last > h.touchedAt ? last : h.touchedAt;
}

/**
 * Each habit's months since the start: planned sessions and sessions done (any days of that
 * month). Planned sessions count from the latest of the month's start, the farm's start and the
 * day the habit was made, up to the month's end or the day it was archived (Esme, 2026-11-04),
 * so a habit made mid-month can count that month.
 */
function habitMonths(h: Item, start: ISODate, today: ISODate): { month: string; want: number; did: number }[] {
  const made = h.createdAt;
  const archived = archivedOn(h);
  return monthsBetween(start, today).map((month) => {
    const [y, m] = month.split("-").map(Number) as [number, number];
    const from = [`${month}-01`, start, made].sort().pop()!;
    const end = endOfMonth(y, m);
    const to = archived !== null && archived < end ? archived : end;
    if (from > to) return { month, want: 0, did: 0 };
    return { month, want: planned(h, from, to), did: new Set((h.doneDates ?? []).filter((d) => d >= from && d <= to)).size };
  });
}

/**
 * "Area cleared" (Esme, 2026-11-04): for each area and each calendar month since the start that
 * has ENDED, every to-do due or planned in that month (from the start) was done by the month's
 * end. Areas with nothing due that month don't count. Returns, per area, how many months were
 * cleared, so repeats are derived from the data (never stored increments: no double counting
 * across devices).
 */
export function areaClears(items: readonly Item[], start: ISODate, today: ISODate): Record<string, number> {
  const out: Record<string, number> = {};
  for (const month of monthsBetween(start, today)) {
    const [y, m] = month.split("-").map(Number) as [number, number];
    const last = endOfMonth(y, m);
    if (last >= today) continue; // only months that have ended
    const from = `${month}-01` < start ? start : `${month}-01`;
    const inMonth = (d: ISODate | undefined) => d !== undefined && d >= from && d <= last;
    for (const area of AREA_IDS) {
      if (area === "inbox") continue;
      const due = items.filter(
        (it) => kept(it) && isSortedTask(it) && !isHabit(it) && it.areaId === area && (inMonth(it.due) || inMonth(it.pinnedDate)),
      );
      if (due.length > 0 && due.every((it) => doneTodo(it) && it.completedAt! <= last)) out[area] = (out[area] ?? 0) + 1;
    }
  }
  return out;
}

/** All areas' cleared months together. */
export const areasCleared = (items: readonly Item[], start: ISODate, today: ISODate): number =>
  Object.values(areaClears(items, start, today)).reduce((a, b) => a + b, 0);

/** The month after "YYYY-MM". */
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number) as [number, number];
  return mo === 12 ? `${String(y + 1).padStart(4, "0")}-01` : `${m.slice(0, 5)}${String(mo + 1).padStart(2, "0")}`;
};

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
    set(`todos:${area}`, items.filter((it) => doneTodo(it) && after(it.completedAt) && it.areaId === area).length);
  }
  const doneProject = (it: Item) => isProject(it) && (it.status === "done" || it.status === "archived") && after(it.completedAt);
  set("projects", items.filter(doneProject).length);
  set("late-ticks", items.filter((it) => doneTodo(it) && after(it.completedAt) && it.due !== undefined && it.completedAt! > it.due).length);
  set("reading-books", items.filter((it) => kept(it) && isBook(it) && it.bookStatus === "read" && after(it.finishedOn)).length);

  // Habits (archived ones too): sessions, weeks with one, months at 80%, a first full month, the
  // longest run of 80% months (restarts quietly after a lower month), and coming back after a week off.
  const habits = items.filter((it) => isSortedTask(it) && isHabit(it) && kept(it));
  const sessions = habits.flatMap((h) => days(h.doneDates ?? []));
  set("habit-sessions", sessions.length);
  set("habit-weeks", new Set(sessions.map(mondayOf)).size);
  let goodMonths = 0;
  let fullMonths = 0; // habits that have had a full month (each habit's first counts once)
  let longestRun = 0;
  let year = false; // the Great oak: some habit had 9 good months within 12 in a row
  for (const h of habits) {
    let run = 0;
    let prev = "";
    let full = false;
    const goods: boolean[] = []; // one per calendar month since the start, in order
    for (const { month, want, did } of habitMonths(h, start, today)) {
      const good = want > 0 && did >= want * HABIT_MONTH_SHARE;
      goods.push(good);
      if (want > 0 && did >= want) full = true;
      if (good) {
        goodMonths++;
        run = prev !== "" && nextMonth(prev) === month ? run + 1 : 1;
        prev = month;
        longestRun = Math.max(longestRun, run);
      } else {
        run = 0;
        prev = "";
      }
    }
    if (full) fullMonths++;
    if (bestWindow(goods, YEAR_WINDOW) >= YEAR_GOOD) year = true;
  }
  set("habit-months", goodMonths);
  set("habit-full-month", fullMonths);
  const clears = areaClears(items, start, today);
  for (const area of AREA_IDS) if (area !== "inbox") set(`cleared:${area}`, clears[area] ?? 0);
  set("habit-run", longestRun);
  set("habit-year", year ? 1 : 0);
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
    ...items.filter(doneTodo).map((it) => it.completedAt!),
    ...sessions,
    ...items.filter(kept).flatMap((it) => (it.sessions ?? []).map((s) => s.doneOn)),
    ...input.todayDone.filter(after),
    ...(journal ? [...journal.morning, ...journal.checkins, ...journal.exercise.map((e) => e.date)].filter(after) : []),
  ].filter((d): d is ISODate => after(d) && d <= today));
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
