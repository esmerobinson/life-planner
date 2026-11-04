// ⌘K search (Esme's pick, option 3A): the pure part. Builds a small in-memory index of the
// to-dos, projects, ideas, books, goals and page notes the shell already holds, and answers a
// query with results grouped by type, each with the words to bold. Journal entries are
// searched separately (journalSearch.ts opens them, in memory only, never stored).

import { BOOK_STATUS_LABEL, isBook } from "../domain/books";
import { addDays } from "../domain/dates";
import { dayLabel, shortDate } from "../domain/display";
import { isProject } from "../domain/projects";
import type { Goal, ISODate, Item } from "../domain/types";
import { MORNING_LOCK_DAYS } from "../journal/entries";
import { AREA_CHOICES } from "../ui/areas";

/** The result groups, in the order they show. */
export const GROUPS = ["todos", "projects", "ideas", "books", "goals", "notes", "journal"] as const;
export type Group = (typeof GROUPS)[number];
export const GROUP_LABEL: Record<Group, string> = {
  todos: "To-dos",
  projects: "Projects",
  ideas: "Ideas",
  books: "Books",
  goals: "Goals",
  notes: "Notes",
  journal: "Journal",
};

/** How many results each group shows (the heading still counts them all). */
export const GROUP_CAP = 8;

/** What Enter (or a click) opens: an item's or goal's side panel, or a page. */
export type Open = { panel: string } | { path: string };

/** One result: its title, a second line (author, session or the words around the match) and a meta line. */
export interface Hit {
  id: string;
  title: string;
  sub?: string;
  meta: string;
  /** The area (for its tile), "inbox", or "journal". */
  tile: string;
  open: Open;
}

export interface ResultGroup {
  group: Group;
  total: number;
  hits: Hit[];
}

/** One searchable row, its texts lowercased once. */
interface Doc {
  id: string;
  group: Exclude<Group, "notes" | "journal">;
  /** "to-do" / "idea" / … for "Note on a to-do". */
  noun: string;
  title: string;
  /** Author or session titles: found like the title. */
  extra: string[];
  notes: string;
  meta: string;
  tile: string;
  areaLabel: string;
  lowTitle: string;
  lowExtra: string[];
  lowNotes: string;
}

const areaName = (id: string) => (id === "inbox" ? "Inbox" : (AREA_CHOICES.find((a) => a.id === id)?.label ?? id));

/** Apostrophes and quote marks a phone keyboard (or a pasted text) may use for ' and ". */
const APOSTROPHES = new Set(["\u2018", "\u2019", "\u201A", "\u201B", "\u02BC", "\u2032", "\uFF07"]);
const QUOTES = new Set(["\u201C", "\u201D", "\u201E", "\u201F", "\u2033", "\uFF02"]);
const folded = new Map<string, string>();

/**
 * Text as search compares it: lowercased, without accents, curly apostrophes and quotes as
 * straight ones ("Café" and "cafe", "Mum’s" and "mum's" match). One character in, one out
 * (so a match can be bolded in the original text), except a lone accent mark, which goes.
 */
export function fold(text: string): string {
  if (/^[\x00-\x7f]*$/.test(text)) return text.toLowerCase();
  let out = "";
  for (const ch of text) {
    let f = folded.get(ch);
    if (f === undefined) {
      if (APOSTROPHES.has(ch)) f = "'";
      else if (QUOTES.has(ch)) f = '"';
      else {
        f = ch.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
        // A letter that only changes length when lowercased: just lowercased (never two letters for one).
        if (f.length > ch.length) f = ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch;
      }
      folded.set(ch, f);
    }
    out += f;
  }
  return out;
}

/** Query words: folded (see fold), split on spaces, each once. */
export function queryWords(q: string): string[] {
  return [...new Set(fold(q).split(/\s+/).filter(Boolean))];
}

/** A page's text as plain words: no picture markup, heading or checklist marks. */
export function plainNotes(notes: string): string {
  return notes
    .split("\n")
    .map((l) =>
      l
        .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
        .replace(/^\s*#{1,6}\s+/, "")
        .replace(/^\s*[-*]\s+\[[ xX]\]\s+/, "")
        .replace(/^\s*[-*]\s+/, "")
        .trim(),
    )
    .filter(Boolean)
    .join(" · ");
}

function itemDoc(it: Item, today: ISODate): Doc {
  const area = areaName(it.areaId);
  const done = it.status === "done" ? " · Done" : "";
  let group: Doc["group"];
  let noun: string;
  let meta: string;
  let extra: string[] = [];
  if (isBook(it)) {
    group = "books";
    noun = "book";
    const status = BOOK_STATUS_LABEL[it.bookStatus!];
    meta = `Book · ${status}${it.bookStatus === "read" && it.finishedOn ? ` · finished ${dayLabel(it.finishedOn, today)}` : ""}`;
    extra = it.author ? [it.author] : [];
  } else if (isProject(it)) {
    group = "projects";
    noun = "project";
    meta = `Project · ${area}${it.due ? ` · Due ${dayLabel(it.due, today)}` : ""}${done}`;
    extra = (it.sessions ?? []).flatMap((s) => (s.title ? [`Session: ${s.title}`] : []));
  } else if (it.kind === "idea") {
    group = "ideas";
    noun = "idea";
    meta = `Idea · ${area}`;
  } else {
    group = "todos";
    noun = "to-do";
    // An Inbox item has no type until it is sorted: just "Inbox".
    meta = it.areaId === "inbox" ? "Inbox" : `To-do · ${area}${it.due ? ` · Due ${dayLabel(it.due, today)}` : ""}${done}`;
  }
  const notes = plainNotes(it.notes ?? "");
  return {
    id: it.id, group, noun, title: it.title, extra, notes, meta, tile: it.areaId, areaLabel: area,
    lowTitle: fold(it.title), lowExtra: extra.map(fold), lowNotes: fold(notes),
  };
}

function goalDoc(g: Goal, today: ISODate): Doc {
  const area = areaName(g.areaId);
  const notes = plainNotes(g.notes ?? "");
  return {
    id: g.id, group: "goals", noun: "goal", title: g.title, extra: [], notes, tile: g.areaId, areaLabel: area,
    meta: `Goal · ${area}${g.deadline ? ` · By ${shortDate(g.deadline, today)}` : ""}`,
    lowTitle: fold(g.title), lowExtra: [], lowNotes: fold(notes),
  };
}

/** The search index: built once per open (or when the lists change), then queried as she types. */
export function buildIndex(items: Item[], goals: Goal[], today: ISODate): Doc[] {
  return [
    ...items.filter((i) => i.status === "open" || i.status === "done").map((i) => itemDoc(i, today)),
    ...goals.filter((g) => g.status === undefined).map((g) => goalDoc(g, today)),
  ];
}

const allIn = (words: string[], texts: string[]) => words.every((w) => texts.some((t) => t.includes(w)));

/**
 * The results for `query`: a doc whose title (or author / session titles) holds every word is
 * in its type's group; one that needs its page notes for some word is in Notes. Within a group,
 * titles that start with the first word come first, then the rest as they were. Each group
 * keeps its first `cap` results (Infinity for "See all") and counts the rest; only the rows
 * kept get a second line cut for them.
 */
export function searchIndex(index: Doc[], query: string, cap = GROUP_CAP, capFor?: (g: Group) => number): ResultGroup[] {
  const words = queryWords(query);
  if (!words.length) return [];
  const found = new Map<Group, { d: Doc; rank: number; i: number }[]>();
  for (const d of index) {
    let group: Group;
    if (allIn(words, [d.lowTitle, ...d.lowExtra])) group = d.group;
    else if (d.lowNotes && allIn(words, [d.lowTitle, ...d.lowExtra, d.lowNotes])) group = "notes";
    else continue;
    const list = found.get(group) ?? [];
    list.push({ d, rank: d.lowTitle.startsWith(words[0]) ? 0 : 1, i: list.length });
    found.set(group, list);
  }
  return GROUPS.flatMap((g) => {
    const list = found.get(g);
    if (!list) return [];
    const kept = list.sort((a, b) => a.rank - b.rank || a.i - b.i).slice(0, capFor?.(g) ?? cap);
    return [{ group: g, total: list.length, hits: kept.map(({ d }) => toHit(d, g, words)) }];
  });
}

/** One kept result, with its second line: the author, the session that matched, or the words around a note match. */
function toHit(d: Doc, group: Group, words: string[]): Hit {
  let sub: string | undefined;
  if (group === "notes") sub = snippet(d.notes, words);
  else sub = d.group === "books" ? d.extra[0] : d.extra.find((_, i) => words.some((w) => d.lowExtra[i].includes(w)));
  const meta = group === "notes" ? `Note on a${d.noun === "idea" ? "n" : ""} ${d.noun} · ${d.areaLabel}` : d.meta;
  return { id: d.id, title: d.title, ...(sub ? { sub } : {}), meta, tile: d.tile, open: { panel: d.id } };
}

/** Text in bold and plain runs: every match of every word, overlaps merged. */
export function highlight(text: string, words: string[]): { text: string; bold: boolean }[] {
  const low = fold(text);
  // Folding can change the length (a lone accent mark); then nothing is bolded rather than the wrong letters.
  if (low.length !== text.length || !words.length) return [{ text, bold: false }];
  const marks = new Array<boolean>(text.length).fill(false);
  for (const w of words) {
    for (let at = low.indexOf(w); at !== -1 && w; at = low.indexOf(w, at + 1)) marks.fill(true, at, at + w.length);
  }
  const out: { text: string; bold: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = out[out.length - 1];
    if (last && last.bold === marks[i]) last.text += text[i];
    else out.push({ text: text[i], bold: marks[i] });
  }
  return out;
}

/** Up to about `radius` characters either side of the first match, cut at spaces, with "…" where cut. */
export function snippet(text: string, words: string[], radius = 40): string {
  const folded = fold(text);
  // Positions found in the folded text are only used when they line up with the original.
  const low = folded.length === text.length ? folded : text.toLowerCase();
  const at = Math.min(...words.map((w) => low.indexOf(w)).filter((i) => i >= 0));
  if (!Number.isFinite(at) || text.length <= radius * 2) return text.length <= radius * 2 ? text : `${text.slice(0, radius * 2)}…`;
  let start = Math.max(0, at - radius);
  let end = Math.min(text.length, at + radius);
  if (start > 0) {
    const space = text.indexOf(" ", start);
    if (space !== -1 && space < at) start = space + 1;
  }
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > at) end = space;
  }
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

// ---- journal -------------------------------------------------------------------------------

/** One opened journal entry, held in memory while search is open (never stored). */
export interface JournalDoc {
  id: string;
  kind: "checkin" | "exercise" | "morning";
  date: ISODate;
  title: string;
  /** Her words. */
  text: string;
  /** The question (check-in), shown for context; never searched. */
  context?: string;
}

const JOURNAL_PATH: Record<JournalDoc["kind"], string> = {
  checkin: "/journal/check-in",
  exercise: "/journal/exercise",
  morning: "/journal/read-back",
};

/**
 * Each entry's searchable text, lowercased once (review M-3). Held only as long as the entry
 * object itself (the search pop-up's memory): a WeakMap never keeps it alive.
 */
const lowered = new WeakMap<JournalDoc, string>();
function lowJournal(d: JournalDoc): string {
  let low = lowered.get(d);
  if (low === undefined) {
    low = fold(`${d.title}\n${d.text}`);
    lowered.set(d, low);
  }
  return low;
}

/** True when a morning page dated `date` is still locked on `today` (the 28 days). */
export const morningLocked = (date: ISODate, today: ISODate) => today < addDays(date, MORNING_LOCK_DAYS);

/**
 * Journal results, newest first. A morning page under MORNING_LOCK_DAYS old never shows, even
 * if one were handed in (the loader never opens them in the first place).
 */
export function searchJournal(docs: JournalDoc[], query: string, today: ISODate): Hit[] {
  const words = queryWords(query);
  if (!words.length) return [];
  return docs
    .filter((d) => !(d.kind === "morning" && morningLocked(d.date, today)))
    .filter((d) => allIn(words, [lowJournal(d)]))
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d) => ({
      id: d.id,
      title: d.title,
      sub: snippet(d.text.replace(/\s+/g, " "), words),
      meta: dayLabel(d.date, today),
      tile: "journal",
      open: { path: JOURNAL_PATH[d.kind] },
    }));
}
