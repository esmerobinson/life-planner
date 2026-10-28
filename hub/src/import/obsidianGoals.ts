import { endOfMonth } from "../domain/dates";
import { WEEKDAYS, type AreaId, type ISODate, type Weekday } from "../domain/types";
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
/** The most text a goal's why, cadence or notes may hold (the backup validator's limit). */
export const MAX_GOAL_TEXT = 4000;

/** Cuts text to the limit and, if it was cut, adds a note naming the line. */
export function capText(text: string, field: string, line: string, notes: ParseNote[]): string {
  if (text.length <= MAX_GOAL_TEXT) return text;
  notes.push({ line, reason: `${field} cut to ${MAX_GOAL_TEXT} characters` });
  return text.slice(0, MAX_GOAL_TEXT);
}
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
    if (cur.identity.length) g.why = capText(cur.identity.join("\n\n"), "why", cur.title, notes);
    if (cur.cadence.length) g.cadence = capText(cur.cadence.join("\n"), "cadence", cur.title, notes);
    if (cur.study) g.notes = capText(cur.study, "notes", cur.title, notes);
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
            key: `obsidian:month-task:${slug(last.title)}:${slug(title)}`,
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
      key: "obsidian:month:" + slug(title),
      title,
      areaId: "admin",
      areaFallback: true,
      kind: "finite",
      deadline,
      milestones: [],
    };
    const desc = b[2].trim();
    if (desc) g.notes = capText(desc, "notes", title, notes);
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

export { buildObsidianRows } from "./obsidianRows";
