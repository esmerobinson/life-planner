import { db } from "../data/db";
import { isValidISODate } from "../domain/dates";
import type { ISODate, Item, Priority, Weekday } from "../domain/types";

export interface ParsedItem {
  title: string;
  priority: Priority;
  due?: ISODate;
  recur?: Weekday[];
  tags: string[];
  inbox: boolean;
  key: string;
}

// Regexes ported from src/backlog.py.
const TASK_RE = /^- \[( |x|>)\](?: (.*))?$/;
const PRIO_RE = /\s*!p(\d)\b/;
const DUE_RE = /\s*\[due (\d{4}-\d{2}-\d{2})\]/;
const RECUR_RE = /\s*\[recur: ([a-z,]+)\]/;
const TAG_RE = /\s*#([\w-]+)/g;
const WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function parseBacklog(markdown: string): {
  items: ParsedItem[];
  skipped: { line: string; reason: string }[];
} {
  const items: ParsedItem[] = [];
  const skipped: { line: string; reason: string }[] = [];
  let section = "";
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (rawLine.startsWith("## ")) {
      section = rawLine.slice(3).trim().toLowerCase();
      continue;
    }
    const m = TASK_RE.exec(line);
    if (!m || m[1] !== " ") continue;
    if (section.includes("parked") || section.includes("moved elsewhere")) continue;
    const raw = m[2] ?? "";

    const prio = PRIO_RE.exec(raw);
    const due = DUE_RE.exec(raw);
    const recur = RECUR_RE.exec(raw);
    const tags = [...raw.matchAll(TAG_RE)].map((t) => t[1]);
    const title = raw
      .replace(PRIO_RE, "")
      .replace(DUE_RE, "")
      .replace(RECUR_RE, "")
      .replace(TAG_RE, "")
      .replace(/\s+/g, " ")
      .trim();
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
      if (days.length && days.every((d) => WEEKDAYS.includes(d as Weekday))) recurDays = days as Weekday[];
      else skipped.push({ line, reason: `invalid recur "${recur[1]}", imported without recur` });
    }

    const parsed: ParsedItem = {
      title,
      priority,
      tags,
      inbox: section.includes("inbox"),
      key: "backlog:" + title.toLowerCase(),
    };
    if (dueDate) parsed.due = dueDate;
    if (recurDays) parsed.recur = recurDays;
    items.push(parsed);
  }
  return { items, skipped };
}

export async function importBacklog(
  markdown: string,
  today: ISODate,
): Promise<{ added: number; alreadyHad: number; skipped: number }> {
  const { items, skipped } = parseBacklog(markdown);
  let added = 0;
  let alreadyHad = 0;
  await db.transaction("rw", db.items, async () => {
    const existing = new Set<string>();
    await db.items.each((i) => {
      if (i.source?.key) existing.add(i.source.key);
    });
    for (const p of items) {
      if (existing.has(p.key)) {
        alreadyHad++;
        continue;
      }
      const item: Item = {
        id: crypto.randomUUID(),
        kind: "task",
        title: p.title,
        links: [],
        areaId: "inbox",
        priority: p.priority,
        status: "open",
        createdAt: today,
        touchedAt: today,
        source: { kind: "backlog", key: p.key },
      };
      if (p.due) item.due = p.due;
      if (p.recur) item.recur = p.recur;
      await db.items.add(item);
      existing.add(p.key);
      added++;
    }
  });
  return { added, alreadyHad, skipped: skipped.length };
}
