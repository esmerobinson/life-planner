import Dexie from "dexie";
import { db, HubDB } from "../data/db";
import { exportBackup, FOREIGN_JOURNAL_BACKUP, restoreBackup } from "../data/backup";
import { FakeSyncServer } from "../sync/fakeServer";
import { saveSyncSettings, stopSyncing, syncOnce } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { journalAad, sealJson } from "./crypto";
import { confirmJournalKey, loadJournalKey, saveJournalKeyFromSync, unlockJournal } from "./keyStore";
import { keyFor, verifierRow } from "../test/journalKey";

// Testing session (journal-rekey check), bug (severity 1: locked out on every device; unlikely,
// needs a backup of ANOTHER journal; builder's concern 3 made concrete).
//
// What Esme would see: on the Mac she stops syncing and restores, with Replace, a backup that
// turns out to be from another journal (one made with another passphrase, e.g. an old or test
// set-up, whose check row was written after hers). The Mac's Journal goes to "Unlock journal".
// She turns sync back on (her passphrase on the Sync page). Now her PHONE, which she never
// touched, also goes to "Unlock journal", and her passphrase there says "That passphrase doesn't
// open your journal". She notices, stops syncing on the Mac and restores her own latest backup
// with Replace: the Mac opens with her passphrase, but as soon as sync is on again it locks
// again, and so does every device, new ones too. Her passphrase never opens the journal again
// anywhere. Nothing is deleted, but nothing can be read. (On the live build the Mac and phone
// kept their key and kept working; only a new device couldn't open it.)
//
// Cause: keyStore.ts confirmJournalKey (~367-376) retires a confirmed key whenever it can't open
// the synced verifier row, and unlockJournal (~586-595) accepts only a passphrase that opens it.
// The stray verifier is newer, so it wins last-write-wins on the server (engine.ts applyRow) and
// beats her own backup's older verifier every time; no device can write her journal's verifier
// back (confirmJournalKey only writes one when there is none, ~378). Fictional passphrases.

const SERVER = "https://sync.example.test";
const A = "fake-rekey-stray-backup-alpha";
const OTHER = "fake-rekey-stray-backup-other-journal";
const DAY = "2026-10-01";
const phones: HubDB[] = [];

beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear(), db.quarantine.clear()]);
});
afterEach(async () => {
  for (const d of phones.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function turnSyncOn(d: HubDB) {
  await saveSyncSettings(d, { serverUrl: SERVER, token: await deriveToken(A) });
  await saveJournalKeyFromSync(d, A);
}

it("a Replace restore of another journal's backup never locks her out of her own journal for good", async () => {
  const server = new FakeSyncServer(await deriveToken(A));

  // The Mac (the app's own database): journal set up with A, a page written, synced.
  await turnSyncOn(db);
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect(await confirmJournalKey(db)).toBe("confirmed");
  const jk = (await loadJournalKey(db))!;
  const id = `page:${DAY}:p1`;
  await db.journal.put({ id, kind: "page", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text: "Mine.", at: 1 }, journalAad(id))) });
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  const ownBackup = await exportBackup("2026-10-02");

  // The phone: set up with A, journal open.
  const phone = new HubDB(`testing-rekey-stray-phone-${Date.now()}`);
  phones.push(phone);
  await turnSyncOn(phone);
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  expect(await confirmJournalKey(phone)).toBe("confirmed");

  // A backup of another journal (its check row written after hers), restored on the Mac by mistake.
  const stray = { ...ownBackup, items: [], goals: [], files: [], journal: [{ ...(await verifierRow(await keyFor(OTHER))), updatedAt: Date.now() + 60_000 }] };
  await stopSyncing(db);
  // Core (fix round 2): Replace now refuses another journal's backup outright (FOREIGN_JOURNAL_BACKUP),
  // so the stray verifier never lands; the rest of the story must still end with both devices open.
  await expect(restoreBackup(JSON.stringify(stray), "replace")).rejects.toThrow(FOREIGN_JOURNAL_BACKUP);
  await turnSyncOn(db);
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  const phoneAfterStray = await confirmJournalKey(phone);

  // She notices and puts her own latest backup back with Replace, then turns sync on again.
  await stopSyncing(db);
  await restoreBackup(JSON.stringify(ownBackup), "replace");
  expect(await unlockJournal(db, A)).toBe("ok"); // opens, for now
  await turnSyncOn(db);
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");

  // Her own passphrase must open her own journal again, on the phone and on the Mac.
  const phoneState = await confirmJournalKey(phone);
  const phoneUnlock = phoneState === "confirmed" ? "ok" : await unlockJournal(phone, A);
  const macState = await confirmJournalKey(db);
  const macUnlock = macState === "confirmed" ? "ok" : await unlockJournal(db, A);
  expect({ phoneUnlock, macUnlock }, `phone right after the stray restore: "${phoneAfterStray}"`).toEqual({ phoneUnlock: "ok", macUnlock: "ok" });
});
