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
export const PART_KINDS = ["text", "list", "rating", "choice", "table", "scale", "tracker", "chain"] as const;
export type PartKind = (typeof PART_KINDS)[number];

/**
 * One thing a card asks her to fill in: a text box, a numbered list of `count` lines, a 0–10
 * rating, one of `options`, a table (`columns` × `rows`), a scale (`min`..`max` with end
 * labels), a tracker (`days` days, each with its `fields`), or a chain of `steps`.
 */
export interface CardPart {
  prompt: string;
  kind: PartKind;
  /** Lines in a list (1..MAX_LIST_COUNT). */
  count?: number;
  /** A choice's options. */
  options?: string[];
  /** A table's column headings and its rows. */
  columns?: string[];
  rows?: number;
  /** A scale's ends and their labels. */
  min?: number;
  max?: number;
  minLabel?: string;
  maxLabel?: string;
  /** A tracker's days and each day's fields. */
  days?: number;
  fields?: string[];
  /** A chain's steps, in order. */
  steps?: string[];
}

/**
 * One part's answer: text → string; list and chain → their lines; rating and scale → a number
 * or null; choice → the option or null; table → rows of cells; tracker → days of fields.
 */
export type PartValue = string | string[] | string[][] | number | null;

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
  /** The exercise's format, shown as a small chip ("Table", "Scale", …); "" when none. */
  format: string;
  /** Its book (track) id; "" for a file without tracks. */
  track: string;
  /** From a version 1 file: its responses keep the earlier (day and theme) row key. */
  legacy: boolean;
}

/** A sequence card always has a day. */
export type SequenceCard = ExerciseCard & { day: number };

/** One book of cards (a "track"); its days are numbered on their own from 1. */
export interface CardTrack {
  id: string;
  title: string;
}

export interface CardSet {
  source: string;
  version: 1 | 2;
  /** The books, in order (the first is the default); one untitled track for a file without them. */
  tracks: CardTrack[];
  /** Optional cards first (in file order), then the sequence by track and day; ids, and days within a track, unique. */
  cards: ExerciseCard[];
}

/** A file without tracks has this one. */
export const NO_TRACKS: CardTrack[] = [{ id: "", title: "" }];

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
export const MAX_COLUMNS = 6;
export const MAX_COLUMN = 40;
export const MAX_TABLE_ROWS = 20;
export const MAX_SCALE_SPAN = 10;
export const MAX_TRACKER_DAYS = 14;
export const MAX_TRACKER_FIELDS = 4;
export const MAX_CHAIN_STEPS = 10;
export const MAX_FORMAT = 40;
/** The most tracks (books) in one file, the longest track id and title. */
export const MAX_TRACKS = 10;
export const MAX_TRACK_ID = 50;
export const MAX_TRACK_TITLE = 200;
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
    } else if (kind === "table") {
      const c = p.columns;
      if (!Array.isArray(c) || c.length === 0 || c.length > MAX_COLUMNS || !c.every((x) => text(x, true, MAX_COLUMN))) return null;
      if (!intIn(p.rows, 1, MAX_TABLE_ROWS)) return null;
      out.push({ prompt: p.prompt, kind, columns: c as string[], rows: p.rows as number });
    } else if (kind === "scale") {
      const { min, max } = p;
      if (!intIn(min, -1000, 1000) || !intIn(max, -1000, 1000) || max <= min || max - min > MAX_SCALE_SPAN) return null;
      if ((p.minLabel !== undefined && !text(p.minLabel, false, MAX_OPTION)) || (p.maxLabel !== undefined && !text(p.maxLabel, false, MAX_OPTION))) return null;
      out.push({ prompt: p.prompt, kind, min, max, minLabel: (p.minLabel as string | undefined) ?? "", maxLabel: (p.maxLabel as string | undefined) ?? "" });
    } else if (kind === "tracker") {
      const f = p.fields;
      if (!intIn(p.days, 1, MAX_TRACKER_DAYS)) return null;
      if (!Array.isArray(f) || f.length === 0 || f.length > MAX_TRACKER_FIELDS || !f.every((x) => text(x, true, MAX_OPTION))) return null;
      out.push({ prompt: p.prompt, kind, days: p.days as number, fields: f as string[] });
    } else if (kind === "chain") {
      const st = p.steps;
      if (!Array.isArray(st) || st.length === 0 || st.length > MAX_CHAIN_STEPS || !st.every((x) => text(x, true, MAX_OPTION))) return null;
      out.push({ prompt: p.prompt, kind, steps: st as string[] });
    } else {
      out.push({ prompt: p.prompt, kind });
    }
  }
  return out;
}

const intIn = (v: unknown, lo: number, hi: number): v is number => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const filledLine = (x: unknown) => typeof x === "string" && x.trim() !== "";
const filledRow = (r: unknown, n: number) => Array.isArray(r) && r.length === n && r.every(filledLine);

/** A table asks for every row, unless its prompt says "up to" (then the first row will do). */
export const tableUpTo = (prompt: string): boolean => /\bup to\b/i.test(prompt);

/** A tracker's days filled so far (every field of the day). */
export function trackerDaysFilled(part: CardPart, value: PartValue | undefined): number {
  if (!Array.isArray(value)) return 0;
  return (value as unknown[]).filter((d) => filledRow(d, part.fields?.length ?? 0)).length;
}

/** Whether one part's answer is there in full (a list: every line; a tracker: every day). */
export function partFilled(part: CardPart, value: PartValue | undefined): boolean {
  switch (part.kind) {
    case "table": {
      if (!Array.isArray(value) || value.length !== part.rows) return false;
      const cols = part.columns?.length ?? 0;
      const rows = value as unknown[];
      if (tableUpTo(part.prompt)) return filledRow(rows[0], cols) && rows.every((r) => Array.isArray(r) && (filledRow(r, cols) || r.every((x) => !filledLine(x))));
      return rows.every((r) => filledRow(r, cols));
    }
    case "scale":
      return typeof value === "number" && Number.isInteger(value) && value >= part.min! && value <= part.max!;
    case "tracker":
      return Array.isArray(value) && value.length === part.days && trackerDaysFilled(part, value) === part.days;
    case "chain":
      return Array.isArray(value) && value.length === part.steps?.length && value.every(filledLine);
    case "text":
      return typeof value === "string" && value.trim() !== "";
    case "list":
      return Array.isArray(value) && value.length === part.count && (value as unknown[]).every(filledLine);
    case "rating":
      return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10;
    case "choice":
      return typeof value === "string" && (part.options ?? []).includes(value);
  }
}

/** The empty answer for a part. */
export function emptyPart(part: CardPart): PartValue {
  const grid = (n: number, m: number) => Array.from({ length: n }, () => Array<string>(m).fill(""));
  switch (part.kind) {
    case "text":
      return "";
    case "list":
      return Array<string>(part.count!).fill("");
    case "chain":
      return Array<string>(part.steps!.length).fill("");
    case "table":
      return grid(part.rows!, part.columns!.length);
    case "tracker":
      return grid(part.days!, part.fields!.length);
    default:
      return null;
  }
}

/** A card with a tracker is done only once every day is filled; until then it is "in progress". */
export const hasTracker = (card: { parts: CardPart[] }): boolean => card.parts.some((p) => p.kind === "tracker");

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
    more: "", sources: [], parts: [], example: "", bookExample: false, format: "", track: "", legacy: true,
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
  if (v.format !== undefined && !text(v.format, false, MAX_FORMAT)) return null;
  if (v.track !== undefined && !validTrackId(v.track)) return null;
  const body = checkBody(v);
  if (!sources || !parts || !body) return null;
  return {
    id: v.id, day: day as number | null, chapter: v.chapter, chapterTitle: v.chapterTitle, optional: v.optional, ...body,
    more: (v.more as string | undefined) ?? "", sources, parts, example: (v.example as string | undefined) ?? "",
    bookExample: v.bookExample === true, format: (v.format as string | undefined) ?? "", track: (v.track as string | undefined) ?? "",
    legacy: false,
  };
}

const validTrackId = (v: unknown): v is string => isStr(v) && v.trim() !== "" && v.length <= MAX_TRACK_ID;

/** The file's `tracks` (optional): ids unique; null if wrong. */
function checkTracks(v: unknown): CardTrack[] | null | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_TRACKS) return null;
  const out: CardTrack[] = [];
  for (const t of v) {
    if (!isObj(t) || !validTrackId(t.id) || !text(t.title, false, MAX_TRACK_TITLE) || out.some((o) => o.id === t.id)) return null;
    out.push({ id: t.id, title: t.title });
  }
  return out;
}

/**
 * The cards, checked, each on its track (a card without one is on the first), optional ones
 * first, then by track and day. Without a `tracks` list the tracks are the ones the cards
 * name, in order of first appearance (untitled).
 */
function checkCards(v: unknown, version: 1 | 2, declared: CardTrack[] | undefined): { cards: ExerciseCard[]; tracks: CardTrack[] } | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > MAX_CARD_DAY) return null;
  const out: ExerciseCard[] = [];
  const ids = new Set<string>();
  for (const c of v) {
    const card = version === 1 ? checkV1Card(c) : checkV2Card(c);
    if (!card || ids.has(card.id)) return null;
    ids.add(card.id);
    out.push(card);
  }
  let tracks = declared;
  if (!tracks) {
    const named = [...new Set(out.map((c) => c.track).filter((t) => t !== ""))];
    tracks = named.length ? named.map((id) => ({ id, title: "" })) : NO_TRACKS;
  }
  const order = new Map(tracks.map((t, i) => [t.id, i]));
  const days = new Set<string>();
  for (const card of out) {
    if (card.track === "") card.track = tracks[0]!.id; // missing = the first track
    if (!order.has(card.track)) return null;
    if (card.optional) continue;
    const key = `${card.track}|${card.day}`;
    if (days.has(key)) return null;
    days.add(key);
  }
  if (days.size === 0) return null; // nothing to do day by day
  const seq = out.filter((c) => !c.optional).sort((a, b) => order.get(a.track)! - order.get(b.track)! || a.day! - b.day!);
  return { cards: [...out.filter((c) => c.optional), ...seq], tracks };
}

/** The import file (`{ app, kind, version: 1 | 2, source, tracks?, cards }`), checked strictly; null if not. */
export function checkCardFile(v: unknown): CardSet | null {
  if (!isObj(v) || v.app !== "esmeworld" || v.kind !== "exercise-cards") return null;
  if (v.version !== 1 && v.version !== 2) return null;
  if (!text(v.source, false)) return null;
  const declared = v.version === 2 ? checkTracks(v.tracks) : undefined;
  if (declared === null) return null;
  const checked = checkCards(v.cards, v.version, declared);
  return checked ? { source: v.source, version: v.version, tracks: checked.tracks, cards: checked.cards } : null;
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
      ...(c.bookExample ? { bookExample: true } : {}), ...(c.format ? { format: c.format } : {}),
      ...(c.track ? { track: c.track } : {}),
    };
  });
}

/** The tracks as stored: only a file's own list (none for one untitled track). */
export const storedTracks = (set: CardSet): CardTrack[] | undefined =>
  set.tracks.length === 1 && set.tracks[0]!.id === "" ? undefined : set.tracks;

/**
 * A stored card set (after opening the sealed row), back as a set; null unless it is exactly
 * the shape this version writes (no field it doesn't know).
 */
export function readStoredSet(version: unknown, source: unknown, cards: unknown, tracks?: unknown): CardSet | null {
  if ((version !== 1 && version !== 2) || !Array.isArray(cards)) return null;
  if (version === 1 && tracks !== undefined) return null;
  const known = version === 1 ? V1_KEYS : [...V2_KEYS, "more", "sources", "parts", "example", "bookExample", "format", "track"];
  const exact = cards.every(
    (c) => isObj(c) && Object.keys(c).every((k) => known.includes(k)) && (version === 1 ? V1_KEYS : V2_KEYS).every((k) => k in c),
  );
  if (!exact) return null;
  return checkCardFile({ app: "esmeworld", kind: "exercise-cards", version, source, cards, ...(tracks === undefined ? {} : { tracks }) });
}

/** A card's book title, when the set has titled books ("" otherwise). */
export const trackTitle = (set: CardSet, card: ExerciseCard): string => set.tracks.find((t) => t.id === card.track)?.title ?? "";

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
 * then perhaps done); otherwise a further card done that day ("Do the next one"). `logged`: a
 * tracker card's day was filled in (it counts for the day, but the card isn't done yet).
 */
export interface ExerciseMark {
  date: ISODate;
  device: string;
  id: string;
  done: boolean;
  primary: boolean;
  logged?: boolean;
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
  /** Tracker cards started but not finished (they come back as today's card). */
  inProgress: ReadonlySet<string>;
}

/** The daily sequence: the cards that aren't optional, by track, then day (as the set keeps them). */
export const sequence = (cards: ExerciseCard[]): SequenceCard[] => {
  const seq = cards.filter((c): c is SequenceCard => !c.optional && c.day !== null);
  const tracks = [...new Set(seq.map((c) => c.track))];
  return seq.sort((a, b) => tracks.indexOf(a.track) - tracks.indexOf(b.track) || a.day - b.day);
};

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

/**
 * The next card, taking the books in turn (Journal v2, two books): after a card from one book,
 * the lowest card not yet done of the next book that still has one (round-robin; a finished
 * book is skipped). `last` is the book of the last card done (null: start with the first).
 */
function pick(
  seq: SequenceCard[],
  round: number,
  starred: ReadonlySet<string>,
  done: ReadonlySet<string>,
  last: string | null,
  exclude: ReadonlySet<string> = new Set(),
): SequenceCard | null {
  const tracks = [...new Set(seq.map((c) => c.track))];
  const start = last === null ? 0 : (tracks.indexOf(last) + 1) % tracks.length;
  for (let k = 0; k < tracks.length; k++) {
    const t = tracks[(start + k) % tracks.length];
    const c = order(seq.filter((x) => x.track === t), round, starred).find((x) => !done.has(x.id) && !exclude.has(x.id));
    if (c) return c;
  }
  return null;
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

  // Every earlier day's done cards, oldest first (in the order they were marked within a day),
  // walked into rounds; the book of the last one sets whose turn it is.
  const earlier = new Map<string, { date: ISODate; id: string }>();
  for (const m of known) if (m.done && m.date < today) earlier.set(`${m.date}|${m.id}`, m);
  const state = { round: 1, done: new Set<string>() };
  let last: string | null = null;
  for (const m of [...earlier.values()].sort((a, b) => a.date.localeCompare(b.date))) {
    advance(state, m.id, seq.length);
    last = byId.get(m.id)!.track;
  }

  const todays = known.filter((m) => m.date === today);
  const doneToday = new Set(todays.filter((m) => m.done).map((m) => m.id));
  // A tracker card logged since it was last done (and not done today) comes back as today's card.
  const lastDone = new Map<string, ISODate>();
  for (const m of known) if (m.done && (lastDone.get(m.id) ?? "") < m.date) lastDone.set(m.id, m.date);
  const inProgress = new Set(
    known.filter((m) => m.logged && m.date <= today && !doneToday.has(m.id) && m.date > (lastDone.get(m.id) ?? "")).map((m) => m.id),
  );
  const primaries = todays.filter((m) => m.primary).sort(bySeq);
  const ticked = primaries.find((m) => m.done);
  const shown = ticked ?? primaries.find((m) => m.device === deviceId) ?? primaries[0];
  const resumed = [...inProgress].sort((a, b) => rank.get(a)! - rank.get(b)!)[0];
  const card = shown ? byId.get(shown.id)! : resumed ? byId.get(resumed)! : (pick(seq, state.round, starred, state.done, last) ?? seq[0]!);

  // What follows today's card: the turn passes on from the last card done today.
  const after = { round: state.round, done: new Set(state.done) };
  advance(after, card.id, seq.length);
  let turn = card.track;
  for (const m of todays) {
    if (!m.done || m.id === card.id) continue;
    advance(after, m.id, seq.length);
    turn = byId.get(m.id)!.track;
  }
  const queue: SequenceCard[] = [];
  const taken = new Set([card.id]);
  for (let c = pick(seq, after.round, starred, after.done, turn, taken); c; c = pick(seq, after.round, starred, after.done, turn, taken)) {
    queue.push(c);
    taken.add(c.id);
    turn = c.track;
  }
  return {
    round: state.round,
    today: { card, done: doneToday.has(card.id) },
    record: primaries.length === 0,
    next: queue[0] ?? card,
    queue,
    doneThisRound: new Set([...state.done, ...doneToday]),
    doneToday,
    inProgress,
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
