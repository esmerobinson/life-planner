// One-time transfer from Obsidian notes and a Google Tasks export into an Esmeworld
// backup file. It REUSES the app's own parsers, row builders and backup validator, so
// the file is exactly what the Backup page's Merge accepts. Nothing here is bundled
// into the app; run it with `npx tsx scripts/obsidian-transfer.ts`.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isValidISODate } from "../src/domain/dates";
import { parseBackup, type BackupFile } from "../src/data/backup";
import { parseExtra } from "./extra";
import { makeSummary } from "./summary";
import { AREA_IDS, type AreaId, type Goal, type ISODate, type Item } from "../src/domain/types";
import { backlogItem, parseBacklog } from "../src/import/backlog";
import {
  normaliseTitle,
  parseGoogleTasks,
  googleNoteLines,
  planGoogleTasks,
  tagFor,
  type ParsedGoogleTask,
  type SkippedDuplicate,
} from "../src/import/googleTasks";
import {
  buildObsidianRows,
  parseAreaGoals,
  parseHabits,
  parseMonthGoals,
  type ParseNote,
  type ProposedGoal,
  type ProposedTask,
} from "../src/import/obsidianGoals";

export interface TransferInputs {
  backlog?: string;
  goals?: string;
  month?: string;
  habits?: string;
  /** Raw text of the Google Tasks JSON export. */
  gtasks?: string;
  /** Raw text of the vault-review items, one JSON object per line (see parseExtra). */
  extra?: string;
  /** Names of inputs that were not found; each becomes a note. */
  missing: string[];
}

export interface ClassifyEntry {
  /** The item's stable `source.key` (ids change on every run, keys do not). */
  key: string;
  title: string;
  origin: "backlog" | "gtasks";
  section?: string;
  list?: string;
  notes?: string;
}

export interface TransferResult {
  backup: BackupFile;
  /** Readable summary for Esme only: it contains her titles. */
  summary: string;
  classify: ClassifyEntry[];
  notes: ParseNote[];
  /** Numbers only; safe to print. */
  counts: Record<string, number>;
}

export const NOT_VALID = "The transfer does not validate as an Esmeworld backup. Nothing was written.";

const AREA_LIST: readonly string[] = AREA_IDS;

/** Adds what a Google copy knows to the row that stays: its list tag, a due date if missing, new notes lines. */
function foldGoogleInto(target: Item, g: ParsedGoogleTask): void {
  const tag = tagFor(g.listTitle);
  if (tag && !(target.tags ?? []).includes(tag)) target.tags = [...(target.tags ?? []), tag];
  if (!target.due && g.due && target.kind !== "idea") target.due = g.due;
  const have = (target.notes ?? "").split("\n").filter(Boolean);
  const more = googleNoteLines(g).filter((l) => !have.includes(l));
  if (more.length) target.notes = [...have, ...more].join("\n");
}

export function buildTransfer(
  inputs: TransferInputs,
  today: ISODate,
  options: { areas?: Record<string, unknown> } = {},
): TransferResult {
  const notes: ParseNote[] = inputs.missing.map((m) => ({ line: "", reason: `${m} not found, skipped` }));
  const items: Item[] = [];
  const keys = new Set<string>();
  const add = (i: Item) => {
    if (i.source?.key && keys.has(i.source.key)) return false;
    if (i.source?.key) keys.add(i.source.key);
    items.push(i);
    return true;
  };

  // Backlog, filed by section exactly as importBacklog does.
  const sectionOf = new Map<string, string>();
  let backlogItems = 0;
  if (inputs.backlog !== undefined) {
    const parsed = parseBacklog(inputs.backlog);
    for (const p of parsed.items) {
      if (add(backlogItem(p, today))) {
        backlogItems++;
        sectionOf.set(p.key, p.section);
      }
    }
    notes.push(...parsed.skipped);
  }

  // Goals, monthly goals with their next steps, and daily habits.
  const goals: ProposedGoal[] = [];
  const tasks: ProposedTask[] = [];
  let monthGoals: ProposedGoal[] = [];
  let monthTasks: ProposedTask[] = [];
  let habitTasks: ProposedTask[] = [];
  let metrics: { name: string; current: number; target: number }[] = [];
  let weekly: string[] = [];
  let areaGoalCount = 0;
  if (inputs.goals !== undefined) {
    const a = parseAreaGoals(inputs.goals, today);
    goals.push(...a.goals);
    areaGoalCount = a.goals.length;
    notes.push(...a.notes);
  }
  if (inputs.month !== undefined) {
    const m = parseMonthGoals(inputs.month, today);
    monthGoals = m.goals;
    monthTasks = m.tasks;
    goals.push(...m.goals);
    tasks.push(...m.tasks);
    notes.push(...m.notes);
  }
  if (inputs.habits !== undefined) {
    const h = parseHabits(inputs.habits);
    habitTasks = h.habits;
    metrics = h.metrics;
    weekly = h.weekly;
    tasks.push(...h.habits);
    notes.push(...h.notes);
  }
  const rows = buildObsidianRows({ goals, tasks }, today);
  let nextSteps = 0;
  let habits = 0;
  for (const i of rows.items) {
    if (add(i)) {
      if (i.recur) habits++;
      else nextSteps++;
    }
  }

  // Vault-review items (--extra), already decided by hand, tagged by where they came from.
  const allGoals: Goal[] = [...rows.goals];
  const extraKeys = new Set<string>();
  let extraItems = 0;
  let extraGoals = 0;
  if (inputs.extra !== undefined) {
    const x = parseExtra(inputs.extra, today);
    notes.push(...x.notes);
    for (const e of x.entries) {
      const taken = keys.has(e.key) || extraKeys.has(e.key) || allGoals.some((g) => g.source?.key === e.key);
      if (taken) {
        notes.push({ line: "", reason: `extra line ${e.line}: key already used by another row, skipped` });
        continue;
      }
      extraKeys.add(e.key);
      if (e.goal) {
        allGoals.push(e.goal);
        extraGoals++;
      } else if (e.item && add(e.item)) {
        extraItems++;
      }
    }
  }

  // Google Tasks, with the same title check as importGoogleTasks, against everything above.
  let gtasksAdded = 0;
  let listTitles = new Map<string, string>();
  let duplicates: SkippedDuplicate[] = [];
  const googleMerges: { title: string; listTitle: string; into: string }[] = [];
  const classify: ClassifyEntry[] = [];
  if (inputs.gtasks !== undefined) {
    let raw: unknown;
    try {
      raw = JSON.parse(inputs.gtasks);
    } catch {
      raw = undefined;
    }
    const parsed = parseGoogleTasks(raw);
    notes.push(...parsed.notes);
    const haveTitles = new Map<string, string>();
    for (const i of items) {
      const n = normaliseTitle(i.title);
      if (n && !haveTitles.has(n)) haveTitles.set(n, i.source?.key ?? "");
    }
    const plan = planGoogleTasks(parsed.items, new Set(keys), haveTitles, today);
    duplicates = plan.duplicates;
    // A Google copy of a task already in the transfer is not added; its list tag, notes and due
    // are folded into the existing row (which keeps its own area and section).
    const byKey = new Map(items.filter((i) => i.source).map((i) => [i.source!.key, i]));
    for (const sk of plan.skippedTasks) {
      const target = sk.reason === "existing" && sk.matchedKey ? byKey.get(sk.matchedKey) : undefined;
      if (!target) continue;
      foldGoogleInto(target, sk.task);
      googleMerges.push({ title: sk.task.title, listTitle: sk.task.listTitle, into: target.source!.kind });
    }
    listTitles = new Map(parsed.items.map((p) => [p.key, p.listTitle]));
    for (const i of plan.newItems) if (add(i)) gtasksAdded++;
  }

  // Everything the rules left in the inbox, before any areas map is applied.
  for (const i of items) {
    if (i.areaId !== "inbox" || !i.source || extraKeys.has(i.source.key)) continue;
    const entry: ClassifyEntry = {
      key: i.source.key,
      title: i.title,
      origin: i.source.kind === "gtasks" ? "gtasks" : "backlog",
    };
    if (entry.origin === "backlog") {
      const s = sectionOf.get(i.source.key);
      if (s) entry.section = s;
    } else {
      const l = listTitles.get(i.source.key);
      if (l) entry.list = l;
    }
    if (i.notes) entry.notes = i.notes.slice(0, 200);
    classify.push(entry);
  }

  // Apply an areas map to inbox items only.
  const sorted: { title: string; areaId: AreaId }[] = [];
  if (options.areas) {
    const inbox = new Map(items.filter((i) => i.areaId === "inbox" && i.source).map((i) => [i.source!.key, i]));
    for (const [key, value] of Object.entries(options.areas)) {
      if (typeof value !== "string" || !AREA_LIST.includes(value)) {
        notes.push({ line: key, reason: "areas file: not a known area, ignored" });
      } else if (value === "inbox") {
        notes.push({ line: key, reason: "areas file: inbox is where it already is, ignored" });
      } else if (!inbox.has(key)) {
        notes.push({ line: key, reason: "areas file: no inbox item with this key, ignored" });
      } else {
        const item = inbox.get(key)!;
        item.areaId = value as AreaId;
        sorted.push({ title: item.title, areaId: value as AreaId });
      }
    }
  }

  const backup: BackupFile = { app: "life-hub", schema: 1, exportedOn: today, items, goals: allGoals };
  try {
    parseBackup(JSON.parse(JSON.stringify(backup)));
  } catch {
    throw new Error(NOT_VALID);
  }

  const stillInInbox = items.filter((i) => i.areaId === "inbox").length;
  const counts: Record<string, number> = {
    items: items.length,
    goals: allGoals.length,
    extraItems,
    extraGoals,
    areaGoals: areaGoalCount,
    monthGoals: monthGoals.length,
    backlogItems,
    gtasksAdded,
    gtasksDuplicates: duplicates.length,
    nextSteps,
    habits,
    sorted: sorted.length,
    stillInInbox,
    notes: notes.length,
  };
  const summary = makeSummary({
    extraItems, extraGoals,
    today, backup, monthGoals, monthTasks, habitTasks, metrics, weekly, duplicates, notes, sorted, stillInInbox,
    goalsAsProposed: goals,
  });
  return { backup, summary, classify, notes, counts };
}

/** Reads the vault notes and the Google file. Never writes to them. */
export function readInputs(vault: string, gtasks: string): TransferInputs {
  const missing: string[] = [];
  const read = (name: string, path: string): string | undefined => {
    if (!existsSync(path)) {
      missing.push(name);
      return undefined;
    }
    return readFileSync(path, "utf8");
  };
  return {
    backlog: read("Backlog.md", join(vault, "Backlog.md")),
    goals: read("Goals.md", join(vault, "Goals.md")),
    month: read("Goals for month.md", join(vault, "Goals for month.md")),
    habits: read("Goals & Habits.md", join(vault, "Goals & Habits.md")),
    gtasks: read(basename(gtasks), gtasks),
    missing,
  };
}

function writePrivate(path: string, text: string) {
  writeFileSync(path, text, { mode: 0o600 });
  chmodSync(path, 0o600);
}

export interface RunOptions {
  vault: string;
  gtasks: string;
  out: string;
  today: ISODate;
  classifyOut?: string;
  areasFile?: string;
  /** JSONL of vault-review items (see parseExtra). */
  extraFile?: string;
}

/** Builds the transfer and writes the files. Returns terminal lines: counts only, never titles. */
export function runTransfer(o: RunOptions): { lines: string[] } {
  let areas: Record<string, unknown> | undefined;
  if (o.areasFile) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(o.areasFile, "utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
      areas = parsed as Record<string, unknown>;
    } catch {
      throw new Error("The areas file could not be read as a JSON object of keys to areas. Nothing was written.");
    }
  }
  const inputs = readInputs(o.vault, o.gtasks);
  if (o.extraFile) {
    try {
      inputs.extra = readFileSync(o.extraFile, "utf8");
    } catch {
      throw new Error("The extra file could not be read. Nothing was written.");
    }
  }
  const t = buildTransfer(inputs, o.today, { areas });
  mkdirSync(o.out, { recursive: true });
  const backupPath = join(o.out, `esmeworld-transfer-${o.today}.json`);
  const summaryPath = join(o.out, `esmeworld-transfer-${o.today}-summary.md`);
  writePrivate(backupPath, JSON.stringify(t.backup, null, 2));
  writePrivate(summaryPath, t.summary);
  const lines = [
    `Items: ${t.counts.items} (backlog ${t.counts.backlogItems}, google tasks ${t.counts.gtasksAdded}, next steps ${t.counts.nextSteps}, habits ${t.counts.habits})`,
    `Goals: ${t.counts.goals}`,
    `Vault review: ${t.counts.extraItems} items, ${t.counts.extraGoals} goals`,
    `Google tasks skipped as the same title: ${t.counts.gtasksDuplicates}`,
    `Sorted by the areas file: ${t.counts.sorted}`,
    `Still in the inbox: ${t.counts.stillInInbox}`,
    `Notes: ${t.counts.notes}`,
    `Wrote ${backupPath}`,
    `Wrote ${summaryPath}`,
  ];
  if (o.classifyOut) {
    writePrivate(o.classifyOut, JSON.stringify(t.classify, null, 2));
    lines.push(`Wrote ${o.classifyOut} (${t.classify.length} items to classify)`);
  }
  return { lines };
}
