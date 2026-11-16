// Highlights (Esme, 2026-11-06): "highlight/bookmark certain sentences/phrases in the learning
// portion of mental health exercises … like on Kindle and then view 'highlights' somewhere".
// Only the card's own learning text can be highlighted (Learn, Try this, the book and skill
// lines, Read more), never her answers.
//
// A highlight is anchored like the W3C TextQuoteSelector: the exact words, a little of the text
// before and after them, and their offsets as a hint. The card text it is found in is the text as
// it shows (the file's *emphasis* marks left out). When the card's text shifts (a re-imported
// card file), it is found again by its words and context; when its words aren't in the card any
// more, it is NOT guessed at: Read back still shows it, with its words, saying so.
//
// This module is pure (no storage, no DOM); the sealed rows are data/highlightRepo.ts.

import { isObj, isStr } from "../data/validate";
import { MAX_CARD_FIELD, MAX_CARD_ID, MAX_MORE, moreParagraphs, type ExerciseCard } from "./exercise";

/** The parts of a card that can be highlighted, as `CardBody` and `ReadMore` show them. */
export const HIGHLIGHT_FIELDS = ["learn", "try", "book", "skill", "more"] as const;
export type HighlightField = (typeof HIGHLIGHT_FIELDS)[number];

/** How much text before and after the words is kept, to find them again. */
export const CONTEXT_CHARS = 32;
/** The longest note on a highlight (her choice: "an optional short note"). */
export const MAX_HIGHLIGHT_NOTE = 2000;

/** Where a highlight is: the W3C TextQuoteSelector's three texts, and offsets as a hint. */
export interface TextAnchor {
  /** The part of the card it was made in (a hint: it is looked for in every part). */
  field: HighlightField;
  exact: string;
  prefix: string;
  suffix: string;
  /** In the field's shown text when it was made (a hint). */
  start: number;
  end: number;
}

/** The card a highlight is on, kept with it so it reads back even if the card is gone. */
export interface HighlightCard {
  id: string;
  track: string;
  /** The card's book (track) title then ("" for a set without titles). */
  book: string;
  day: number | null;
  chapter: number | null;
  chapterTitle: string;
  theme: string;
}

/**
 * One version of one highlight, sealed (data/highlightRepo.ts). Like a note to herself: each
 * save is a new version naming the versions it was written over (`seen`); removing it is a
 * version with `deleted`, never a hard delete.
 */
export interface HighlightEntry {
  v: 1;
  card: HighlightCard;
  anchor: TextAnchor;
  note: string;
  createdAt: number;
  at: number;
  vid: string;
  seen: string[];
  deleted?: true;
}

// ---- the text as it shows ------------------------------------------------------------------

/** A text's pieces as PromptText shows them: `*emphasis*` shown as emphasis, its stars left out. */
export function plainSegments(text: string, emphasis = true): { text: string; em: boolean }[] {
  if (!emphasis) return text ? [{ text, em: false }] : [];
  return text
    .split(/(\*[^*]+\*)/g)
    .filter(Boolean)
    .map((p) => (p.startsWith("*") && p.endsWith("*") && p.length > 2 ? { text: p.slice(1, -1), em: true } : { text: p, em: false }));
}

/** A text as it shows (no emphasis stars). */
export const plainText = (text: string): string => plainSegments(text).map((s) => s.text).join("");

/** The blank line between Read more's paragraphs in its shown text. */
export const MORE_GAP = "\n\n";

/** Each part of a card that can be highlighted, as its shown text. */
export function cardFieldTexts(card: Pick<ExerciseCard, "learn" | "try" | "book" | "skill" | "more">): Record<HighlightField, string> {
  return {
    learn: plainText(card.learn),
    try: plainText(card.try),
    book: plainText(card.book),
    // The skill line shows as it is (no PromptText).
    skill: card.skill,
    more: moreParagraphs(card.more).map(plainText).join(MORE_GAP),
  };
}

/** Where each Read more paragraph starts in the field's shown text. */
export function moreOffsets(more: string): { text: string; base: number }[] {
  let base = 0;
  return moreParagraphs(more).map((p) => {
    const out = { text: p, base };
    base += plainText(p).length + MORE_GAP.length;
    return out;
  });
}

// ---- making and finding an anchor ---------------------------------------------------------

/** A highlight of `text` from `start` to `end` (spaces at either end left out); null if nothing but spaces. */
export function describeAnchor(field: HighlightField, text: string, start: number, end: number): TextAnchor | null {
  let s = Math.max(0, Math.min(start, end));
  let e = Math.min(text.length, Math.max(start, end));
  while (s < e && /\s/.test(text[s]!)) s++;
  while (e > s && /\s/.test(text[e - 1]!)) e--;
  if (e <= s) return null;
  return {
    field, exact: text.slice(s, e), start: s, end: e,
    prefix: text.slice(Math.max(0, s - CONTEXT_CHARS), s), suffix: text.slice(e, e + CONTEXT_CHARS),
  };
}

function sharedEnd(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function sharedStart(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** A text with every run of whitespace as one space, and where each of its characters came from. */
function squeezed(text: string): { text: string; from: number[] } {
  let out = "";
  const from: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      if (out.endsWith(" ")) continue;
      out += " ";
    } else out += ch;
    from.push(i);
  }
  return { text: out, from };
}
const squeeze = (s: string) => s.replace(/\s+/g, " ");

export interface Located {
  field: HighlightField;
  start: number;
  end: number;
}

/**
 * How well one place's surroundings agree with the context kept with a highlight. A side
 * agrees in full when the kept text is there right beside the words, and (when fewer than
 * CONTEXT_CHARS were kept because the words were near the start or end of their part) the part
 * starts or ends there too.
 */
function contextAgrees(prefix: string, suffix: string, before: string, after: string): { score: number; ok: boolean } {
  const pre = sharedEnd(prefix, before);
  const suf = sharedStart(suffix, after);
  const fullPre = pre === prefix.length && (prefix.length >= CONTEXT_CHARS || before.length === prefix.length);
  const fullSuf = suf === suffix.length && (suffix.length >= CONTEXT_CHARS || after.length === suffix.length);
  const kept = prefix.length + suffix.length;
  // Half of the kept context, or one whole side: anything less is the same words somewhere else.
  return { score: pre + suf, ok: fullPre || fullSuf || (kept > 0 && (pre + suf) * 2 >= kept) };
}

/**
 * Where a highlight is in the card's text now (`texts`: each part's shown text), or null when it
 * can't be found for sure (review I1: never a guess). Every place with the exact words counts
 * only if the text around it agrees with the kept context (`contextAgrees`); of those, the best
 * agreeing wins (then its own part, then nearest the old offset). Only if no exact place agrees
 * are the words looked for with their spaces and line breaks loosened, by the same rule.
 */
export function locateAnchor(a: TextAnchor, texts: Partial<Record<HighlightField, string>>): Located | null {
  if (a.exact === "") return null;
  const fields = [a.field, ...HIGHLIGHT_FIELDS.filter((f) => f !== a.field)];
  type Hit = Located & { score: number };
  const best = (hits: Hit[]) =>
    hits.sort((x, y) => y.score - x.score || Number(y.field === a.field) - Number(x.field === a.field) || Math.abs(x.start - a.start) - Math.abs(y.start - a.start))[0] ?? null;

  const exact: Hit[] = [];
  for (const field of fields) {
    const t = texts[field];
    if (!t) continue;
    for (let i = t.indexOf(a.exact); i >= 0; i = t.indexOf(a.exact, i + 1)) {
      const end = i + a.exact.length;
      const c = contextAgrees(a.prefix, a.suffix, t.slice(0, i), t.slice(end));
      if (c.ok) exact.push({ field, start: i, end, score: c.score });
    }
  }
  const hit = best(exact);
  if (hit) return { field: hit.field, start: hit.start, end: hit.end };

  // The same words with their spaces and line breaks changed.
  const want = squeeze(a.exact);
  const before = squeeze(a.prefix);
  const after = squeeze(a.suffix);
  const loose: Hit[] = [];
  for (const field of fields) {
    const t = texts[field];
    if (!t) continue;
    const sq = squeezed(t);
    for (let i = sq.text.indexOf(want); i >= 0; i = sq.text.indexOf(want, i + 1)) {
      const j = i + want.length;
      const c = contextAgrees(before, after, sq.text.slice(0, i), sq.text.slice(j));
      if (c.ok) loose.push({ field, start: sq.from[i]!, end: sq.from[j - 1]! + 1, score: c.score });
    }
  }
  const near = best(loose);
  return near && { field: near.field, start: near.start, end: near.end };
}

/**
 * The card a highlight is on now, and where its words are on it (null: not found for sure). By
 * its card id; if that card is gone (or its words aren't on it), a card of the same book and day
 * that has them, as after a re-import that renamed the ids (review M4), by the same context rule.
 */
export function resolveCard<C extends Pick<ExerciseCard, "id" | "track" | "day" | "learn" | "try" | "book" | "skill" | "more">>(
  hc: Pick<HighlightCard, "id" | "track" | "day">, anchor: TextAnchor, cards: readonly C[],
): { card: C | null; at: Located | null } {
  const own = cards.find((c) => c.id === hc.id) ?? null;
  const at = own ? locateAnchor(anchor, cardFieldTexts(own)) : null;
  if (at) return { card: own, at };
  if (hc.day !== null) {
    for (const c of cards) {
      if (c === own || c.track !== hc.track || c.day !== hc.day) continue;
      const there = locateAnchor(anchor, cardFieldTexts(c));
      if (there) return { card: c, at: there };
    }
  }
  return { card: own, at: null };
}

// ---- showing the marks -------------------------------------------------------------------

/** One run of shown text: where it starts in its field, its words, and the highlights over it. */
export interface MarkRun {
  at: number;
  text: string;
  em: boolean;
  /** The highlights covering it (in the order given). */
  keys: string[];
}

/**
 * A text (with *emphasis*) as runs, split at its emphasis and at every highlight's edges. `base`
 * is where the text starts in its field's shown text (a later Read more paragraph); `marks` are
 * in field offsets. `emphasis` false: a text shown as it is (the skill line).
 */
export function markRuns(
  raw: string, base: number, marks: readonly { start: number; end: number; key: string }[], emphasis = true,
): MarkRun[] {
  const runs: MarkRun[] = [];
  let at = base;
  for (const seg of plainSegments(raw, emphasis)) {
    const from = at;
    const to = at + seg.text.length;
    const cuts = new Set([from, to]);
    for (const m of marks) {
      if (m.start > from && m.start < to) cuts.add(m.start);
      if (m.end > from && m.end < to) cuts.add(m.end);
    }
    const edges = [...cuts].sort((x, y) => x - y);
    for (let k = 0; k + 1 < edges.length; k++) {
      const s = edges[k]!;
      const e = edges[k + 1]!;
      runs.push({ at: s, text: seg.text.slice(s - from, e - from), em: seg.em, keys: marks.filter((m) => m.start <= s && m.end >= e).map((m) => m.key) });
    }
    at = to;
  }
  return runs;
}

// ---- the sealed entry's shape ---------------------------------------------------------------

const str = (v: unknown, max: number): v is string => isStr(v) && v.length <= max;
const count = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1_000_000;
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const smallInt = (v: unknown) => v === null || (Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 1000);

function validAnchor(a: unknown): a is TextAnchor {
  return (
    isObj(a) && HIGHLIGHT_FIELDS.includes(a.field as HighlightField) &&
    str(a.exact, MAX_MORE) && a.exact !== "" && str(a.prefix, CONTEXT_CHARS * 2) && str(a.suffix, CONTEXT_CHARS * 2) &&
    count(a.start) && count(a.end) && (a.end as number) >= (a.start as number)
  );
}

function validCard(c: unknown): c is HighlightCard {
  return (
    isObj(c) && str(c.id, MAX_CARD_ID) && c.id !== "" && str(c.track, 200) && str(c.book, 200) &&
    smallInt(c.day) && smallInt(c.chapter) && str(c.chapterTitle, MAX_CARD_FIELD) && str(c.theme, MAX_CARD_FIELD)
  );
}

/** A highlight version, once opened, has this shape (else it counts as "can't open"). */
export function isHighlightEntry(v: unknown): v is HighlightEntry {
  return (
    isObj(v) && v.v === 1 && validCard(v.card) && validAnchor(v.anchor) && str(v.note, MAX_HIGHLIGHT_NOTE) &&
    num(v.createdAt) && num(v.at) && str(v.vid, 64) && v.vid !== "" &&
    Array.isArray(v.seen) && v.seen.length <= 64 && v.seen.every((x) => str(x, 64)) &&
    (v.deleted === undefined || v.deleted === true)
  );
}
