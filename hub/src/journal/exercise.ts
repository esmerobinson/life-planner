// The Journal's "Mental health exercise" (exercise brief; Journal v2): one learn + try card a
// day, and more if she wants ("Do the next one").
//
// The cards are her private study notes for a book she owns. They are never in the repo or
// the app: she imports them from a private file, and they are stored sealed like the journal
// (journalRepo.ts). This module only checks the file and works out which card is today's; it
// holds no card text.
//
// - Card file version 2 (Journal v2) gives every card a stable `id`, its chapter, whether it
//   is optional reading, and optional "Read more" text with up to four https sources. Version 1
//   files still import: their cards get the id "day-N" (so v1 progress, kept by day, carries on
//   for them).
// - Progress, stars and (for version 2 cards) responses are kept by card id, so re-importing an
//   updated file keeps progress for every card whose id is unchanged.
// - The daily sequence is the cards that aren't optional, by day (Chapter 1 is Day 1). Today's
//   card is the lowest one not yet done in this round (a missed day skips nothing); once shown
//   it stays today's card all day, even after it is done.
// - After the last card a new round starts from the first, starred cards first.
// - Progress is per device and per day; a card counts as done if any device marked it.
// - Stars: each device keeps its own marks; per card the newest mark from any device wins.

import { isObj, isStr } from "../data/validate";
import type { ISODate } from "../domain/types";

/** One "Read more" source: a title and an https link. */
export interface CardSource {
  title: string;
  url: string;
}

/** The kinds of answer a card can ask for (Journal v2 "parts"). */
export const PART_KINDS = ["text", "list", "rating", "choice"] as const;
export type PartKind = (typeof PART_KINDS)[number];

/**
 * One thing a card asks her to fill in: a text box, a numbered list of `count` lines, a 0–10
 * rating, or one of `options`.
 */
export interface CardPart {
  prompt: string;
  kind: PartKind;
  /** Lines in a list (1..MAX_LIST_COUNT). */
  count?: number;
  /** A choice's options. */
  options?: string[];
}

/** One part's answer: text → string; list → its lines; rating → 0..10 or null; choice → the option or null. */
export type PartValue = string | string[] | number | null;

export interface ExerciseCard {
  /** Stable across re-imports ("day-N" for a version 1 file's card). */
  id: string;
  /** Its day in the sequence; null for an optional card without one. */
  day: number | null;
  chapter: number | null;
  chapterTitle: string;
  /** Optional reading (say, the Introduction): not part of the daily sequence. */
  optional: boolean;
  theme: string;
  learn: string;
  try: string;
  book: string;
  skill: string;
  session: boolean;
  /** "Read more" text ("" when none). */
  more: string;
  sources: CardSource[];
  /** What it asks her to fill in, part by part ([]: one response box). */
  parts: CardPart[];
  /** A made-up worked example ("" when none). */
  example: string;
  /** Her book has its own worked example (in `book`). */
  bookExample: boolean;
  /** From a version 1 file: its responses keep the earlier (day and theme) row key. */
  legacy: boolean;
}

/** A sequence card always has a day. */
export type SequenceCard = ExerciseCard & { day: number };

export interface CardSet {
  source: string;
  version: 1 | 2;
  /** Optional cards first (in file order), then the sequence by day; ids and sequence days unique. */
  cards: ExerciseCard[];
}

/** The most characters any one text in the file may have ("Read more" has its own limit). */
export const MAX_CARD_FIELD = 2000;
/** The most characters of "Read more" text on one card. */
export const MAX_MORE = 6000;
/** The most sources on one card, and the longest source title. */
export const MAX_SOURCES = 4;
export const MAX_SOURCE_TITLE = 200;
/** The most parts on one card, the longest part prompt, list lines, choice options and example. */
export const MAX_PARTS = 12;
export const MAX_PART_PROMPT = 500;
export const MAX_LIST_COUNT = 30;
export const MAX_OPTIONS = 12;
export const MAX_OPTION = 200;
export const MAX_EXAMPLE = 1500;
/** The longest card id. */
export const MAX_CARD_ID = 100;
/** Days run 1..MAX_CARD_DAY. */
export const MAX_CARD_DAY = 1000;
/** Shown when a chosen file isn't a card file this app can read (nothing is changed). */
export const INVALID_CARD_FILE = "That isn't an exercise card file this app can read. Nothing was changed.";

/** A version 1 card's id. */
export const legacyCardId = (day: number): string => `day-${day}`;

const text = (v: unknown, required: boolean, max = MAX_CARD_FIELD): v is string =>
  isStr(v) && v.length <= max && (!required || v.trim() !== "");
const validDay = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_CARD_DAY;
const validChapter = (v: unknown): v is number | null =>
  v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_CARD_DAY);
const validId = (v: unknown): v is string => isStr(v) && v.trim() !== "" && v.length <= MAX_CARD_ID;

/** An https link (nothing else may be a source). */
export function httpsUrl(v: unknown): v is string {
  if (!isStr(v) || v.length > MAX_CARD_FIELD) return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

function checkSources(v: unknown): CardSource[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_SOURCES) return null;
  const out: CardSource[] = [];
  for (const s of v) {
    if (!isObj(s) || !text(s.title, true, MAX_SOURCE_TITLE) || !httpsUrl(s.url)) return null;
    out.push({ title: s.title, url: s.url });
  }
  return out;
}

function checkParts(v: unknown): CardPart[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > MAX_PARTS) return null;
  const out: CardPart[] = [];
  for (const p of v) {
    if (!isObj(p) || !text(p.prompt, true, MAX_PART_PROMPT) || !PART_KINDS.includes(p.kind as PartKind)) return null;
    const kind = p.kind as PartKind;
    if (kind === "list") {
      if (!Number.isInteger(p.count) || (p.count as number) < 1 || (p.count as number) > MAX_LIST_COUNT) return null;
      out.push({ prompt: p.prompt, kind, count: p.count as number });
    } else if (kind === "choice") {
      const o = p.options;
      if (!Array.isArray(o) || o.length === 0 || o.length > MAX_OPTIONS || !o.every((x) => text(x, true, MAX_OPTION))) return null;
      if (new Set(o).size !== o.length) return null;
      out.push({ prompt: p.prompt, kind, options: o as string[] });
    } else {
      out.push({ prompt: p.prompt, kind });
    }
  }
  return out;
}

/** Whether one part's answer is there in full (a list: every line). */
export function partFilled(part: CardPart, value: PartValue | undefined): boolean {
  switch (part.kind) {
    case "text":
      return typeof value === "string" && value.trim() !== "";
    case "list":
      return Array.isArray(value) && value.length === part.count && value.every((x) => x.trim() !== "");
    case "rating":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10;
    case "choice":
      return typeof value === "string" && (part.options ?? []).includes(value);
  }
}

/** The empty answer for a part. */
export const emptyPart = (part: CardPart): PartValue => (part.kind === "text" ? "" : part.kind === "list" ? Array(part.count).fill("") : null);

/** The fields every version shares; null if any is wrong. */
function checkBody(v: Record<string, unknown>) {
  const { theme, learn, session, book, skill } = v;
  const tryText = v.try;
  if (!text(theme, true) || !text(learn, true) || !text(tryText, true)) return null;
  if (!text(book, false) || !text(skill, false) || typeof session !== "boolean") return null;
  return { theme, learn, try: tryText, book, skill, session };
}

/** One version 1 card, keeping only the card's own fields; null if any is wrong. */
function checkV1Card(v: unknown): ExerciseCard | null {
  if (!isObj(v) || !validDay(v.day)) return null;
  const body = checkBody(v);
  if (!body) return null;
  return {
    id: legacyCardId(v.day), day: v.day, chapter: null, chapterTitle: "", optional: false, ...body,
    more: "", sources: [], parts: [], example: "", bookExample: false, legacy: true,
  };
}

/** One version 2 card, keeping only the card's own fields; null if any is wrong. */
function checkV2Card(v: unknown): ExerciseCard | null {
  if (!isObj(v) || !validId(v.id) || typeof v.optional !== "boolean") return null;
  const day = v.day;
  if (v.optional ? !(day === null || validDay(day)) : !validDay(day)) return null;
  if (!validChapter(v.chapter) || !text(v.chapterTitle, false)) return null;
  if (v.more !== undefined && !text(v.more, false, MAX_MORE)) return null;
  const sources = checkSources(v.sources);
  const parts = checkParts(v.parts);
  if (v.example !== undefined && !text(v.example, false, MAX_EXAMPLE)) return null;
  if (v.bookExample !== undefined && typeof v.bookExample !== "boolean") return null;
  const body = checkBody(v);
  if (!sources || !parts || !body) return null;
  return {
    id: v.id, day: day as number | null, chapter: v.chapter, chapterTitle: v.chapterTitle, optional: v.optional, ...body,
    more: (v.more as string | undefined) ?? "", sources, parts, example: (v.example as string | undefined) ?? "",
    bookExample: v.bookExample === true, legacy: false,
  };
}

function checkCards(v: unknown, version: 1 | 2): ExerciseCard[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_CARD_DAY) return null;
  const out: ExerciseCard[] = [];
  const ids = new Set<string>();
  const days = new Set<number>();
  for (const c of v) {
    const card = version === 1 ? checkV1Card(c) : checkV2Card(c);
    if (!card || ids.has(card.id)) return null;
    ids.add(card.id);
    if (!card.optional) {
      if (days.has(card.day!)) return null;
      days.add(card.day!);
    }
    out.push(card);
  }
  if (days.size === 0) return null; // nothing to do day by day
  return [...out.filter((c) => c.optional), ...out.filter((c) => !c.optional).sort((a, b) => a.day! - b.day!)];
}

/** The import file (`{ app, kind, version: 1 | 2, source, cards }`), checked strictly; null if not. */
export function checkCardFile(v: unknown): CardSet | null {
  if (!isObj(v) || v.app !== "esmeworld" || v.kind !== "exercise-cards") return null;
  if (v.version !== 1 && v.version !== 2) return null;
  if (!text(v.source, false)) return null;
  const cards = checkCards(v.cards, v.version);
  return cards ? { source: v.source, version: v.version, cards } : null;
}

/** A chosen file's text as a card set, or null. */
export function parseCardFile(raw: string): CardSet | null {
  try {
    return checkCardFile(JSON.parse(raw));
  } catch {
    return null;
  }
}

const V1_KEYS = ["day", "theme", "learn", "try", "book", "skill", "session"];
const V2_KEYS = ["id", "day", "chapter", "chapterTitle", "optional", ...V1_KEYS.slice(1)];

/** The cards as stored (sealed): each version's own file shape, nothing else. */
export function storedCards(set: CardSet): Record<string, unknown>[] {
  return set.cards.map((c) => {
    if (set.version === 1) return { day: c.day, theme: c.theme, learn: c.learn, try: c.try, book: c.book, skill: c.skill, session: c.session };
    return {
      id: c.id, day: c.day, chapter: c.chapter, chapterTitle: c.chapterTitle, optional: c.optional, theme: c.theme,
      learn: c.learn, try: c.try, book: c.book, skill: c.skill, session: c.session,
      ...(c.more ? { more: c.more } : {}), ...(c.sources.length ? { sources: c.sources } : {}),
      ...(c.parts.length ? { parts: c.parts } : {}), ...(c.example ? { example: c.example } : {}),
      ...(c.bookExample ? { bookExample: true } : {}),
    };
  });
}

/**
 * A stored card set (after opening the sealed row), back as a set; null unless it is exactly
 * the shape this version writes (no field it doesn't know).
 */
export function readStoredSet(version: unknown, source: unknown, cards: unknown): CardSet | null {
  if ((version !== 1 && version !== 2) || !Array.isArray(cards)) return null;
  const known = version === 1 ? V1_KEYS : [...V2_KEYS, "more", "sources", "parts", "example", "bookExample"];
  const exact = cards.every(
    (c) => isObj(c) && Object.keys(c).every((k) => known.includes(k)) && (version === 1 ? V1_KEYS : V2_KEYS).every((k) => k in c),
  );
  if (!exact) return null;
  return checkCardFile({ app: "esmeworld", kind: "exercise-cards", version, source, cards });
}

/** "Chapter 1 · BPD 101" (or what there is of it); "" with no chapter. */
export function chapterLine(card: ExerciseCard): string {
  const parts: string[] = [];
  if (card.chapter !== null) parts.push(`Chapter ${card.chapter}`);
  if (card.chapterTitle.trim()) parts.push(card.chapterTitle);
  return parts.join(" · ");
}

/** "Read more" as paragraphs (split on blank lines). */
export function moreParagraphs(more: string): string[] {
  return more
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

// ---- which card is today's -----------------------------------------------------------------

/**
 * One card's mark on one device for one day. `primary`: the device's card for the day (shown,
 * then perhaps done); otherwise a further card done that day ("Do the next one").
 */
export interface ExerciseMark {
  date: ISODate;
  device: string;
  id: string;
  done: boolean;
  primary: boolean;
}

export interface ExercisePlan {
  /** 1, then 2 once every card has been done, and so on. */
  round: number;
  /** Today's card, and whether it is done today. */
  today: { card: SequenceCard; done: boolean };
  /** Whether this device should record today's card as shown (no card for today yet). */
  record: boolean;
  /** The card after today's (tomorrow's if nothing changes). */
  next: SequenceCard;
  /** Cards not yet done, in order, after today's ("Do the next one" takes them in turn). */
  queue: SequenceCard[];
  /** Cards done this round (today's included). */
  doneThisRound: ReadonlySet<string>;
  /** Every card done today (today's card and any further ones). */
  doneToday: ReadonlySet<string>;
}

/** The daily sequence: the cards that aren't optional, by day. */
export const sequence = (cards: ExerciseCard[]): SequenceCard[] =>
  cards.filter((c): c is SequenceCard => !c.optional && c.day !== null).sort((a, b) => a.day - b.day);

/** A round's order: round 1 by day; later rounds starred cards first, then the rest. */
function order(cards: SequenceCard[], round: number, starred: ReadonlySet<string>): SequenceCard[] {
  if (round === 1) return cards;
  return [...cards.filter((c) => starred.has(c.id)), ...cards.filter((c) => !starred.has(c.id))];
}

/** Adds a done card to a round; a full round starts the next one. */
function advance(state: { round: number; done: Set<string> }, id: string, total: number) {
  if (state.done.has(id)) return;
  state.done.add(id);
  if (state.done.size === total) {
    state.round++;
    state.done = new Set();
  }
}

/** Today's card, the round, and what comes next, from every device's marks. */
export function planExercise(
  cards: ExerciseCard[],
  marks: ExerciseMark[],
  starred: ReadonlySet<string>,
  today: ISODate,
  deviceId: string,
): ExercisePlan {
  const seq = sequence(cards);
  const rank = new Map(seq.map((c, i) => [c.id, i]));
  const byId = new Map(seq.map((c) => [c.id, c]));
  const known = marks.filter((m) => byId.has(m.id));
  const bySeq = (a: { id: string }, b: { id: string }) => rank.get(a.id)! - rank.get(b.id)!;

  // Every earlier day's done cards, oldest first, walked into rounds.
  const earlier = new Map<string, { date: ISODate; id: string }>();
  for (const m of known) if (m.done && m.date < today) earlier.set(`${m.date}|${m.id}`, m);
  const state = { round: 1, done: new Set<string>() };
  for (const m of [...earlier.values()].sort((a, b) => a.date.localeCompare(b.date) || bySeq(a, b))) {
    advance(state, m.id, seq.length);
  }
  const firstUndone = () => order(seq, state.round, starred).find((c) => !state.done.has(c.id)) ?? seq[0]!;

  const todays = known.filter((m) => m.date === today);
  const primaries = todays.filter((m) => m.primary).sort(bySeq);
  const ticked = primaries.find((m) => m.done);
  const shown = ticked ?? primaries.find((m) => m.device === deviceId) ?? primaries[0];
  const card = shown ? byId.get(shown.id)! : firstUndone();
  const doneToday = new Set(todays.filter((m) => m.done).map((m) => m.id));

  const after = { round: state.round, done: new Set(state.done) };
  advance(after, card.id, seq.length);
  for (const c of seq) if (doneToday.has(c.id) && c.id !== card.id) advance(after, c.id, seq.length);
  const queue = order(seq, after.round, starred).filter((c) => !after.done.has(c.id) && c.id !== card.id);
  return {
    round: state.round,
    today: { card, done: doneToday.has(card.id) },
    record: primaries.length === 0,
    next: queue[0] ?? card,
    queue,
    doneThisRound: new Set([...state.done, ...doneToday]),
    doneToday,
  };
}

/** "Do the next one": the first card in the queue not already opened in this sitting. */
export function upNext(plan: ExercisePlan, opened: ReadonlySet<string>): SequenceCard | null {
  return plan.queue.find((c) => !opened.has(c.id)) ?? null;
}

/**
 * Whether replacing the cards with `next` loses progress: some card already done is not in
 * the new set (by id). Then she is told it restarts.
 */
export function replacingRestarts(marks: readonly ExerciseMark[], next: CardSet): boolean {
  const ids = new Set(next.cards.map((c) => c.id));
  return marks.some((m) => m.done && !ids.has(m.id));
}

// ---- stars ---------------------------------------------------------------------------------

/** One star mark in a device's stars row. */
export interface StarMark {
  id: string;
  on: boolean;
  at: number;
}

/** The starred cards: for each card, the newest mark from any device. */
export function mergeStars(devices: StarMark[][]): Set<string> {
  const newest = new Map<string, StarMark>();
  for (const marks of devices) {
    for (const m of marks) {
      const prev = newest.get(m.id);
      if (!prev || m.at > prev.at) newest.set(m.id, m);
    }
  }
  return new Set([...newest.values()].filter((m) => m.on).map((m) => m.id));
}
