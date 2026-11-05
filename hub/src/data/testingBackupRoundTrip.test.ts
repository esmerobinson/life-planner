// Testing session (backup area): Download backup -> restore with Replace (and with Merge into an
// empty hub) must give back EVERY synced table exactly: tasks (projects with sessions, books,
// stash, habits), goals (monthly goals, countsFrom), pictures (plain, purged, sealed journal
// photos) and every journal kind, still sealed. What Esme would see if this failed: something
// missing or changed after restoring her backup. Fictional data only.

import { db } from "./db";
import { exportBackup, restoreBackup } from "./backup";
import { journalId } from "./validate";
import { JOURNAL_KINDS, type FileRow, type Goal, type Item, type JournalRow } from "../domain/types";
import { journalAad, sealJson } from "../journal/crypto";
import { keyFor } from "../test/journalKey";

const PLAIN_JPEG = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJCkjHCAkIiwgHBwoNzA=";

const items: Item[] = [
  {
    id: "proj", kind: "task", title: "Pretend project", links: ["https://example.test/p"], areaId: "tech", priority: 1,
    status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-02", due: "2026-12-01", goalId: "g1",
    sessions: [{ id: "s1", title: "Pretend session", details: "Pretend details", doneOn: "2026-10-03" }, { id: "s2", plannedFor: "2026-11-05" }],
    notes: "Pretend notes ![](file:pic1)", tags: ["pretend"], source: { kind: "manual", key: "k1" },
  },
  {
    id: "book", kind: "idea", title: "Pretend book", links: [], areaId: "mind", priority: 2, status: "open",
    createdAt: "2026-10-01", touchedAt: "2026-10-01", bookStatus: "reading", author: "A. Pretend", pages: 300,
    pageAt: 120, link: "https://example.test/book", stash: { task: { due: "2026-11-11", milestone: true } },
  },
  {
    id: "habit", kind: "task", title: "Pretend habit", links: [], areaId: "body", priority: 3, status: "open",
    createdAt: "2026-10-01", touchedAt: "2026-10-01", recur: ["mon", "wed"], doneDates: ["2026-10-05", "2026-10-07"],
    order: 2.5, milestone: false, pinnedDate: "2026-10-08", weekOf: "2026-10-05",
  },
  { id: "binned", kind: "task", title: "Pretend binned", links: [], areaId: "admin", priority: 2, status: "deleted",
    deletedAt: "2026-10-09", createdAt: "2026-10-01", touchedAt: "2026-10-09" },
  { id: "gone", kind: "task", title: "", links: [], areaId: "admin", priority: 2, status: "purged",
    createdAt: "2026-10-01", touchedAt: "2026-10-10" },
];

const goals: Goal[] = [
  {
    id: "g1", title: "Pretend goal", areaId: "writing", kind: "practice", milestones: [], why: "Pretend why",
    cadence: "Weekly: 3", notes: "Pretend goal notes", onHome: true, active: true, rhythm: "daily",
    countsFrom: ["journal", { area: "writing" }],
    monthGoals: [{ id: "mg1", month: "2026-10", kind: "count", title: "Pretend count", target: 12, log: ["2026-10-02"], auto: false },
      { id: "mg2", month: "2026-10", kind: "step", title: "Pretend step", done: true }],
    createdAt: "2026-10-01",
  },
  { id: "g2", title: "", areaId: "art", kind: "finite", milestones: [], status: "purged", createdAt: "2026-10-01" },
];

async function journalRows(): Promise<{ rows: JournalRow[]; photo: FileRow }> {
  const jk = await keyFor("pretend-roundtrip-passphrase");
  const dev = "devicePretend01";
  // Kinds added later (e.g. "note", "note-read" in journal-v3) are listed here too, so the
  // test covers every kind the app knows on whichever branch it runs.
  const suffix: Record<string, string | undefined> = {
    page: "11111111-1111-4111-8111-111111111111", photo: "photo1", draft: dev, answer: `abcdef012345:${dev}`,
    exercise: dev, stars: dev, "exercise-entry": `0123456789ab:${dev}`, cards: undefined,
    note: "22222222-2222-4222-8222-222222222222", "note-read": dev, keywrap: "0123456789abcdef",
  };
  const rows: JournalRow[] = [];
  for (const kind of JOURNAL_KINDS) {
    const id = journalId(kind, "2026-10-04", suffix[kind]);
    rows.push({ id, kind, date: "2026-10-04", fp: jk.fp, ...(await sealJson(jk.key, { v: 1, pretend: kind }, journalAad(id))) });
  }
  // A cards chunk too.
  rows.push({ id: "cards:0", kind: "cards", date: "2026-10-04", fp: jk.fp, ...(await sealJson(jk.key, { v: 4 }, journalAad("cards:0"))) });
  const photo: FileRow = { id: "photo1", mime: "image/jpeg", data: "AAAABBBB", width: 10, height: 20, createdAt: "2026-10-04",
    encrypted: true, iv: rows[0]!.iv, fp: jk.fp };
  return { rows, photo };
}

const files: FileRow[] = [
  { id: "pic1", mime: "image/jpeg", data: PLAIN_JPEG, width: 4, height: 3, createdAt: "2026-10-01" },
  { id: "pic2", mime: "image/png", data: "", width: 0, height: 0, createdAt: "2026-10-01", status: "purged" },
];

async function all() {
  return {
    items: await db.items.orderBy("id").toArray(),
    goals: await db.goals.orderBy("id").toArray(),
    files: await db.files.orderBy("id").toArray(),
    journal: await db.journal.orderBy("id").toArray(),
  };
}

async function clearAll() {
  await Promise.all([db.items.clear(), db.goals.clear(), db.files.clear(), db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear()]);
}

beforeEach(clearAll);

describe("backup round trip of every synced table", () => {
  it.each(["replace", "merge"] as const)("download then %s into an empty hub gives every row back exactly", async (mode) => {
    const { rows, photo } = await journalRows();
    await db.items.bulkAdd(items);
    await db.goals.bulkAdd(goals);
    await db.files.bulkAdd([...files, photo]);
    await db.journal.bulkAdd(rows);
    const before = await all();
    expect(before.journal.length).toBe(JOURNAL_KINDS.length + 1);

    const file = JSON.parse(JSON.stringify(await exportBackup("2026-10-28")));
    await clearAll();
    await restoreBackup(file, mode);
    expect(await all()).toEqual(before);
  });
});
