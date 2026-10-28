import { endOfMonth, isValidISODate } from "../domain/dates";
import { AREA_IDS, WEEKDAYS, type AreaId, type Goal, type ISODate, type Item, type Weekday } from "../domain/types";
import { sectionToArea } from "./sectionAreas";

export interface ParseNote {
  line: string;
  reason: string;
}

export interface ProposedGoal {
  /** `obsidian:goal:<slug of title>`; makes the import safe to repeat. */
  key: string;
  title: string;
  /** The proposal. Goals can never live in the inbox, so unmapped areas propose `admin`. */
  areaId: AreaId;
  /** True when `areaId` is the admin fallback, not a match. */
  areaFallback: boolean;
  kind: "finite" | "practice";
  deadline?: ISODate;
  why?: string;
  cadence?: string;
  notes?: string;
  /** Milestone titles; ids are made when the goal is written. */
  milestones: string[];
}

export interface ProposedTask {
  /** `obsidian:task:<goal slug>:<slug of text>` (`habits` stands in for the goal slug). */
  key: string;
  title: string;
  areaId: AreaId;
  /** Key of the goal this task belongs to, when it came with one. */
  goalKey?: string;
  recur?: Weekday[];
}

export interface Selection {
  goals: ProposedGoal[];
  tasks: ProposedTask[];
}

export const slug = (s: string): string => s.toLowerCase().replace(/\s+/g, " ").trim();

const MAX_MILESTONE = 200;
const ALL_DAYS: Weekday[] = [...WEEKDAYS];

const lines = (md: unknown): string[] => (typeof md === "string" ? md.split(/\r?\n/) : []);

/** Heading text without emoji, joined-character marks, extra spaces. */
function stripEmoji(s: string): string {
  return s
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[‍︎️⃣]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const stripParenthetical = (s: string) => s.replace(/\s*\([^)]*\)\s*$/, "").trim();

/** Bullet text for `-`, `*` or `+` bullets, or undefined for any other line. */
function bulletText(trimmed: string): string | undefined {
  const m = /^[-*+]\s+(.*)$/.exec(trimmed);
  return m ? m[1].trim() : undefined;
}

const LABELLED = /^(identity|weekly|ongoing|daily|marker|study these north stars)\s*:\s*(.*)$/i;

/** The last plausible 4-digit year in a line (not part of a number like 50,000 or 1.2000). */
function yearIn(line: string): number | undefined {
  const all = [...line.matchAll(/(?<![\d,.])((?:19|20)\d{2})(?![\d,])/g)];
  return all.length ? Number(all[all.length - 1][1]) : undefined;
}

export function parseAreaGoals(md: string, today: ISODate): { goals: ProposedGoal[]; notes: ParseNote[] } {
  const goals: ProposedGoal[] = [];
  const notes: ParseNote[] = [];
  const todayYear = Number(today.slice(0, 4));

  interface Draft {
    title: string;
    identity: string[];
    cadence: string[];
    study?: string;
    markers: string[];
    skip: boolean;
  }
  let cur: Draft | undefined;
  const seen = new Set<string>();

  function finish() {
    if (!cur || cur.skip) return;
    const area = sectionToArea(cur.title);
    const finite = cur.markers.length > 0;
    const g: ProposedGoal = {
      key: "obsidian:goal:" + slug(cur.title),
      title: cur.title,
      areaId: area === "inbox" ? "admin" : area,
      areaFallback: area === "inbox",
      kind: finite ? "finite" : "practice",
      milestones: cur.markers,
    };
    if (finite) g.deadline = `${yearIn(cur.markers[0]) ?? todayYear}-12-31`;
    if (cur.identity.length) g.why = cur.identity.join("\n\n");
    if (cur.cadence.length) g.cadence = cur.cadence.join("\n");
    if (cur.study) g.notes = cur.study;
    goals.push(g);
  }

  for (const raw of lines(md)) {
    const line = raw.trim();
    const h = /^##\s+(.*)$/.exec(line);
    if (h && !line.startsWith("###")) {
      finish();
      const title = stripParenthetical(stripEmoji(h[1]));
      if (!title) {
        notes.push({ line, reason: "heading has no name, skipped" });
        cur = undefined;
        continue;
      }
      if (slug(title) === "notes") {
        cur = undefined;
        continue;
      }
      const k = slug(title);
      if (seen.has(k)) {
        notes.push({ line: title, reason: "duplicate area, skipped" });
        cur = { title, identity: [], cadence: [], markers: [], skip: true };
        continue;
      }
      seen.add(k);
      cur = { title, identity: [], cadence: [], markers: [], skip: false };
      continue;
    }
    if (!cur || cur.skip) continue;
    const text = bulletText(line);
    if (text === undefined) continue;
    const m = LABELLED.exec(text);
    if (!m) {
      notes.push({ line: text, reason: "line not recognised" });
      continue;
    }
    const label = m[1].toLowerCase();
    const rest = m[2].trim();
    if (!rest) {
      notes.push({ line: text, reason: `empty ${label === "marker" ? "marker" : "line"}, skipped` });
      continue;
    }
    if (label === "identity") cur.identity.push(rest);
    else if (label === "marker") cur.markers.push(rest.slice(0, MAX_MILESTONE));
    else if (label === "study these north stars") cur.study = rest;
    else cur.cadence.push(`${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}: ${rest}`);
  }
  finish();
  return { goals, notes };
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function monthNumber(name: string): number | undefined {
  const n = name.toLowerCase();
  const i = MONTHS.findIndex((m) => m === n || (n.length === 3 && m.startsWith(n)));
  return i >= 0 ? i + 1 : undefined;
}

export function parseMonthGoals(
  md: string,
  today: ISODate,
): { goals: ProposedGoal[]; tasks: ProposedTask[]; monthEnd?: ISODate; notes: ParseNote[] } {
  const goals: ProposedGoal[] = [];
  const tasks: ProposedTask[] = [];
  const notes: ParseNote[] = [];
  const all = lines(md);

  let monthEnd: ISODate | undefined;
  const head = all.map((l) => l.trim()).find((l) => /^#\s+goals for\b/i.test(l));
  if (head) {
    const m = /^#\s+goals for\s+(\S+)\s+(\d{4})\b/i.exec(head);
    const month = m ? monthNumber(m[1]) : undefined;
    if (m && month) monthEnd = endOfMonth(Number(m[2]), month);
    else notes.push({ line: head, reason: "month heading not readable, using the end of this month" });
  } else if (all.some((l) => l.trim())) {
    notes.push({ line: "", reason: "no month heading found, using the end of this month" });
  }
  const deadline = monthEnd ?? endOfMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)));

  let active = false;
  let last: ProposedGoal | undefined;
  let stepTaken = false;
  const seen = new Set<string>();
  for (const raw of all) {
    const line = raw.trim();
    const h = /^##\s+(.*)$/.exec(line);
    if (h && !line.startsWith("###")) {
      active = /^this month['’]?s goals$/i.test(stripEmoji(h[1]));
      last = undefined;
      continue;
    }
    if (!active || !line) continue;
    const text = bulletText(line);
    if (text === undefined) continue;
    const indented = /^\s/.test(raw);
    if (indented) {
      const n = /^([^:]{1,40}?)\s*:\s*(.*)$/.exec(text);
      if (n && last && n[2].trim()) {
        const isNext = /^next[\s-]?steps?$/i.test(n[1].trim());
        // A different label is used only for the first nested line, and we say so.
        if (isNext || !stepTaken) {
          const title = n[2].trim();
          tasks.push({
            key: `obsidian:task:${slug(last.title)}:${slug(title)}`,
            title,
            areaId: last.areaId,
            goalKey: last.key,
          });
          if (!isNext) notes.push({ line: last.title, reason: "nested line used as the next step (its label was not Next step)" });
          stepTaken = true;
        }
      }
      continue;
    }
    const b = /^\*\*(.+?)\*\*\s*:?\s*(.*)$/.exec(text);
    const full = b ? b[1].trim().replace(/:\s*$/, "").trim().replace(/\s+/g, " ") : "";
    let title = stripParenthetical(full);
    if (!b || !title) {
      notes.push({ line: text, reason: "goal has no bold title, skipped" });
      last = undefined;
      continue;
    }
    // Two titles that differ only by a parenthetical keep the full text for the later one.
    if (seen.has(slug(title)) && full !== title && !seen.has(slug(full))) title = full;
    if (seen.has(slug(title))) {
      notes.push({ line: title, reason: "duplicate goal, skipped" });
      last = undefined;
      continue;
    }
    seen.add(slug(title));
    stepTaken = false;
    const g: ProposedGoal = {
      key: "obsidian:goal:" + slug(title),
      title,
      areaId: "admin",
      areaFallback: true,
      kind: "finite",
      deadline,
      milestones: [],
    };
    const desc = b[2].trim();
    if (desc) g.notes = desc;
    goals.push(g);
    last = g;
  }
  const out: { goals: ProposedGoal[]; tasks: ProposedTask[]; monthEnd?: ISODate; notes: ParseNote[] } = {
    goals,
    tasks,
    notes,
  };
  if (monthEnd) out.monthEnd = monthEnd;
  return out;
}

export function parseHabits(md: string): {
  habits: ProposedTask[];
  metrics: { name: string; current: number; target: number }[];
  weekly: string[];
  notes: ParseNote[];
} {
  const habits: ProposedTask[] = [];
  const metrics: { name: string; current: number; target: number }[] = [];
  const weekly: string[] = [];
  const notes: ParseNote[] = [];
  const seen = new Set<string>();
  let section = "";
  const num = (s: string) => Number(s.replace(/,/g, ""));
  for (const raw of lines(md)) {
    const line = raw.trim();
    const h = /^##\s+(.*)$/.exec(line);
    if (h && !line.startsWith("###")) {
      section = slug(stripEmoji(h[1]));
      continue;
    }
    const text = bulletText(line);
    if (text === undefined || !text) continue;
    if (section === "big goals") {
      const m = /^(.+?)\s*:\s*([\d,]*\.?\d+)\s*%?\s*\/\s*([\d,]*\.?\d+)\s*%?$/.exec(text);
      const current = m ? num(m[2]) : NaN;
      const target = m ? num(m[3]) : NaN;
      if (m && Number.isFinite(current) && Number.isFinite(target)) metrics.push({ name: m[1].trim(), current, target });
      else notes.push({ line: text, reason: "not a number out of a number, not shown" });
    } else if (section === "this week") {
      weekly.push(text);
    } else if (section === "daily habits") {
      const k = slug(text);
      if (seen.has(k)) {
        notes.push({ line: text, reason: "duplicate habit, skipped" });
        continue;
      }
      seen.add(k);
      habits.push({ key: `obsidian:task:habits:${k}`, title: text, areaId: "mind", recur: [...ALL_DAYS] });
    }
  }
  return { habits, metrics, weekly, notes };
}

const AREA_LIST: readonly string[] = AREA_IDS;

function checkArea(areaId: string, what: string) {
  if (!AREA_LIST.includes(areaId) || areaId === "inbox") throw new Error(`${what} needs an area other than the inbox`);
}

/**
 * Turns proposals into real rows (fresh ids, tasks linked to their goal's id). Pure:
 * nothing is written. Throws before building anything if a row is invalid: a finite
 * goal needs a real deadline, and no goal or task may be in the inbox.
 */
export function buildObsidianRows(selection: Selection, today: ISODate): { goals: Goal[]; items: Item[] } {
  for (const g of selection.goals) {
    if (!g.title.trim()) throw new Error("a goal needs a title");
    checkArea(g.areaId, "a goal");
    if (g.kind === "finite" && !(g.deadline && isValidISODate(g.deadline))) {
      throw new Error("finite goals need a deadline");
    }
  }
  for (const t of selection.tasks) {
    if (!t.title.trim()) throw new Error("a task needs a title");
    checkArea(t.areaId, "a task");
  }

  const goalIds = new Map<string, string>();
  const goals: Goal[] = [];
  for (const p of selection.goals) {
    if (goalIds.has(p.key)) continue;
    const goal: Goal = {
      id: crypto.randomUUID(),
      title: p.title.trim(),
      areaId: p.areaId,
      kind: p.kind,
      milestones: p.milestones.map((title) => ({ id: crypto.randomUUID(), title, done: false })),
      source: { kind: "obsidian", key: p.key },
      createdAt: today,
    };
    if (p.kind === "finite" && p.deadline) goal.deadline = p.deadline;
    if (p.why) goal.why = p.why;
    if (p.cadence) goal.cadence = p.cadence;
    if (p.notes) goal.notes = p.notes;
    goals.push(goal);
    goalIds.set(p.key, goal.id);
  }

  const seen = new Set<string>();
  const items: Item[] = [];
  for (const p of selection.tasks) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    const item: Item = {
      id: crypto.randomUUID(),
      kind: "task",
      title: p.title.trim(),
      links: [],
      areaId: p.areaId,
      priority: 2,
      status: "open",
      createdAt: today,
      touchedAt: today,
      source: { kind: "obsidian", key: p.key },
    };
    const goalId = p.goalKey ? goalIds.get(p.goalKey) : undefined;
    if (goalId) item.goalId = goalId;
    if (p.recur) item.recur = p.recur;
    items.push(item);
  }
  return { goals, items };
}
