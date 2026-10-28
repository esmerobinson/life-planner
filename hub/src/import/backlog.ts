import { db } from "../data/db";
import { keepOwnStamps } from "../data/changeTracking";
import { isValidISODate } from "../domain/dates";
import { sectionToArea } from "./sectionAreas";
import { cleanTitle, normaliseTitle, unwikilink } from "./titleClean";
import { WEEKDAYS, type ISODate, type Item, type Priority, type Weekday } from "../domain/types";

export interface ParsedItem {
  title: string;
  priority: Priority;
  due?: ISODate;
  recur?: Weekday[];
  tags: string[];
  inbox: boolean;
  /** Raw `## ` heading text, trimmed. */
  section: string;
  key: string;
  /** Lines worth keeping from old-engine title suffixes ("Was due 19 Jul"), joined with newlines. */
  notes?: string;
}

// Regexes ported from src/backlog.py.
const TASK_RE = /^- \[( |x|>)\](?: (.*))?$/;
// Non-global regexes read the first value; global versions strip every occurrence
// (Python re.sub semantics). \w is Unicode-aware in Python, so tags use \p{L}\p{N}.
const PRIO_RE = /\s*!p(\d)(?![\p{L}\p{N}_])/u;
const DUE_RE = /\s*\[due (\d{4}-\d{2}-\d{2})\]/;
const RECUR_RE = /\s*\[recur: ([a-z,]+)\]/;
const TAG_RE = /\s*#([\p{L}\p{N}_-]+)/gu;
const PRIO_ALL = new RegExp(PRIO_RE.source, "gu");
const DUE_ALL = new RegExp(DUE_RE.source, "g");
const RECUR_ALL = new RegExp(RECUR_RE.source, "g");
const WEEKDAY_LIST: readonly string[] = WEEKDAYS;

export function parseBacklog(markdown: string): {
  items: ParsedItem[];
  skipped: { line: string; reason: string }[];
  /** Copies of the same task that were folded into one (same normalised title). */
  merged: { title: string; section: string }[];
} {
  const items: ParsedItem[] = [];
  const skipped: { line: string; reason: string }[] = [];
  let section = "";
  let rawSection = "";
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (rawLine.startsWith("## ")) {
      rawSection = rawLine.slice(3).trim();
      section = rawSection.toLowerCase();
      continue;
    }
    const m = TASK_RE.exec(line);
    if (!m || m[1] !== " ") continue;
    if (section.includes("parked") || section.includes("moved elsewhere")) continue;
    const raw = unwikilink(m[2] ?? "");

    const prio = PRIO_RE.exec(raw);
    const due = DUE_RE.exec(raw);
    const recur = RECUR_RE.exec(raw);
    const tags = [...raw.matchAll(TAG_RE)].map((t) => t[1]);
    const stripped = raw
      .replace(PRIO_ALL, "")
      .replace(DUE_ALL, "")
      .replace(RECUR_ALL, "")
      .replace(TAG_RE, "")
      .replace(/\s+/g, " ")
      .trim();
    const { title, notes: titleNotes } = cleanTitle(stripped);
    if (!title) {
      skipped.push({ line, reason: "empty text" });
      continue;
    }

    let priority: Priority = 2;
    if (prio) {
      if (prio[1] === "1" || prio[1] === "2" || prio[1] === "3") priority = Number(prio[1]) as Priority;
      else skipped.push({ line, reason: `unknown priority !p${prio[1]}, defaulted to 2` });
    }
    let dueDate: ISODate | undefined;
    if (due) {
      if (isValidISODate(due[1])) dueDate = due[1];
      else skipped.push({ line, reason: `invalid due date ${due[1]}, imported without due` });
    }
    let recurDays: Weekday[] | undefined;
    if (recur) {
      const days = recur[1].split(",").filter(Boolean);
      if (days.length && days.every((d) => WEEKDAY_LIST.includes(d))) recurDays = days as Weekday[];
      else skipped.push({ line, reason: `invalid recur "${recur[1]}", imported without recur` });
    }

    const parsed: ParsedItem = {
      title,
      priority,
      tags,
      inbox: section.includes("inbox"),
      section: rawSection,
      key: "backlog:" + title.toLowerCase(),
    };
    if (dueDate) parsed.due = dueDate;
    if (recurDays) parsed.recur = recurDays;
    if (titleNotes.length) parsed.notes = titleNotes.join("\n");
    items.push(parsed);
  }
  const { items: unique, merged } = mergeCopies(items);
  return { items: unique, skipped, merged };
}

const union = (a: string[], b: string[]) => [...a, ...b.filter((x) => !a.includes(x))];

/**
 * Folds copies of one task (same normalised title) into the first. The copy under a real
 * section wins over one in an inbox section; tags and notes are merged, and a missing
 * due date or repeat is filled from the copy.
 */
function mergeCopies(items: ParsedItem[]): { items: ParsedItem[]; merged: { title: string; section: string }[] } {
  const kept: ParsedItem[] = [];
  const byTitle = new Map<string, ParsedItem>();
  const merged: { title: string; section: string }[] = [];
  for (const it of items) {
    const norm = normaliseTitle(it.title);
    const first = norm ? byTitle.get(norm) : undefined;
    if (!first) {
      kept.push(it);
      if (norm) byTitle.set(norm, it);
      continue;
    }
    merged.push({ title: first.title, section: it.section });
    if (sectionToArea(first.section) === "inbox" && sectionToArea(it.section) !== "inbox") {
      first.section = it.section;
      first.inbox = it.inbox;
    }
    first.tags = union(first.tags, it.tags);
    first.priority = Math.min(first.priority, it.priority) as Priority;
    if (!first.due && it.due) first.due = it.due;
    if (!first.recur && it.recur) first.recur = it.recur;
    const notes = union((first.notes ?? "").split("\n").filter(Boolean), (it.notes ?? "").split("\n").filter(Boolean));
    if (notes.length) first.notes = notes.join("\n");
  }
  return { items: kept, merged };
}

export interface ImportNote {
  line: string;
  reason: string;
}

/** The row a parsed Backlog line becomes. Pure; shared with the one-time transfer script. */
export function backlogItem(p: ParsedItem, today: ISODate): Item {
  const item: Item = {
    id: crypto.randomUUID(),
    kind: "task",
    title: p.title,
    links: [],
    areaId: sectionToArea(p.section),
    priority: p.priority,
    status: "open",
    createdAt: today,
    touchedAt: today,
    source: { kind: "backlog", key: p.key },
  };
  if (p.notes) item.notes = p.notes;
  if (p.tags.length) item.tags = p.tags;
  if (p.due) item.due = p.due;
  if (p.recur) item.recur = p.recur;
  return item;
}

/** `skipped` is kept for older callers and always equals `notes.length`. */
export async function importBacklog(
  markdown: string,
  today: ISODate,
): Promise<{ added: number; alreadyHad: number; skipped: number; notes: ImportNote[] }> {
  const { items, skipped } = parseBacklog(markdown);
  let added = 0;
  let alreadyHad = 0;
  await db.transaction("rw", db.items, async () => {
    keepOwnStamps(); // added rows are stamped from their createdAt, never "now"
    const existing = new Set<string>();
    await db.items.each((i) => {
      if (i.source?.key) existing.add(i.source.key);
    });
    for (const p of items) {
      if (existing.has(p.key)) {
        alreadyHad++;
        continue;
      }
      await db.items.add(backlogItem(p, today));
      existing.add(p.key);
      added++;
    }
  });
  return { added, alreadyHad, skipped: skipped.length, notes: skipped };
}
