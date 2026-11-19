// "What I did" (Esme, 19 Nov 2026; esme-list.md, decisions-record.md): what she actually did when
// she ticked a to-do off, with the files she kept with it, as a log she can look back on each
// week and search. The pure part: the shape, its checks, the log by week, the weekly review's
// "Completed this week", and the folder a file is copied into on the Mac.

import { addDays, isValidISODate, mondayOf } from "./dates";
import { isHabit } from "./habits";
import { isProject } from "./projects";
import type { AreaId, DidEntry, DidFile, ISODate, Item } from "./types";

/** The longest note (characters). */
export const MAX_DID_NOTE = 10_000;
/** The most notes one to-do keeps (a project has at most 20 sessions; room to spare). */
export const MAX_DID_ENTRIES = 60;
/** The most files one note keeps. */
export const MAX_DID_FILES = 100;
/** The longest file name and folder path kept (macOS allows 255 bytes a name, 1024 a path). */
export const MAX_FILE_NAME = 255;
export const MAX_FOLDER = 1024;
/** Where files go on the Mac until she chooses another folder (Esme, 19 Nov: the Desktop). */
export const DEFAULT_FILES_ROOT = "~/Desktop";

const ENTRY_KEYS = new Set(["id", "on", "note", "files", "session"]);
const FILE_KEYS = new Set(["name", "folder"]);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

function validFile(f: unknown): boolean {
  return (
    isObj(f) &&
    Object.keys(f).every((k) => FILE_KEYS.has(k)) &&
    isStr(f.name) && f.name !== "" && f.name.length <= MAX_FILE_NAME &&
    isStr(f.folder) && f.folder !== "" && f.folder.length <= MAX_FOLDER
  );
}

function validEntry(e: unknown): boolean {
  return (
    isObj(e) &&
    Object.keys(e).every((k) => ENTRY_KEYS.has(k)) &&
    isStr(e.id) && e.id !== "" && e.id.length <= 64 &&
    isStr(e.on) && isValidISODate(e.on) &&
    (e.note === undefined || (isStr(e.note) && e.note.length <= MAX_DID_NOTE)) &&
    (e.session === undefined || (isStr(e.session) && e.session !== "" && e.session.length <= 64)) &&
    (e.files === undefined || (Array.isArray(e.files) && e.files.length <= MAX_DID_FILES && e.files.every(validFile)))
  );
}

/** An item's `did`: absent, or a list of well-formed notes with distinct ids. */
export function validDid(v: unknown): boolean {
  if (v === undefined) return true;
  if (!Array.isArray(v) || v.length > MAX_DID_ENTRIES || !v.every(validEntry)) return false;
  return new Set(v.map((e) => (e as DidEntry).id)).size === v.length;
}

/** What to change in one note. */
export interface DidPatch {
  /** The whole note as typed; blank removes it. */
  note?: string;
  /** Files just copied, added at the end. */
  addFiles?: DidFile[];
  /** Forget one file (by its place in the list). The file itself is never touched. */
  removeFile?: number;
}

/**
 * The list with one note changed (made if it is new: `at` gives its id, day and session). A note
 * left with no words and no files goes; an empty list is undefined (the field goes).
 */
export function withDidEntry(
  list: DidEntry[] | undefined, at: Pick<DidEntry, "id" | "on" | "session">, patch: DidPatch,
): DidEntry[] | undefined {
  const all = [...(list ?? [])];
  const i = all.findIndex((e) => e.id === at.id);
  const was: DidEntry = i >= 0 ? all[i]! : { id: at.id, on: at.on, ...(at.session ? { session: at.session } : {}) };
  // The day is the caller's: the side panel keeps the note's own, a re-tick moves it (review M7).
  const next: DidEntry = { ...was, on: at.on };
  if (patch.note !== undefined) {
    if (patch.note.trim()) next.note = patch.note.slice(0, MAX_DID_NOTE);
    else delete next.note;
  }
  let files = [...(was.files ?? [])];
  if (patch.removeFile !== undefined) files = files.filter((_, k) => k !== patch.removeFile);
  if (patch.addFiles?.length) files = [...files, ...patch.addFiles].slice(0, MAX_DID_FILES);
  if (files.length) next.files = files;
  else delete next.files;
  const empty = next.note === undefined && next.files === undefined;
  if (i >= 0) {
    if (empty) all.splice(i, 1);
    else all[i] = next;
  } else if (!empty) all.push(next);
  return all.length ? all : undefined;
}

/** The most a folder name may be (UTF-8 bytes; macOS allows 255, room kept for " (2)"). */
const MAX_NAME_BYTES = 200;

/** Whole characters (graphemes where the browser can tell them, else code points). */
function chars(s: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: string }) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
  return Seg ? [...new Seg(undefined, { granularity: "grapheme" }).segment(s)].map((x) => x.segment) : [...s];
}

/**
 * A name macOS takes for a file or folder: "/" and ":" become "-", control characters and
 * leading dots go, spaces trimmed, at most 100 characters and 200 UTF-8 bytes, never cutting a
 * character in two (review M3); "Untitled" when nothing is left.
 */
export function safeName(name: string): string {
  const clean = name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[/:]/g, "-")
    .trim()
    .replace(/^\.+/, "")
    .trim();
  const enc = new TextEncoder();
  let out = "";
  let bytes = 0;
  let n = 0;
  for (const c of chars(clean)) {
    const b = enc.encode(c).length;
    if (n + 1 > 100 || bytes + b > MAX_NAME_BYTES) break;
    out += c;
    bytes += b;
    n++;
  }
  const s = out.trim();
  return s === "" ? "Untitled" : s;
}

/** The folder a file is copied into: `<root>/<Area>`, or `<root>/<Area>/<Project>`. */
export function folderFor(root: string, area: string, project?: string): string {
  const r = root.replace(/\/+$/, "") || "/";
  const parts = [safeName(area), ...(project !== undefined ? [safeName(project)] : [])];
  return `${r === "/" ? "" : r}/${parts.join("/")}`;
}

/** One note in the log. */
export interface LogEntry {
  /** `<itemId>:<entryId>`, unique across the log. */
  key: string;
  itemId: string;
  entryId: string;
  on: ISODate;
  /** The to-do's title, or a project's session ("Session 2: Inking"). */
  todo: string;
  /** The project's title, for a session's note. */
  project?: string;
  area: AreaId;
  areaLabel: string;
  note?: string;
  files: DidFile[];
}

/** What a note is on: a plain to-do, or a project's session. */
function noteTitle(it: Item, e: Pick<DidEntry, "session">): { todo: string; project?: string } {
  const list = it.sessions ?? [];
  const k = e.session ? list.findIndex((s) => s.id === e.session) : -1;
  if (k >= 0) return { todo: `Session ${k + 1}${list[k]!.title ? `: ${list[k]!.title}` : ""}`, project: it.title };
  return { todo: it.title };
}

/** Rows in the Bin, or emptied from it, have no log. */
const live = (it: Item) => it.status !== "deleted" && it.status !== "purged";

/** Every note, newest first (same day: the later in the lists first). */
export function didLog(items: readonly Item[], areaLabel: (id: AreaId) => string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const it of items) {
    if (!live(it)) continue;
    for (const e of it.did ?? []) {
      out.push({
        key: `${it.id}:${e.id}`, itemId: it.id, entryId: e.id, on: e.on, ...noteTitle(it, e),
        area: it.areaId, areaLabel: areaLabel(it.areaId), ...(e.note ? { note: e.note } : {}), files: e.files ?? [],
      });
    }
  }
  return out.map((e, i) => ({ e, i })).sort((a, b) => b.e.on.localeCompare(a.e.on) || b.i - a.i).map((x) => x.e);
}

/** A week of the log, Monday to Sunday. */
export interface LogWeek {
  monday: ISODate;
  sunday: ISODate;
  entries: LogEntry[];
}

/** The log by week (Monday to Sunday), newest week first; `log` is newest first already. */
export function logWeeks(log: readonly LogEntry[]): LogWeek[] {
  const weeks: LogWeek[] = [];
  for (const e of log) {
    const monday = mondayOf(e.on);
    let w = weeks.find((x) => x.monday === monday);
    if (!w) weeks.push((w = { monday, sunday: addDays(monday, 6), entries: [] }));
    w.entries.push(e);
  }
  return weeks.sort((a, b) => b.monday.localeCompare(a.monday));
}

/** One line of the weekly review's "Completed this week". */
export interface DoneRow {
  key: string;
  on: ISODate;
  todo: string;
  project?: string;
  area: AreaId;
  areaLabel: string;
  note?: string;
  files: DidFile[];
}

/**
 * "Completed this week" in the Sunday weekly review: to-dos ticked done in `today`'s week
 * (Monday to Sunday) and project sessions ticked that week, each with its note, newest first.
 * Never habits or ideas. Display only: nothing here ever goes to Together (or anywhere).
 */
export function completedInWeek(items: readonly Item[], today: ISODate, areaLabel: (id: AreaId) => string): DoneRow[] {
  const monday = mondayOf(today);
  const sunday = addDays(monday, 6);
  const inWeek = (d: ISODate | undefined): d is ISODate => d !== undefined && d >= monday && d <= sunday;
  const rows: DoneRow[] = [];
  const noteFor = (it: Item, session?: string) => {
    const list = it.did ?? [];
    return session ? list.find((e) => e.session === session) : (list.find((e) => !e.session) ?? list[0]);
  };
  const row = (it: Item, on: ISODate, key: string, session?: string): DoneRow => {
    const e = noteFor(it, session);
    return {
      key, on, ...noteTitle(it, { session }), area: it.areaId, areaLabel: areaLabel(it.areaId),
      ...(e?.note ? { note: e.note } : {}), files: e?.files ?? [],
    };
  };
  for (const it of items) {
    if (!live(it) || it.kind !== "task" || isHabit(it)) continue;
    if (isProject(it)) {
      for (const s of it.sessions ?? []) if (inWeek(s.doneOn)) rows.push(row(it, s.doneOn, `${it.id}:${s.id}`, s.id));
      continue;
    }
    if (it.status === "done" && inWeek(it.completedAt)) rows.push(row(it, it.completedAt, it.id));
  }
  return rows.map((r, i) => ({ r, i })).sort((a, b) => b.r.on.localeCompare(a.r.on) || b.i - a.i).map((x) => x.r);
}

/**
 * Which note a tick (or the side panel) writes to: a plain to-do's one note (any it has, else id
 * "note"), a session's own note (else the session's id). The ids are fixed, so two boxes on the
 * same to-do never make two notes (review M4). Nothing is written until she types. `onTick`: a
 * re-tick moves an existing note to `today` once she writes (review M7); the side panel keeps its day.
 */
export function didTarget(it: Item, today: ISODate, session?: string, onTick = false): Pick<DidEntry, "id" | "on" | "session"> {
  const list = it.did ?? [];
  const found = session ? list.find((e) => e.session === session) : (list.find((e) => !e.session) ?? (isProject(it) ? undefined : list[0]));
  if (found) return { id: found.id, on: onTick ? today : found.on, ...(found.session ? { session: found.session } : {}) };
  return session ? { id: session, on: today, session } : { id: "note", on: today };
}
