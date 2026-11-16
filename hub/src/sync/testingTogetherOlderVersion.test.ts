import { vi } from "vitest";
import { db } from "../data/db";
import { exportBackup, restoreBackup } from "../data/backup";
import { readLearned, readSharePrivate } from "../data/repo";
import { journalId, validJournal } from "../data/validate";
import type { JournalRow } from "../domain/types";
import { journalAad, sealJson, type JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { FakeSyncServer } from "./fakeServer";
import { getMeta, saveSyncSettings, syncOnce } from "./engine";

// Testing session (Together link), 2026-11-05: the live build (origin/worktree-hub-design-spec)
// has no "share" or "learned" journal kinds. Its quarantine code (sync/engine.ts applyRow,
// holdForLater, retryQuarantine; data/backup.ts export of held rows and `later`) is the same as
// together-link's (the live branch's later changes there are journal re-key only: keywrap rows,
// acceptedSeq, a foreign-journal check). So the older app is this code with the two kinds taken
// out of JOURNAL_KINDS: its validJournal then refuses them, exactly as the live validate.ts does
// (checked against `git show origin/worktree-hub-design-spec:hub/src/data/validate.ts`: refuses
// both, keeps their sealed shape for backups). This device (the app's own database) is the older
// app; the newer Mac's rows are sealed as the repo seals them. Made-up words; fake sync server.

const older = vi.hoisted(() => ({ removed: ["share", "learned"], list: [] as string[] }));
vi.mock("../domain/types", async (importOriginal) => {
  const real = await importOriginal<typeof import("../domain/types")>();
  older.list.push(...real.JOURNAL_KINDS.filter((k) => !older.removed.includes(k)));
  // validate.ts keeps this same array: putting the kinds back into it is the update.
  return { ...real, JOURNAL_KINDS: older.list };
});
const update = () => older.list.push(...older.removed.filter((k) => !older.list.includes(k)));
const backToOlder = () => older.removed.forEach((k) => older.list.includes(k) && older.list.splice(older.list.indexOf(k), 1));

const TOKEN = "01d5".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const DAY = "2026-11-04";
const NEWER = "device-pretend-newmac";
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-journal-older-version");
});
beforeEach(async () => {
  await Promise.all([db.items.clear(), db.goals.clear(), db.files.clear(), db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear()]);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  await confirmedDevice(db, jk);
});
afterEach(backToOlder);

async function sealed(kind: JournalRow["kind"], suffix: string, entry: unknown): Promise<JournalRow> {
  const id = journalId(kind, DAY, suffix);
  return { id, kind, date: DAY, fp: jk.fp, ...(await sealJson(jk.key, entry, journalAad(id))) };
}

/** The newer Mac, with a tick, learned words and a morning page on the server. */
async function newerMac(server: FakeSyncServer) {
  const rows = {
    tick: await sealed("share", "exercise", { v: 1, private: true, at: 1 }),
    learned: await sealed("learned", NEWER, { v: 1, text: "Pretend Gorsemoor learned words", at: 2 }),
    page: await sealed("page", "3f2a1b4c-0000-4000-8000-0000000000a1", { v: 1, text: "Pretend page", at: 3 }),
  };
  // Straight to the server as the newer app sends them (this test's validJournal is the older one).
  const changes = Object.values(rows).map((r, i) => ({ table: "journal", id: r.id, updatedAt: 10 + i, data: { ...r, updatedAt: 10 + i } }));
  await server.fetch(`${SERVER}/v1/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ deviceId: "newer-mac-1", cursor: 0, changes }),
  });
  return { rows };
}

it("the older app really refuses both kinds (as the live validate.ts does)", async () => {
  const tick = await sealed("share", "exercise", { v: 1, private: true, at: 1 });
  const learned = await sealed("learned", NEWER, { v: 1, text: "x", at: 1 });
  expect(validJournal(tick)).toBe(false);
  expect(validJournal(learned)).toBe(false);
  update();
  expect(validJournal(tick)).toBe(true);
  expect(validJournal(learned)).toBe(true);
});

it("receiving them: kept in quarantine (not dropped, no crash), the rest syncs both ways; after the update they apply", async () => {
  const server = new FakeSyncServer(TOKEN);
  const { rows } = await newerMac(server);
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect(await db.journal.get(rows.page.id)).toBeTruthy();
  expect(await db.journal.get(rows.tick.id)).toBeUndefined();
  expect(await db.journal.get(rows.learned.id)).toBeUndefined();
  expect((await db.quarantine.toArray()).map((q) => q.id).sort()).toEqual([rows.learned.id, rows.tick.id].sort());
  expect(await getMeta(db, "cursor")).toBe(server.seq);

  // The older app keeps writing and syncing its own journal rows meanwhile.
  const mine = await sealed("page", "3f2a1b4c-0000-4000-8000-0000000000b2", { v: 1, text: "Pretend older page", at: 4 });
  await db.journal.put(mine);
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect(await db.pending.count()).toBe(0);
  expect([...server.rows.values()].some((r) => r.id === mine.id)).toBe(true);

  // The newer Mac changes the tick again: the older app holds the newest only.
  const untick = await sealed("share", "exercise", { v: 1, private: false, at: 5 });
  await server.fetch(`${SERVER}/v1/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ deviceId: "newer-mac-1", cursor: server.seq, changes: [{ table: "journal", id: untick.id, updatedAt: 50, data: { ...untick, updatedAt: 50 } }] }),
  });
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect((await db.quarantine.get(["journal", untick.id]))!.updatedAt).toBe(50);

  update();
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect(await db.quarantine.count()).toBe(0);
  expect(await readSharePrivate(jk, DAY)).toEqual({ exercise: false, checkin: false });
  expect((await readLearned(jk, DAY)).text).toBe("Pretend Gorsemoor learned words");
});

it.each(["replace", "merge"] as const)("a backup made by the older app keeps them (still sealed); restored with %s, they apply after the update", async (mode) => {
  const server = new FakeSyncServer(TOKEN);
  const { rows } = await newerMac(server);
  await syncOnce({ db, fetch: server.fetch });
  const file = JSON.parse(JSON.stringify(await exportBackup(DAY)));
  expect(file.journal.map((r: JournalRow) => r.id)).toEqual(expect.arrayContaining([rows.tick.id, rows.learned.id]));
  expect(JSON.stringify(file)).not.toContain("Gorsemoor");

  // Restored into an empty older app (sync off, as a fresh install).
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear()]);
  await confirmedDevice(db, jk);
  await restoreBackup(file, mode);
  expect(await db.journal.get(rows.tick.id)).toBeUndefined();
  expect((await db.quarantine.toArray()).map((q) => q.id)).toEqual(expect.arrayContaining([rows.tick.id, rows.learned.id]));

  update();
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect(await readSharePrivate(jk, DAY)).toEqual({ exercise: true, checkin: false });
  expect((await readLearned(jk, DAY)).text).toBe("Pretend Gorsemoor learned words");
});
