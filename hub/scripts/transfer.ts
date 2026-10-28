// One-time transfer from Obsidian notes and a Google Tasks export into an Esmeworld
// backup file. It REUSES the app's own parsers, row builders and backup validator, so
// the file is exactly what the Backup page's Merge accepts. Nothing here is bundled
// into the app; run it with `npx tsx scripts/obsidian-transfer.ts`.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseBackup, type BackupFile } from "../src/data/backup";
import { AREA_IDS, type AreaId, type ISODate, type Item } from "../src/domain/types";
import { backlogItem, parseBacklog } from "../src/import/backlog";
import {
  normaliseTitle,
  parseGoogleTasks,
  planGoogleTasks,
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

/** Area names for the summary (the same names the app shows). */
const AREA_LABEL: Record<AreaId, string> = {
  inbox: "Inbox",
  writing: "Writing",
  art: "Art",
  content: "Content",
  mind: "Mind",
  body: "Body",
  tech: "Tech projects",
  production: "Production",
  admin: "Admin",
};
const AREA_LIST: readonly string[] = AREA_IDS;
const label = (a: AreaId) => AREA_LABEL[a] ?? a;

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

  // Google Tasks, with the same title check as importGoogleTasks, against everything above.
  let gtasksAdded = 0;
  let listTitles = new Map<string, string>();
  let duplicates: SkippedDuplicate[] = [];
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
    const haveTitles = new Set<string>();
    for (const i of items) {
      const n = normaliseTitle(i.title);
      if (n) haveTitles.add(n);
    }
    const plan = planGoogleTasks(parsed.items, new Set(keys), haveTitles, today);
    duplicates = plan.duplicates;
    listTitles = new Map(parsed.items.map((p) => [p.key, p.listTitle]));
    for (const i of plan.newItems) if (add(i)) gtasksAdded++;
  }

  // Everything the rules left in the inbox, before any areas map is applied.
  for (const i of items) {
    if (i.areaId !== "inbox" || !i.source) continue;
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

  const backup: BackupFile = { app: "life-hub", schema: 1, exportedOn: today, items, goals: rows.goals };
  try {
    parseBackup(JSON.parse(JSON.stringify(backup)));
  } catch {
    throw new Error(NOT_VALID);
  }

  const stillInInbox = items.filter((i) => i.areaId === "inbox").length;
  const counts: Record<string, number> = {
    items: items.length,
    goals: rows.goals.length,
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
    today, backup, monthGoals, monthTasks, habitTasks, metrics, weekly, duplicates, notes, sorted, stillInInbox,
    goalsAsProposed: goals,
  });
  return { backup, summary, classify, notes, counts };
}

function makeSummary(s: {
  today: ISODate;
  backup: BackupFile;
  monthGoals: ProposedGoal[];
  monthTasks: ProposedTask[];
  habitTasks: ProposedTask[];
  metrics: { name: string; current: number; target: number }[];
  weekly: string[];
  duplicates: SkippedDuplicate[];
  notes: ParseNote[];
  sorted: { title: string; areaId: AreaId }[];
  stillInInbox: number;
  goalsAsProposed: ProposedGoal[];
}): string {
  const L: string[] = [];
  L.push(`# Esmeworld transfer summary, ${s.today}`, "");
  L.push("This file is for you only. It contains your own titles and stays on this Mac.", "");

  L.push("## Items by area", "");
  for (const id of AREA_IDS) {
    const n = s.backup.items.filter((i) => i.areaId === id).length;
    if (n) L.push(`- ${label(id)}: ${n}`);
  }
  L.push(`- Total items: ${s.backup.items.length}`, "");

  L.push("## Goals", "");
  if (!s.backup.goals.length) L.push("No goals.");
  for (const g of s.backup.goals) {
    const when = g.deadline ? `, deadline ${g.deadline}` : "";
    L.push(`- ${g.title}: ${label(g.areaId)}, ${g.kind}${when}, ${g.milestones.length} milestones`);
  }
  L.push("");

  L.push("## Monthly goals and next steps", "");
  if (!s.monthGoals.length) L.push("None.");
  for (const g of s.monthGoals) {
    L.push(`- ${g.title} (deadline ${g.deadline ?? "none"})`);
    for (const t of s.monthTasks.filter((t) => t.goalKey === g.key)) L.push(`  - Next step: ${t.title}`);
  }
  L.push("");

  L.push("## Daily habits", "");
  if (!s.habitTasks.length) L.push("None.");
  for (const h of s.habitTasks) L.push(`- ${h.title} (every day)`);
  L.push("");

  if (s.metrics.length || s.weekly.length) {
    L.push("## Big goal numbers and this week (not transferred)", "");
    for (const m of s.metrics) L.push(`- ${m.name}: ${m.current} of ${m.target}`);
    for (const w of s.weekly) L.push(`- ${w}`);
    L.push("");
  }

  L.push("## Google Tasks skipped as the same title", "");
  if (!s.duplicates.length) L.push("None.");
  for (const d of s.duplicates) {
    const why = d.reason === "existing" ? "matches a transferred item" : "repeated in the Google file";
    L.push(
      `- ${d.title} (from ${d.listTitle})${d.hadNotes ? " - had notes" : ""}${d.hadDue ? " - had a due date" : ""} - ${why}`,
    );
  }
  L.push("");

  L.push("## Sorted for you", "");
  if (!s.sorted.length) L.push("Nothing was re-filed by an areas file.");
  for (const x of s.sorted) L.push(`- ${x.title} -> ${label(x.areaId)}`);
  L.push("");

  L.push("## Still in your Inbox", "", `${s.stillInInbox} items. Sort them in Esmeworld with the area buttons.`, "");

  L.push("## Notes", "");
  if (!s.notes.length) L.push("None.");
  for (const n of s.notes) L.push(n.line ? `- ${n.reason}: ${n.line}` : `- ${n.reason}`);
  L.push("");

  L.push(
    "## How to load this",
    "",
    "1. Open Esmeworld and go to Backup.",
    "2. Choose the transfer .json file next to this summary.",
    "3. Choose Merge (not Replace).",
    "4. Load it ONCE, into ONE place: the hosted app. Sync will copy it to your other devices later.",
    "5. Do not also import the same notes through the Inbox, or you will get duplicates.",
    "",
  );
  return L.join("\n");
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
  const t = buildTransfer(readInputs(o.vault, o.gtasks), o.today, { areas });
  mkdirSync(o.out, { recursive: true });
  const backupPath = join(o.out, `esmeworld-transfer-${o.today}.json`);
  const summaryPath = join(o.out, `esmeworld-transfer-${o.today}-summary.md`);
  writePrivate(backupPath, JSON.stringify(t.backup, null, 2));
  writePrivate(summaryPath, t.summary);
  const lines = [
    `Items: ${t.counts.items} (backlog ${t.counts.backlogItems}, google tasks ${t.counts.gtasksAdded}, next steps ${t.counts.nextSteps}, habits ${t.counts.habits})`,
    `Goals: ${t.counts.goals}`,
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
