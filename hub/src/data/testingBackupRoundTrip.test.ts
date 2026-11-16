// Testing session (backup area): Download backup -> restore with Replace (and with Merge into an
// empty hub) must give back EVERY synced table exactly: tasks (projects with sessions, books,
// stash, habits), goals (monthly goals, countsFrom), pictures (plain, purged, sealed journal
// photos) and every journal kind, still sealed. What Esme would see if this failed: something
// missing or changed after restoring her backup. Fictional data only.

import { db } from "./db";
import { exportBackup, INVALID_BACKUP, NEWER_BACKUP, parseBackup, restoreBackup } from "./backup";
import { arrivedRow, outfitRow, placedRow, seenRow, startRow, todayRow, type FarmRow } from "../farm/state";
import { journalId } from "./validate";
import { JOURNAL_KINDS, type FileRow, type Goal, type Item, type JournalRow } from "../domain/types";
import { journalAad, sealJson } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { readLearned, readSharePrivate, saveLearned, saveSharePrivate } from "./repo";

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
    highlight: `0123456789abcdef_${dev}_0a1b2c3d`,
    // Together link: one private tick per part of the day, and one device's learned words.
    share: "exercise", learned: dev,
  };
  const rows: JournalRow[] = [];
  for (const kind of JOURNAL_KINDS) {
    const id = journalId(kind, "2026-10-04", suffix[kind]);
    rows.push({ id, kind, date: "2026-10-04", fp: jk.fp, ...(await sealJson(jk.key, { v: 1, pretend: kind }, journalAad(id))) });
  }
  // The day's other private tick (each part is its own row), if this branch knows ticks.
  if ((JOURNAL_KINDS as readonly string[]).includes("share")) {
    const id = journalId("share" as JournalRow["kind"], "2026-10-04", "checkin");
    rows.push({ id, kind: "share" as JournalRow["kind"], date: "2026-10-04", fp: jk.fp, ...(await sealJson(jk.key, { v: 1, pretend: "checkin" }, journalAad(id))) });
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

// Esme's Farm: one row of every kind (fictional device ids and dates).
const farm: FarmRow[] = [
  startRow("devicePretend01", "2026-10-02"), startRow("devicePretend02", "2026-10-05"),
  seenRow("hi", "2026-10-02"), seenRow("lilypad", "2026-10-03"),
  placedRow("hen", "hen", "2026-10-04"), arrivedRow("bap", "2026-10-06"),
  outfitRow("bap", "A1"), outfitRow("domino", null), todayRow("2026-10-07"),
];

async function all() {
  return {
    farm: await db.farm.orderBy("id").toArray(),
    items: await db.items.orderBy("id").toArray(),
    goals: await db.goals.orderBy("id").toArray(),
    files: await db.files.orderBy("id").toArray(),
    journal: await db.journal.orderBy("id").toArray(),
  };
}

async function clearAll() {
  await Promise.all([db.items.clear(), db.goals.clear(), db.files.clear(), db.journal.clear(), db.farm.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear()]);
}

beforeEach(clearAll);

describe("backup round trip of every synced table", () => {
  it.each(["replace", "merge"] as const)("download then %s into an empty hub gives every row back exactly", async (mode) => {
    const { rows, photo } = await journalRows();
    await db.items.bulkAdd(items);
    await db.goals.bulkAdd(goals);
    await db.files.bulkAdd([...files, photo]);
    await db.journal.bulkAdd(rows);
    await db.farm.bulkAdd(farm);
    const before = await all();
    expect(before.journal.length).toBe(JOURNAL_KINDS.length + 1 + ((JOURNAL_KINDS as readonly string[]).includes("share") ? 1 : 0));
    expect(before.farm.length).toBe(farm.length);

    const file = JSON.parse(JSON.stringify(await exportBackup("2026-10-28")));
    await clearAll();
    await restoreBackup(file, mode);
    expect(await all()).toEqual(before);
  });
});

// Esme's Farm in backups (Testing session, farm x data safety). What Esme would see if these
// failed: her farm (where she put her stickers, who has moved in, outfits) changed or gone after
// a restore, or a backup she can't restore at all.
describe("the farm in backups", () => {
  const pretendTask: Item = { id: "t1", kind: "task", title: "Pretend task", links: [], areaId: "mind", priority: 2,
    status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01" };

  it("an older backup with no farm key: Merge leaves the farm exactly as it was", async () => {
    await db.farm.bulkAdd(farm);
    const before = (await all()).farm;
    const { farm: _f, ...older } = JSON.parse(JSON.stringify(await exportBackup("2026-10-28")));
    await restoreBackup({ ...older, items: [pretendTask] }, "merge");
    expect((await all()).farm).toEqual(before);
    expect(await db.items.get("t1")).toBeTruthy();
  });

  it("an older backup with no farm key: Replace still restores and keeps the farm as it was (backup.ts's stated intent)", async () => {
    await db.farm.bulkAdd(farm);
    const before = (await all()).farm;
    const { farm: _f, ...older } = JSON.parse(JSON.stringify(await exportBackup("2026-10-28")));
    await restoreBackup({ ...older, items: [pretendTask] }, "replace");
    expect((await all()).farm).toEqual(before);
    expect((await db.items.toArray()).map((i) => i.id)).toEqual(["t1"]);
  });

  it("a backup made before the farm was opened (farm: []) on Replace empties the farm, like every other table", async () => {
    const file = JSON.parse(JSON.stringify(await exportBackup("2026-10-28")));
    expect(file.farm).toEqual([]);
    await db.farm.bulkAdd(farm);
    await restoreBackup(file, "replace");
    expect(await db.farm.count()).toBe(0);
  });

  it.each([
    ["an extra key", { ...seenRow("hi", "2026-10-02"), extra: 1 }],
    ["an id that doesn't match its sticker", { id: "seen:hi", kind: "seen", sticker: "door", date: "2026-10-02" }],
    ["a bad date", { ...placedRow("hen", "hen", "2026-10-02"), date: "2026-13-40" }],
    ["an unknown character", { id: "arrived:rex", kind: "arrived", character: "rex", date: "2026-10-02" }],
    ["a bad stamp", { ...seenRow("hi", "2026-10-02"), updatedAt: -1 }],
  ])("a damaged farm row (%s) refuses the whole file and changes nothing", async (_n, bad) => {
    await db.farm.bulkAdd(farm);
    await db.items.add(pretendTask);
    const before = await all();
    const file = JSON.parse(JSON.stringify(await exportBackup("2026-10-28")));
    const damaged = { ...file, items: [], farm: [...file.farm, bad] };
    expect(() => parseBackup(damaged)).toThrow(INVALID_BACKUP);
    for (const mode of ["merge", "replace"] as const) await expect(restoreBackup(damaged, mode)).rejects.toThrow(INVALID_BACKUP);
    expect(await all()).toEqual(before);
  });

  it("two farm rows with the same id refuse the file whole", async () => {
    const file = JSON.parse(JSON.stringify(await exportBackup("2026-10-28")));
    expect(() => parseBackup({ ...file, farm: [seenRow("hi", "2026-10-02"), seenRow("hi", "2026-10-03")] })).toThrow(INVALID_BACKUP);
  });

  it("Merge into a hub with its own farm keeps this device's rows and adds only the missing ones", async () => {
    await db.farm.bulkAdd(farm);
    const file = JSON.parse(JSON.stringify(await exportBackup("2026-10-28")));
    await db.farm.clear();
    await db.farm.bulkAdd([outfitRow("bap", "H4"), placedRow("daisy", "daisy", "2026-10-20")]);
    await restoreBackup(file, "merge");
    const ids = (await db.farm.toArray()).map((r) => r.id).sort();
    expect(ids).toEqual([...farm.map((r) => r.id), "placed:daisy"].sort());
    expect(await db.farm.get("outfit:bap")).toMatchObject({ item: "H4" });
  });

  // FOUND (forward compatibility): sync keeps a farm row of a kind only a later app version knows
  // (sync/farm.test.ts "a later pack's kind"), and a backup keeps a journal row of a later kind
  // for later; but a backup holding a later farm kind is called "not an Esmeworld backup" and
  // nothing in it can be restored.
  it("a backup from a newer version with a farm kind this version doesn't know says so (NEWER_BACKUP), not 'not a backup'", async () => {
    const file = JSON.parse(JSON.stringify(await exportBackup("2026-10-28")));
    const newer = { ...file, items: [pretendTask], farm: [seenRow("hi", "2026-10-02"), { id: "coins:all", kind: "coins", n: 3, updatedAt: 10 }] };
    expect(() => parseBackup(newer)).toThrow(NEWER_BACKUP);
  });

  // FOUND (backup leaves out): farm rows this version holds in quarantine (sent by a newer
  // device) aren't in the backup, while held journal rows are (backup.ts exportBackup, review I3).
  it("farm rows held for a later version are in the backup, as held journal rows are", async () => {
    await db.quarantine.put({
      table: "farm", id: "coins:all", updatedAt: 10, data: { id: "coins:all", kind: "coins", n: 3, updatedAt: 10 },
      reason: "pretend: a later version reads it", cursor: 1,
    });
    const file = await exportBackup("2026-10-28");
    expect(file.farm?.map((r) => r.id)).toContain("coins:all");
  });
});

// Together link (Testing session, 2026-11-05): the private ticks and "what I learned today"
// words as the app really writes them (two devices' learned words, both ticks), round tripped
// and read back word for word, still sealed in the file and here.
describe("backup round trip of the private ticks and what I learned today", () => {
  it.each(["replace", "merge"] as const)("download then %s into an empty hub: the same ticks and words, still sealed", async (mode) => {
    const jk = await keyFor("pretend-roundtrip-passphrase");
    await confirmedDevice(db, jk);
    const DAY = "2026-10-04";
    await saveSharePrivate(jk, DAY, "exercise", true);
    await saveSharePrivate(jk, DAY, "checkin", false);
    await saveSharePrivate(jk, "2026-10-05", "checkin", true);
    await saveLearned(jk, DAY, "devicePretendMac1", "Pretend Ombrelle Mac lesson");
    // The phone's words for the same day, sealed as the repo seals them.
    const id = `learned:${DAY}:devicePretendPhone1`;
    await db.journal.put({ id, kind: "learned", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text: "Pretend Ombrelle phone lesson", at: 1 }, journalAad(id))) });
    const before = await all();

    const file = JSON.parse(JSON.stringify(await exportBackup("2026-10-28")));
    expect(JSON.stringify(file)).not.toMatch(/Ombrelle|"private"/);
    expect(file.journal.filter((r: JournalRow) => ["share", "learned"].includes(r.kind))).toHaveLength(5);
    await clearAll();
    await confirmedDevice(db, jk);
    await restoreBackup(file, mode);
    // (Merge keeps this device's own check row, written again by confirmedDevice above.)
    const notCheck = (rows: JournalRow[]) => rows.filter((r) => r.kind !== "verifier");
    expect(notCheck((await all()).journal)).toEqual(notCheck(before.journal));
    expect(await db.quarantine.count()).toBe(0);
    expect(await readSharePrivate(jk, DAY)).toEqual({ exercise: true, checkin: false });
    expect(await readSharePrivate(jk, "2026-10-05")).toEqual({ exercise: false, checkin: true });
    const day = await readLearned(jk, DAY);
    expect([day.text, ...day.others.map((o) => o.text)].sort()).toEqual(["Pretend Ombrelle Mac lesson", "Pretend Ombrelle phone lesson"]);
    expect(JSON.stringify(await db.journal.toArray())).not.toContain("Ombrelle");
  });
});
