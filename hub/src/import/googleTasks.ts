import { db } from "../data/db";
import { keepOwnStamps } from "../data/changeTracking";
import { isValidISODate } from "../domain/dates";
import type { ISODate, Item } from "../domain/types";
import { normaliseTitle } from "./titleClean";

export { normaliseTitle };

export interface GoogleImportNote {
  line: string;
  reason: string;
}

export interface ParsedGoogleTask {
  title: string;
  notes?: string;
  due?: ISODate;
  listTitle: string;
  googleId: string;
  parentId?: string;
  /** Title of the parent task when it is in the same export. */
  parentTitle?: string;
  key: string;
}

export interface SkippedDuplicate {
  title: string;
  listTitle: string;
  hadNotes: boolean;
  hadDue: boolean;
  reason: "existing" | "in-file";
}

const NOT_AN_EXPORT: GoogleImportNote = { line: "", reason: "This is not a Google Tasks export." };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export const tagFor = (listTitle: string) => listTitle.toLowerCase().replace(/\s+/g, " ").trim();

/** `due` is RFC 3339; only its date part is used, with no timezone conversion. */
function dueDate(raw: string): ISODate | undefined {
  const date = raw.slice(0, 10);
  if (raw.length > 10 && raw[10] !== "T") return undefined;
  return isValidISODate(date) ? date : undefined;
}

export function parseGoogleTasks(raw: unknown): { items: ParsedGoogleTask[]; notes: GoogleImportNote[] } {
  if (!isObj(raw) || !Array.isArray(raw.lists)) return { items: [], notes: [NOT_AN_EXPORT] };
  const items: ParsedGoogleTask[] = [];
  const notes: GoogleImportNote[] = [];
  const seenIds = new Set<string>();

  const titleById = new Map<string, string>();
  for (const list of raw.lists) {
    if (!isObj(list) || !Array.isArray(list.tasks)) continue;
    for (const t of list.tasks) {
      if (!isObj(t)) continue;
      const id = str(t.id);
      const title = str(t.title)?.trim();
      if (id && title) titleById.set(id, title);
    }
  }

  for (const list of raw.lists) {
    if (!isObj(list)) {
      notes.push({ line: "", reason: "A list in the file could not be read" });
      continue;
    }
    const listTitle = str(list.title)?.trim() ?? "";
    if (!Array.isArray(list.tasks)) {
      notes.push({ line: listTitle, reason: "This list has no tasks that could be read" });
      continue;
    }
    for (const t of list.tasks) {
      if (!isObj(t)) {
        notes.push({ line: "", reason: "A task in the file could not be read" });
        continue;
      }
      if (t.status !== "needsAction") continue;
      const title = (str(t.title) ?? "").replace(/\s+/g, " ").trim();
      const id = str(t.id);
      if (!id) {
        notes.push({ line: title, reason: "task has no id, not imported" });
        continue;
      }
      if (!title) {
        notes.push({ line: "", reason: "task has a blank title, not imported" });
        continue;
      }
      if (seenIds.has(id)) {
        notes.push({ line: title, reason: "duplicate task id in file" });
        continue;
      }
      seenIds.add(id);
      const task: ParsedGoogleTask = { title, listTitle, googleId: id, key: "gtasks:" + id };
      const taskNotes = str(t.notes)?.trim();
      if (taskNotes) task.notes = taskNotes;
      if (t.due !== undefined) {
        const d = typeof t.due === "string" ? dueDate(t.due) : undefined;
        if (d) task.due = d;
        else notes.push({ line: title, reason: "invalid due date, imported without due" });
      }
      const parentId = str(t.parent);
      if (parentId) {
        task.parentId = parentId;
        const parentTitle = titleById.get(parentId);
        if (parentTitle) task.parentTitle = parentTitle;
      }
      items.push(task);
    }
  }
  return { items, notes };
}

const skipped = (p: ParsedGoogleTask, reason: SkippedDuplicate["reason"]): SkippedDuplicate => ({
  title: p.title,
  listTitle: p.listTitle,
  hadNotes: !!p.notes,
  hadDue: !!p.due,
  reason,
});

/** Notes lines a Google task brings: its notes, then "Part of: <parent>" for a subtask. */
export function googleNoteLines(p: ParsedGoogleTask): string[] {
  const parts: string[] = [];
  if (p.notes) parts.push(p.notes);
  if (p.parentTitle) parts.push(`Part of: ${p.parentTitle}`);
  return parts;
}

/**
 * Decides which parsed tasks become new rows. Pure: nothing is read or written here.
 * `haveKeys` and `haveTitles` (normalised) describe what already exists; a task whose
 * key exists is counted `alreadyHad`, and a task whose title matches an existing one
 * (or an earlier one in the same file) is skipped and listed. Duplicates inside the
 * file merge their list tag onto the row that was kept.
 */
export function planGoogleTasks(
  parsed: ParsedGoogleTask[],
  haveKeys: Set<string>,
  haveTitles: Map<string, string>,
  today: ISODate,
): {
  newItems: Item[];
  alreadyHad: number;
  duplicates: SkippedDuplicate[];
  /** The skipped tasks themselves, with the key of the existing row they matched (reason "existing"). */
  skippedTasks: { task: ParsedGoogleTask; reason: SkippedDuplicate["reason"]; matchedKey?: string }[];
} {
  let alreadyHad = 0;
  const duplicates: SkippedDuplicate[] = [];
  const skippedTasks: { task: ParsedGoogleTask; reason: SkippedDuplicate["reason"]; matchedKey?: string }[] = [];
  const keys = new Set(haveKeys);
  // Rows added by this plan, by normalised title, so a duplicate inside the file can merge its tag.
  const addedByTitle = new Map<string, Item>();
  const newItems: Item[] = [];
  for (const p of parsed) {
    if (keys.has(p.key)) {
      alreadyHad++;
      continue;
    }
    const norm = normaliseTitle(p.title);
    const tag = tagFor(p.listTitle);
    if (norm) {
      const earlier = addedByTitle.get(norm);
      if (earlier) {
        duplicates.push(skipped(p, "in-file"));
        skippedTasks.push({ task: p, reason: "in-file", matchedKey: earlier.source?.key });
        if (tag && !(earlier.tags ?? []).includes(tag)) earlier.tags = [...(earlier.tags ?? []), tag];
        continue;
      }
      if (haveTitles.has(norm)) {
        duplicates.push(skipped(p, "existing"));
        skippedTasks.push({ task: p, reason: "existing", matchedKey: haveTitles.get(norm) || undefined });
        continue;
      }
    }
    const noteParts = googleNoteLines(p);
    const item: Item = {
      id: crypto.randomUUID(),
      kind: "task",
      title: p.title,
      links: [],
      areaId: "inbox",
      priority: 2,
      status: "open",
      createdAt: today,
      touchedAt: today,
      source: { kind: "gtasks", key: p.key },
    };
    if (noteParts.length) item.notes = noteParts.join("\n");
    if (p.due) item.due = p.due;
    if (tag) item.tags = [tag];
    keys.add(p.key);
    if (norm) addedByTitle.set(norm, item);
    newItems.push(item);
  }
  return { newItems, alreadyHad, duplicates, skippedTasks };
}

export async function importGoogleTasks(
  raw: unknown,
  today: ISODate,
): Promise<{
  added: number;
  alreadyHad: number;
  duplicateTitles: number;
  skipped: number;
  notes: GoogleImportNote[];
  duplicates: SkippedDuplicate[];
}> {
  const { items, notes } = parseGoogleTasks(raw);
  let plan: ReturnType<typeof planGoogleTasks> = { newItems: [], alreadyHad: 0, duplicates: [], skippedTasks: [] };
  await db.transaction("rw", db.items, async () => {
    keepOwnStamps(); // added rows are stamped from their createdAt, never "now"
    const haveKeys = new Set<string>();
    const haveTitles = new Map<string, string>();
    await db.items.each((i) => {
      if (i.source?.key) haveKeys.add(i.source.key);
      const n = normaliseTitle(i.title);
      if (n && !haveTitles.has(n)) haveTitles.set(n, i.source?.key ?? "");
    });
    plan = planGoogleTasks(items, haveKeys, haveTitles, today);
    if (plan.newItems.length) await db.items.bulkAdd(plan.newItems);
  });
  return {
    added: plan.newItems.length,
    alreadyHad: plan.alreadyHad,
    duplicateTitles: plan.duplicates.length,
    skipped: notes.length,
    notes,
    duplicates: plan.duplicates,
  };
}
