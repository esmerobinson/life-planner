// Highlights' reads and writes (Esme, 2026-11-06): a phrase in an exercise card's learning
// text, kept "like on Kindle", with an optional short note, read back under Read back.
//
// Sealed journal rows of the kind "highlight", written only through journalRepo's write (the
// confirmed-key gate), like every journal kind. The notes pattern (journalRepo "notes to
// myself"): a highlight is a group of rows `highlight:<date>:<hid>_<deviceId>_<vid>`, one per
// VERSION. Making it, changing its note and removing it each write a NEW row naming the versions
// it was written over (`seen`), so no device ever writes over another's row; Remove is a version
// marked deleted (a tombstone), never a hard delete. A note box's own session row (this device's,
// made by the box now open) is the only row ever written again, while she types in it.
//
// Merging: the versions no other version was written over are a highlight's heads. Highlights of
// the same words at the same place (two devices, or a remove and a highlight again) are one
// highlight as she sees it: the newest head with a note shows, others with different words are
// kept under it. It is gone only when every head is a delete, and a delete only ever names the
// versions she had in front of her: a note written elsewhere that she never saw keeps it.
//
// Device ids: every row is new (a random vid), so a Replace never makes this device write over a
// row the server may hold newer (restore-safe, bug #31). After a Replace the device writes with
// its new id (deviceIds.ts ownDevices), even from a page still holding a former one; rows under
// its former ids stay and read as always.

import { db } from "./db";
import { journalId } from "./validate";
import { CANT_OPEN, highlightRows } from "./journalRepo";
import { ownDevices } from "./deviceIds";
import type { JournalKey } from "../journal/crypto";
import type { ISODate, JournalRow } from "../domain/types";
import {
  MAX_HIGHLIGHT_NOTE, type HighlightCard, type HighlightEntry, type TextAnchor,
} from "../journal/highlights";

export type { HighlightCard, TextAnchor };

/** One highlight as Read back and the card see it. */
export interface Highlight {
  /** A stable key (its first highlight id): the card's mark and Read back's entry. */
  key: string;
  /** The highlight ids it stands for (`highlight:<date>:<hid>`): one, or more of the same words. */
  hids: string[];
  /** The day it was first made (in its id). */
  date: ISODate;
  card: HighlightCard;
  anchor: TextAnchor;
  /** The note shown ("" for none). */
  note: string;
  /** Other notes on it with different words (another device's, written without seeing this one), newest first. */
  others: string[];
  /** When it was last highlighted (any of its ids). */
  createdAt: number;
  at: number;
  /** What changing the note shown replaces: per highlight id, the versions with exactly that note. */
  shown: { hid: string; vids: string[] }[];
  /** What Remove replaces: per highlight id, every version she can see. */
  heads: { hid: string; vids: string[] }[];
}

/** A highlight's id for its day (`highlight:<date>:<16 hex>`). */
function newHighlightId(today: ISODate): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return journalId("highlight", today, [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(""));
}
const newVid = () => [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("");
const hidOf = (row: JournalRow) => {
  const rest = row.id.slice(`highlight:${row.date}:`.length);
  return `highlight:${row.date}:${rest.slice(0, rest.indexOf("_"))}`;
};
const dateOf = (hid: string) => hid.slice("highlight:".length, "highlight:".length + 10);
const rowIdFor = (hid: string, device: string, vid: string) => `${hid}_${device}_${vid}`;
/** The same words at the same place (and on the same card): one highlight as she sees it. */
const placeKey = (e: HighlightEntry) => JSON.stringify([e.card.id, e.anchor.field, e.anchor.exact, e.anchor.prefix, e.anchor.suffix]);

/** The id this device writes its new rows with: its current one (deviceIds.ts), never a former one. */
const writerDevice = async (deviceId: string): Promise<string> => (await ownDevices(deviceId)).current;

/** Every highlight here (removed ones left out), newest first, and how many rows wouldn't open. */
export async function listHighlights(jk: JournalKey): Promise<{ highlights: Highlight[]; unreadable: number }> {
  const byHid = new Map<string, HighlightEntry[]>();
  let unreadable = 0;
  for (const row of await db.journal.where("kind").equals("highlight").toArray()) {
    const o = await highlightRows.open(jk, row);
    if (o.state !== "ok") {
      unreadable++;
      continue;
    }
    const hid = hidOf(row);
    byHid.set(hid, [...(byHid.get(hid) ?? []), o.entry]);
  }
  // Each highlight id's heads (versions no other was written over), and those still there.
  type Live = { hid: string; heads: HighlightEntry[]; live: HighlightEntry[]; createdAt: number };
  const groups = new Map<string, Live[]>();
  for (const [hid, versions] of byHid) {
    const heads = versions.filter((v) => !versions.some((w) => w !== v && w.seen.includes(v.vid)));
    const live = heads.filter((v) => !v.deleted);
    if (live.length === 0) continue;
    const key = placeKey(live[0]!);
    groups.set(key, [...(groups.get(key) ?? []), { hid, heads, live, createdAt: Math.min(...versions.map((v) => v.createdAt)) }]);
  }
  const highlights: Highlight[] = [];
  for (const ids of groups.values()) {
    ids.sort((a, b) => a.hid.localeCompare(b.hid));
    const all = ids.flatMap((x) => x.live.map((e) => ({ hid: x.hid, e }))).sort((a, b) => b.e.at - a.e.at || b.e.vid.localeCompare(a.e.vid));
    const top = all.find((x) => x.e.note.trim() !== "") ?? all[0]!;
    const note = top.e.note;
    const others: string[] = [];
    for (const x of all) {
      const t = x.e.note.trim();
      if (t === "" || t === note.trim() || others.some((o) => o.trim() === t)) continue;
      others.push(x.e.note);
    }
    const same = (e: HighlightEntry) => e.note.trim() === note.trim();
    highlights.push({
      key: ids[0]!.hid,
      hids: ids.map((x) => x.hid),
      date: dateOf(ids[0]!.hid),
      card: top.e.card,
      anchor: top.e.anchor,
      note,
      others,
      createdAt: Math.max(...ids.map((x) => x.createdAt)),
      at: top.e.at,
      shown: ids.map((x) => ({ hid: x.hid, vids: x.live.filter(same).map((e) => e.vid) })).filter((x) => x.vids.length > 0),
      heads: ids.map((x) => ({ hid: x.hid, vids: x.heads.map((e) => e.vid) })),
    });
  }
  highlights.sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key));
  return { highlights, unreadable };
}

/** A highlight version's row for this device. */
async function versionRow(jk: JournalKey, hid: string, device: string, vid: string, entry: HighlightEntry): Promise<JournalRow> {
  const date = dateOf(hid);
  return highlightRows.seal(jk, date, rowIdFor(hid, device, vid).slice(`highlight:${date}:`.length), entry);
}

/** One version of each of the highlight's ids, opened (the anchor and card it keeps). */
async function anyVersion(jk: JournalKey, hid: string): Promise<HighlightEntry> {
  for (const row of await db.journal.where("date").equals(dateOf(hid)).toArray()) {
    if (row.kind !== "highlight" || !row.id.startsWith(`${hid}_`)) continue;
    const o = await highlightRows.open(jk, row);
    if (o.state === "ok") return o.entry;
  }
  throw new Error("That highlight isn't here.");
}

/** Highlights the words `anchor` on `card` (a new highlight, with an optional note). Returns its id. */
export async function createHighlight(
  jk: JournalKey, today: ISODate, deviceId: string, card: HighlightCard, anchor: TextAnchor, note = "",
): Promise<string> {
  if (note.length > MAX_HIGHLIGHT_NOTE) throw new Error("That note is too long to save.");
  const device = await writerDevice(deviceId);
  const hid = newHighlightId(today);
  const at = Date.now();
  const vid = newVid();
  const entry: HighlightEntry = { v: 1, card, anchor, note, createdAt: at, at, vid, seen: [] };
  await highlightRows.write(jk, [await versionRow(jk, hid, device, vid, entry)]);
  return hid;
}

/**
 * A note box's session: per highlight id, the version row it writes and the versions that row is
 * written over (as they were when the box first saved), so each save while the box is open
 * rewrites only its own rows, never another (and never another device's).
 */
export type NoteSession = Map<string, { vid: string; seen: string[] }>;

/** Serialised saves (a quick second save never races the first one's new rows). */
let queue: Promise<unknown> = Promise.resolve();
function oneAtATime<T>(op: () => Promise<T>): Promise<T> {
  const next = queue.then(op, op);
  queue = next.catch(() => undefined);
  return next;
}

/**
 * Saves the note on a highlight: a new version written over the note she had in front of her
 * (`h.shown`) on each of its ids; within one note box session (`session`), its own rows again.
 * Another note on it she didn't have open stays.
 */
export function saveHighlightNote(
  jk: JournalKey, deviceId: string, h: Pick<Highlight, "shown">, note: string, session: NoteSession = new Map(),
): Promise<NoteSession> {
  return oneAtATime(async () => {
    if (note.length > MAX_HIGHLIGHT_NOTE) throw new Error("That note is too long to save.");
    const device = await writerDevice(deviceId);
    const at = Date.now();
    const rows: JournalRow[] = [];
    const next: NoteSession = new Map(session);
    const own = new Set([...session.values()].map((x) => x.vid));
    for (const { hid, vids } of h.shown) {
      const base = await anyVersion(jk, hid);
      const mine = next.get(hid) ?? { vid: newVid(), seen: vids.filter((v) => !own.has(v)) };
      const existing = await db.journal.get(rowIdFor(hid, device, mine.vid));
      if (existing && (await highlightRows.open(jk, existing)).state !== "ok") throw new Error(CANT_OPEN); // never written over
      const entry: HighlightEntry = { v: 1, card: base.card, anchor: base.anchor, note, createdAt: base.createdAt, at, vid: mine.vid, seen: mine.seen };
      rows.push(await versionRow(jk, hid, device, mine.vid, entry));
      next.set(hid, mine);
    }
    if (rows.length) await highlightRows.write(jk, rows);
    return next;
  });
}

/**
 * Removes a highlight (she confirmed): on each of its ids a new version, marked deleted, written
 * over every version she could see (`h.heads`). Its rows all stay; one made since elsewhere keeps it.
 */
export function removeHighlight(jk: JournalKey, deviceId: string, h: Pick<Highlight, "heads">): Promise<void> {
  return oneAtATime(async () => {
    const device = await writerDevice(deviceId);
    const at = Date.now();
    const rows: JournalRow[] = [];
    for (const { hid, vids } of h.heads) {
      if (vids.length === 0) continue;
      const base = await anyVersion(jk, hid);
      const vid = newVid();
      rows.push(await versionRow(jk, hid, device, vid, { v: 1, card: base.card, anchor: base.anchor, note: "", createdAt: base.createdAt, at, vid, seen: vids, deleted: true }));
    }
    if (rows.length) await highlightRows.write(jk, rows);
  });
}
