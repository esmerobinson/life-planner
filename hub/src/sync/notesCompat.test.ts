import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { saveNote, setNoteRead } from "../data/repo";
import type { JournalRow } from "../domain/types";
import { journalAad, openJson, sealJson, type JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { FakeSyncServer } from "./fakeServer";
import { getMeta, saveSyncSettings, syncOnce } from "./engine";

// Notes to myself are new journal kinds ("note", "note-read"). An app version from before them
// (simulated: its validJournal refuses those kinds, as the previous release's does) must hold
// them in quarantine, keep syncing everything else, and apply them after an update. Fictional
// words only.

const older = vi.hoisted(() => ({ on: true }));
vi.mock("../data/validate", async (importOriginal) => {
  const real = await importOriginal<typeof import("../data/validate")>();
  return {
    ...real,
    validJournal: (r: unknown): r is JournalRow =>
      real.validJournal(r) && !(older.on && ["note", "note-read"].includes((r as { kind?: string }).kind ?? "")),
  };
});

const TOKEN = "b07e".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const DAY = "2026-11-04";
let jk: JournalKey;
let n = 0;
const open: HubDB[] = [];
beforeAll(async () => {
  jk = await keyFor("fake-journal-notes-compat");
});
afterEach(async () => {
  older.on = true;
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function sealed(kind: JournalRow["kind"], id: string, entry: unknown): Promise<JournalRow> {
  return { id, kind, date: DAY, fp: jk.fp, ...(await sealJson(jk.key, entry, journalAad(id))), updatedAt: 0 };
}

async function serverWithNewerRows() {
  const note = await sealed("note", `note:${DAY}:3f2a1b4c-0000-4000-8000-000000000003`, {
    v: 1, prompt: null, thought: "Pretend thought", steady: "Pretend steady words", memory: "", skill: "", createdAt: 1, at: 1,
  });
  const read = await sealed("note-read", `note-read:${DAY}:device-phone-01`, { v: 1, ids: [note.id], at: 2 });
  const page = await sealed("page", `page:${DAY}:3f2a1b4c-0000-4000-8000-000000000004`, { v: 1, text: "Pretend page", at: 3 });
  const server = new FakeSyncServer(TOKEN);
  const changes = [note, read, page].map((r, i) => ({ table: "journal", id: r.id, updatedAt: 10 + i, data: { ...r, updatedAt: 10 + i } }));
  await server.fetch(`${SERVER}/v1/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ deviceId: "newer-device-1", cursor: 0, changes }),
  });
  return { server, note, read, page };
}

async function device() {
  const d = new HubDB(`notes-compat-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

it("this version: a note and its read tick sync to another device, sealed, and open there", async () => {
  older.on = false;
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear()]);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  await confirmedDevice(db, jk);
  const server = new FakeSyncServer(TOKEN);
  const id = await saveNote(jk, DAY, { prompt: null, thought: "Pretend synced thought", steady: "Pretend synced answer", memory: "", skill: "" });
  await setNoteRead(jk, DAY, "device-mac-0001", id, true);
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  const phone = await device();
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  const row = (await phone.journal.get(id))!;
  expect(row).toMatchObject({ kind: "note", fp: jk.fp });
  expect(JSON.stringify(row)).not.toContain("Pretend");
  expect(await openJson(jk.key, row, journalAad(id))).toMatchObject({ thought: "Pretend synced thought", steady: "Pretend synced answer" });
  expect(await phone.journal.get(`note-read:${DAY}:device-mac-0001`)).toBeTruthy();
});

it("an older app version quarantines notes (no crash), keeps syncing the rest, and applies them after an update", async () => {
  const { server, note, read, page } = await serverWithNewerRows();
  const old = await device();
  expect((await syncOnce({ db: old, fetch: server.fetch })).kind).toBe("ok");
  expect(await old.journal.get(page.id)).toBeTruthy(); // the rest still syncs
  expect(await old.journal.get(note.id)).toBeUndefined();
  expect(await old.journal.get(read.id)).toBeUndefined();
  expect((await old.quarantine.toArray()).map((q) => q.id).sort()).toEqual([note.id, read.id].sort());
  expect(await getMeta(old, "cursor")).toBe(server.seq);
  // A second sync is still fine (nothing fatal, nothing sent back).
  expect((await syncOnce({ db: old, fetch: server.fetch })).kind).toBe("ok");
  expect(await old.pending.count()).toBe(0);

  older.on = false; // the update
  await syncOnce({ db: old, fetch: server.fetch });
  expect(await old.journal.get(note.id)).toMatchObject({ kind: "note" });
  expect(await old.journal.get(read.id)).toMatchObject({ kind: "note-read" });
  expect(await old.quarantine.count()).toBe(0);
});
