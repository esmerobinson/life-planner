// The Journal's "Mental health exercise" (exercise brief): one learn + try card a day.
//
// The cards are her private study notes for a book she owns. They are never in the repo or
// the app: she imports them once from a private file, and they are stored sealed like the
// journal (journalRepo.ts). This module only checks the file and works out which card is
// today's; it holds no card text.
//
// - Today's card is the lowest-numbered card not yet done in this round (so a missed day
//   skips nothing). Once shown it stays today's card all day, even after it is ticked.
// - After the last card a new round starts from card 1, starred cards first.
// - Progress is per device and per day; a card counts as done if any device ticked it.
// - Stars: each device keeps its own marks; per card the newest mark from any device wins.

import { isObj, isStr } from "../data/validate";
import type { ISODate } from "../domain/types";

export interface ExerciseCard {
  day: number;
  theme: string;
  learn: string;
  try: string;
  book: string;
  skill: string;
  session: boolean;
}

export interface CardSet {
  source: string;
  /** In day order, days unique. */
  cards: ExerciseCard[];
}

/** The most characters any one text in the file may have. */
export const MAX_CARD_FIELD = 2000;
/** Days run 1..MAX_CARD_DAY. */
export const MAX_CARD_DAY = 1000;
/** Shown when a chosen file isn't a card file this app can read (nothing is changed). */
export const INVALID_CARD_FILE = "That isn't an exercise card file this app can read. Nothing was changed.";

const text = (v: unknown, required: boolean): v is string => isStr(v) && v.length <= MAX_CARD_FIELD && (!required || v.trim() !== "");
const validDay = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_CARD_DAY;

/** One card, keeping only the card's own fields; null if any is wrong. */
function checkCard(v: unknown): ExerciseCard | null {
  if (!isObj(v)) return null;
  const { day, theme, learn, session } = v;
  const tryText = v.try;
  const book = v.book;
  const skill = v.skill;
  if (!validDay(day) || !text(theme, true) || !text(learn, true) || !text(tryText, true)) return null;
  if (!text(book, false) || !text(skill, false) || typeof session !== "boolean") return null;
  return { day, theme, learn, try: tryText, book, skill, session };
}

function checkCards(v: unknown): ExerciseCard[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_CARD_DAY) return null;
  const out: ExerciseCard[] = [];
  const days = new Set<number>();
  for (const c of v) {
    const card = checkCard(c);
    if (!card || days.has(card.day)) return null;
    days.add(card.day);
    out.push(card);
  }
  return out.sort((a, b) => a.day - b.day);
}

/** The import file (`{ app, kind, version, source, cards }`), checked strictly; null if not. */
export function checkCardFile(v: unknown): CardSet | null {
  if (!isObj(v) || v.app !== "esmeworld" || v.kind !== "exercise-cards" || v.version !== 1) return null;
  if (!text(v.source, false)) return null;
  const cards = checkCards(v.cards);
  return cards ? { source: v.source, cards } : null;
}

/** A chosen file's text as a card set, or null. */
export function parseCardFile(raw: string): CardSet | null {
  try {
    return checkCardFile(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** A stored card set (after opening the sealed row) is exactly the shape this version writes. */
export function validCardSet(v: unknown): v is CardSet {
  if (!isObj(v) || !text(v.source, false) || !Array.isArray(v.cards)) return false;
  const cards = checkCards(v.cards);
  return cards !== null && cards.every((c, i) => {
    const s = (v.cards as unknown[])[i] as Record<string, unknown>;
    return Object.keys(s).length === 7 && s.day === c.day;
  });
}

// ---- which card is today's -----------------------------------------------------------------

/** One device's progress row for one day: the card shown that day and whether it was ticked. */
export interface ExerciseMark {
  date: ISODate;
  device: string;
  day: number;
  done: boolean;
}

export interface ExercisePlan {
  /** 1, then 2 once every card has been done, and so on. */
  round: number;
  today: { card: ExerciseCard; done: boolean };
  /** Whether this device should record today's card as shown (no row for today yet). */
  record: boolean;
  /** The card after today's ("Show the next one anyway"; tomorrow's if nothing changes). */
  next: ExerciseCard;
  /** Cards done this round (today's included once ticked). */
  doneThisRound: ReadonlySet<number>;
}

/** A round's order: round 1 by day; later rounds starred cards first, then the rest. */
function order(cards: ExerciseCard[], round: number, starred: ReadonlySet<number>): ExerciseCard[] {
  if (round === 1) return cards;
  return [...cards.filter((c) => starred.has(c.day)), ...cards.filter((c) => !starred.has(c.day))];
}

/** Adds a done card to a round; a full round starts the next one. */
function advance(state: { round: number; done: Set<number> }, day: number, total: number) {
  if (state.done.has(day)) return;
  state.done.add(day);
  if (state.done.size === total) {
    state.round++;
    state.done = new Set();
  }
}

const firstUndone = (cards: ExerciseCard[], round: number, starred: ReadonlySet<number>, done: ReadonlySet<number>) =>
  order(cards, round, starred).find((c) => !done.has(c.day)) ?? cards[0]!;

/** Today's card, the round, and the next card, from every device's progress rows. */
export function planExercise(
  cards: ExerciseCard[],
  marks: ExerciseMark[],
  starred: ReadonlySet<number>,
  today: ISODate,
  deviceId: string,
): ExercisePlan {
  const byDay = new Map(cards.map((c) => [c.day, c]));
  const known = marks.filter((m) => byDay.has(m.day));

  // Every earlier day's ticks, oldest first, walked into rounds.
  const earlier = new Map<string, { date: ISODate; day: number }>();
  for (const m of known) if (m.done && m.date < today) earlier.set(`${m.date}|${m.day}`, m);
  const state = { round: 1, done: new Set<number>() };
  for (const m of [...earlier.values()].sort((a, b) => a.date.localeCompare(b.date) || a.day - b.day)) {
    advance(state, m.day, cards.length);
  }

  const todays = known.filter((m) => m.date === today).sort((a, b) => a.day - b.day);
  const ticked = todays.find((m) => m.done);
  const shown = ticked ?? todays.find((m) => m.device === deviceId) ?? todays[0];
  const card = shown ? byDay.get(shown.day)! : firstUndone(cards, state.round, starred, state.done);

  const round = state.round;
  const after = { round: state.round, done: new Set(state.done) };
  advance(after, card.day, cards.length);
  const next = firstUndone(cards, after.round, starred, after.done);
  const doneThisRound = new Set(state.done);
  if (ticked) doneThisRound.add(card.day);
  return { round, today: { card, done: ticked !== undefined }, record: todays.length === 0, next, doneThisRound };
}

// ---- stars ---------------------------------------------------------------------------------

/** One star mark in a device's stars row. */
export interface StarMark {
  day: number;
  on: boolean;
  at: number;
}

/** The starred cards: for each card, the newest mark from any device. */
export function mergeStars(devices: StarMark[][]): Set<number> {
  const newest = new Map<number, StarMark>();
  for (const marks of devices) {
    for (const m of marks) {
      const prev = newest.get(m.day);
      if (!prev || m.at > prev.at) newest.set(m.day, m);
    }
  }
  return new Set([...newest.values()].filter((m) => m.on).map((m) => m.day));
}
