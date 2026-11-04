// Testing session (journal-v3, Notes to myself + backups): what Esme would see.
// She has a note, makes a backup, then improves the note on the Mac (synced, so the phone has
// the newer words too). Later she restores the older backup with Replace (Replace needs sync
// off, so she turns sync off first). The note shows the backup's older words, as Replace says.
// Before turning sync back on she changes that note again. When sync comes back on, her newer
// words from before the restore are gone from the Mac AND from the phone: no "Another version",
// nothing. (Without the edit in between, sync would have brought them back.)
// Cause: each device keeps ONE version row per note (`note:<date>:<nid>_<deviceId>`), and a
// row is assumed to always have been seen by the device that writes it again. After Replace
// that's not true: the Mac's new version is written over its own newer row on the server
// (plain last-write-wins on the same row id), though it never saw those words.
// Fictional words only; fake server only.

import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { exportBackup, restoreBackup } from "../data/backup";
import { listNotes, saveNote } from "../data/repo";
import type { JournalRow } from "../domain/types";
import { journalAad, openJson, type JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { FakeSyncServer } from "./fakeServer";
import { getDeviceId, saveSyncSettings, stopSyncing, syncOnce } from "./engine";

const TOKEN = "c0de".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const DAY = "2026-11-04";
const NOTE = { prompt: null, thought: "Pretend worry", memory: "", skill: "" };
let jk: JournalKey;
const open: HubDB[] = [];
beforeAll(async () => {
  jk = await keyFor("fake-journal-testing-v3-replace");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear(), db.items.clear(), db.goals.clear(), db.files.clear()]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

const later = () => new Promise((r) => setTimeout(r, 5));

/** Every note word on a device, opened (any version, deleted or not). */
async function allNoteWords(d: HubDB): Promise<string> {
  const rows = (await d.journal.where("kind").equals("note").toArray()) as JournalRow[];
  const opened = await Promise.all(rows.map((r) => openJson(jk.key, r, journalAad(r.id))));
  return JSON.stringify(opened);
}

it("Replace an older backup, edit that note, sync on again: the newer words from before the restore are kept somewhere", async () => {
  const server = new FakeSyncServer(TOKEN);
  await confirmedDevice(db, jk);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  const mac = await getDeviceId(db);

  const id = await saveNote(jk, DAY, mac, { ...NOTE, steady: "Pretend first words" });
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  const backup = JSON.parse(JSON.stringify(await exportBackup(DAY)));

  await later();
  await saveNote(jk, DAY, mac, { ...NOTE, steady: "Pretend newer words" }, { id, seen: (await listNotes(jk)).notes[0]!.seen });
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  // The phone has the newer words.
  const phone = new HubDB(`testing-v3-replace-phone-${Math.random()}`);
  open.push(phone);
  await saveSyncSettings(phone, { serverUrl: SERVER, token: TOKEN });
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  expect(await allNoteWords(phone)).toContain("Pretend newer words");

  // Replace (sync off first, as the Backup page asks).
  await stopSyncing(db);
  await restoreBackup(backup, "replace");
  expect((await listNotes(jk)).notes.map((n) => n.steady)).toEqual(["Pretend first words"]);

  // She changes the note, then turns sync back on.
  await later();
  await saveNote(jk, DAY, mac, { ...NOTE, steady: "Pretend after the restore" }, { id, seen: (await listNotes(jk)).notes[0]!.seen });
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");

  const [n] = (await listNotes(jk)).notes;
  expect(n!.steady).toBe("Pretend after the restore");
  // Fails: the Mac's newer words were written over on the server, then on the phone.
  const shownOnMac = [n!.steady, ...n!.others.map((o) => o.steady)];
  expect(shownOnMac).toContain("Pretend newer words");
  expect(await allNoteWords(phone)).toContain("Pretend newer words");
});
