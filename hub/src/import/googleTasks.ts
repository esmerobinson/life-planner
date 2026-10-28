import { db } from "../data/db";
import { isValidISODate } from "../domain/dates";
import type { ISODate, Item } from "../domain/types";

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

const NOT_AN_EXPORT: GoogleImportNote = { line: "", reason: "This is not a Google Tasks export." };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

/** Lowercase, letters and digits only, spaces collapsed: emoji and punctuation are ignored. */
export function normaliseTitle(title: string): string {
  return title
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const tagFor = (listTitle: string) => listTitle.toLowerCase().replace(/\s+/g, " ").trim();

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

export async function importGoogleTasks(
  raw: unknown,
  today: ISODate,
): Promise<{
  added: number;
  alreadyHad: number;
  duplicateTitles: number;
  skipped: number;
  notes: GoogleImportNote[];
}> {
  const { items, notes } = parseGoogleTasks(raw);
  let added = 0;
  let alreadyHad = 0;
  let duplicateTitles = 0;
  await db.transaction("rw", db.items, async () => {
    const haveKeys = new Set<string>();
    const haveTitles = new Set<string>();
    await db.items.each((i) => {
      if (i.source?.key) haveKeys.add(i.source.key);
      const n = normaliseTitle(i.title);
      if (n) haveTitles.add(n);
    });
    // Rows added by this import, by normalised title, so a duplicate inside the file can merge its tag.
    const addedByTitle = new Map<string, Item>();
    const pending: Item[] = [];
    for (const p of items) {
      if (haveKeys.has(p.key)) {
        alreadyHad++;
        continue;
      }
      const norm = normaliseTitle(p.title);
      const tag = tagFor(p.listTitle);
      if (norm) {
        const earlier = addedByTitle.get(norm);
        if (earlier) {
          duplicateTitles++;
          if (tag && !(earlier.tags ?? []).includes(tag)) earlier.tags = [...(earlier.tags ?? []), tag];
          continue;
        }
        if (haveTitles.has(norm)) {
          duplicateTitles++;
          continue;
        }
      }
      const noteParts: string[] = [];
      if (p.notes) noteParts.push(p.notes);
      if (p.parentTitle) noteParts.push(`Part of: ${p.parentTitle}`);
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
      haveKeys.add(p.key);
      if (norm) addedByTitle.set(norm, item);
      added++;
      // Written after the loop, once every merged tag is known.
      pending.push(item);
    }
    if (pending.length) await db.items.bulkAdd(pending);
  });
  return { added, alreadyHad, duplicateTitles, skipped: notes.length, notes };
}
