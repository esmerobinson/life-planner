// Testing session (restore-safe ripples): a note she started but never saved, after a Replace.
// What Esme would see: she had begun a new note on the Mac (draft A, in the backup), then typed
// on (B, synced). She restores the older backup with Replace (sync off), opens the note in
// progress, and Cancels it (or types on). Sync comes back on: B arrives, and since fix round 1
// (I2) it shows in Notes as a note of its own. She opens it and presses Delete, then "Delete it":
// "couldn't save" (SAVE_PROBLEM) and the note stays. It can only go by saving it first.
// Cause: listNotes shows the former-id draft as a version of the note, but deleteNote (noteRows)
// counts only saved version rows: with none, it throws "That note isn't here."
// Fictional words only; fake server only.

import Dexie from "dexie";
import { db, HubDB } from "../data/db";
import { exportBackup, restoreBackup } from "../data/backup";
import { clearNoteDraft, deleteNote, listNotes, saveNoteDraft } from "../data/repo";
import type { JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { FakeSyncServer } from "./fakeServer";
import { getDeviceId, saveSyncSettings, stopSyncing, syncOnce } from "./engine";

const TOKEN = "de1e".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const DAY = "2026-11-05";
const NOTE_ID = `note:${DAY}:0123456789abcdef`;
const NOTE = { prompt: null, thought: "Pretend thought", memory: "", skill: "" };
let jk: JournalKey;
const open: HubDB[] = [];
beforeAll(async () => {
  jk = await keyFor("fake-journal-restore-note-delete");
});
beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear(), db.items.clear(), db.goals.clear(), db.files.clear()]);
});
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});
const later = () => new Promise((r) => setTimeout(r, 5));
const ok = async (d: HubDB, s: FakeSyncServer) => expect((await syncOnce({ db: d, fetch: s.fetch })).kind).toBe("ok");

async function story(after: (device: string) => Promise<void>) {
  const server = new FakeSyncServer(TOKEN);
  await confirmedDevice(db, jk);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  const mac = await getDeviceId(db);
  await saveNoteDraft(jk, mac, NOTE_ID, { ...NOTE, steady: "Pretend draft A" }, []);
  await ok(db, server);
  const backup = JSON.parse(JSON.stringify(await exportBackup(DAY)));
  await later();
  await saveNoteDraft(jk, mac, NOTE_ID, { ...NOTE, steady: "Pretend draft B newer" }, []);
  await ok(db, server);
  await stopSyncing(db);
  await restoreBackup(backup, "replace");
  await later();
  await after(await getDeviceId(db));
  await later();
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  await ok(db, server);
}

/** What the page's Delete sends for a note in the list (NotesToMyself edit(): her draft's seen, else the version shown). */
async function pressDelete(me: string) {
  const { notes, drafts } = await listNotes(jk, me);
  const note = notes.find((n) => n.id === NOTE_ID)!;
  expect(note).toBeDefined(); // the newer words B show as a note in the list
  const d = drafts.find((x) => x.id === NOTE_ID);
  await deleteNote(jk, me, NOTE_ID, d ? d.seen : note.seen);
}

describe("a never-saved note whose newer draft synced in after a Replace shows in the list; Delete works on it", () => {
  it("after Cancel of the restored draft", async () => {
    await story(async (me) => {
      const [draft] = (await listNotes(jk, me)).drafts;
      await clearNoteDraft(jk, me, NOTE_ID, draft!.seen);
    });
    const me = await getDeviceId(db);
    await pressDelete(me);
    expect((await listNotes(jk, me)).notes.map((n) => n.id)).not.toContain(NOTE_ID);
  });

  it("after typing on the restored draft (still in progress)", async () => {
    await story(async (me) => {
      const [draft] = (await listNotes(jk, me)).drafts;
      await saveNoteDraft(jk, me, NOTE_ID, { ...NOTE, steady: "Pretend draft A typed on" }, draft!.seen);
    });
    await pressDelete(await getDeviceId(db));
  });
});
