import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { exportBackup, restoreBackup } from "../data/backup";
import { createHighlight } from "../data/repo";
import type { JournalRow } from "../domain/types";
import { journalAad, openJson, sealJson, type JournalKey } from "../journal/crypto";
import { describeAnchor } from "../journal/highlights";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { FakeSyncServer } from "./fakeServer";
import { getMeta, saveSyncSettings, syncOnce } from "./engine";

// Highlights are a new journal kind ("highlight"). An app version from before them (simulated:
// its JOURNAL_KINDS doesn't have the kind, exactly as the previous release's doesn't, so its
// validJournal and its backups treat the rows as a later version's) must hold them in quarantine,
// keep syncing everything else, keep them in a backup, and apply them after an update.
// Fictional words only.

const kinds = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock("../domain/types", async (importOriginal) => {
  const real = await importOriginal<typeof import("../domain/types")>();
  // The same array validate.ts and backup.ts read: taking "highlight" out makes this an older app.
  kinds.list = [...real.JOURNAL_KINDS];
  return { ...real, JOURNAL_KINDS: kinds.list };
});
const older = {
  set on(v: boolean) {
    const i = kinds.list.indexOf("highlight");
    if (v && i >= 0) kinds.list.splice(i, 1);
    if (!v && i < 0) kinds.list.push("highlight");
  },
};
beforeEach(() => {
  older.on = true;
});

const TOKEN = "b1e7".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const DAY = "2026-11-06";
const CARD = { id: "pretend-1", track: "", book: "", day: 1, chapter: 1, chapterTitle: "Pretend chapter", theme: "Pretend weather" };
const TEXT = "A made-up note: pretend clouds drift past a pretend hill.";
const ANCHOR = describeAnchor("learn", TEXT, TEXT.indexOf("pretend hill"), TEXT.indexOf("pretend hill") + 12)!;
let jk: JournalKey;
let n = 0;
const open: HubDB[] = [];
beforeAll(async () => {
  jk = await keyFor("fake-journal-highlights-compat");
});
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function sealed(kind: JournalRow["kind"], id: string, entry: unknown): Promise<JournalRow> {
  return { id, kind, date: DAY, fp: jk.fp, ...(await sealJson(jk.key, entry, journalAad(id))), updatedAt: 0 };
}

async function serverWithNewerRows() {
  const hl = await sealed("highlight", `highlight:${DAY}:0123456789abcdef_device-phone-01_0a1b2c3d`, {
    v: 1, card: CARD, anchor: ANCHOR, note: "Pretend phone note", createdAt: 1, at: 1, vid: "0a1b2c3d", seen: [],
  });
  const page = await sealed("page", `page:${DAY}:3f2a1b4c-0000-4000-8000-000000000004`, { v: 1, text: "Pretend page", at: 3 });
  const server = new FakeSyncServer(TOKEN);
  const changes = [hl, page].map((r, i) => ({ table: "journal", id: r.id, updatedAt: 10 + i, data: { ...r, updatedAt: 10 + i } }));
  await server.fetch(`${SERVER}/v1/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ deviceId: "newer-device-1", cursor: 0, changes }),
  });
  return { server, hl, page };
}

async function device() {
  const d = new HubDB(`highlights-compat-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

it("this version: a highlight syncs to another device, sealed, and opens there", async () => {
  older.on = false;
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear()]);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  await confirmedDevice(db, jk);
  const server = new FakeSyncServer(TOKEN);
  await createHighlight(jk, DAY, "device-mac-0001", CARD, ANCHOR, "Pretend synced note");
  const rid = (await db.journal.where("kind").equals("highlight").first())!.id;
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  const phone = await device();
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  const row = (await phone.journal.get(rid))!;
  expect(row).toMatchObject({ kind: "highlight", fp: jk.fp });
  expect(JSON.stringify(row)).not.toMatch(/Pretend|pretend/);
  expect(await openJson(jk.key, row, journalAad(rid))).toMatchObject({ note: "Pretend synced note", anchor: { exact: "pretend hill" } });
});

it("an older app version quarantines highlights (no crash), keeps syncing the rest, and applies them after an update", async () => {
  const { server, hl, page } = await serverWithNewerRows();
  const old = await device();
  expect((await syncOnce({ db: old, fetch: server.fetch })).kind).toBe("ok");
  expect(await old.journal.get(page.id)).toBeTruthy(); // the rest still syncs
  expect(await old.journal.get(hl.id)).toBeUndefined();
  expect((await old.quarantine.toArray()).map((q) => q.id)).toEqual([hl.id]);
  expect(await getMeta(old, "cursor")).toBe(server.seq);
  expect((await syncOnce({ db: old, fetch: server.fetch })).kind).toBe("ok");
  expect(await old.pending.count()).toBe(0); // nothing sent back

  older.on = false; // the update
  await syncOnce({ db: old, fetch: server.fetch });
  expect(await old.journal.get(hl.id)).toMatchObject({ kind: "highlight" });
  expect(await old.quarantine.count()).toBe(0);
});

it("an older app version keeps a held highlight in its backup, and a restore there holds it again", async () => {
  const { server, hl } = await serverWithNewerRows();
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear(), db.items.clear(), db.goals.clear(), db.files.clear()]);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  await syncOnce({ db, fetch: server.fetch });
  expect(await db.quarantine.get(["journal", hl.id])).toBeTruthy();
  const file = JSON.parse(JSON.stringify(await exportBackup(DAY)));
  expect(file.journal.map((r: { id: string }) => r.id)).toContain(hl.id);
  await db.quarantine.clear();
  const r = await restoreBackup(file, "merge"); // (Replace is off while sync is on)
  expect(r.kept).toBe(1);
  expect(await db.quarantine.get(["journal", hl.id])).toMatchObject({ id: hl.id });
});
