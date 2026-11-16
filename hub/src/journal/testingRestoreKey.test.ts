// Testing session (restore-safe ripples): after a Replace (new device id) the journal still opens
// with no prompt, a page written after it opens, and a later passphrase change still works on a
// new phone. Fictional passphrases and words only; fake server only.

import Dexie from "dexie";
import { db, HubDB } from "../data/db";
import { exportBackup, restoreBackup } from "../data/backup";
import { finishMorningPage, listReadBack, readMorningPage } from "../data/repo";
import { FakeSyncServer } from "../sync/fakeServer";
import { getDeviceId, saveSyncSettings, stopSyncing, syncOnce } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { confirmJournalKey, loadJournalKey, saveJournalKeyFromSync, unlockJournal } from "./keyStore";

const SERVER = "https://sync.example.test";
const OLD = "pretend-restore-key-old-one";
const NEW = "pretend-restore-key-new-two";
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
const ok = async (d: HubDB, s: FakeSyncServer) => expect((await syncOnce({ db: d, fetch: s.fetch })).kind).toBe("ok");

it("Replace, then a passphrase change: the journal opens on the Mac with no prompt, and on a new phone with the new passphrase", async () => {
  const oldToken = await deriveToken(OLD);
  const server = new FakeSyncServer(oldToken);
  await saveSyncSettings(db, { serverUrl: SERVER, token: oldToken });
  await saveJournalKeyFromSync(db, OLD);
  await ok(db, server);
  expect(await confirmJournalKey(db)).toBe("confirmed");
  const key = (await loadJournalKey(db))!;
  await finishMorningPage(key, "2026-10-01", await getDeviceId(db), "Pretend page before the backup.");
  await ok(db, server);
  const backup = JSON.parse(JSON.stringify(await exportBackup("2026-10-02")));

  await stopSyncing(db);
  await restoreBackup(backup, "replace");
  expect(await confirmJournalKey(db)).toBe("confirmed"); // no prompt
  const after = (await loadJournalKey(db))!;
  await finishMorningPage(after, "2026-10-03", await getDeviceId(db), "Pretend page after the Replace.");
  await saveSyncSettings(db, { serverUrl: SERVER, token: oldToken });
  await ok(db, server);

  // The passphrase changes (sync helper), the new one typed on the Mac.
  const newToken = await deriveToken(NEW);
  (server as unknown as { token: string }).token = newToken;
  await saveSyncSettings(db, { serverUrl: SERVER, token: newToken });
  await saveJournalKeyFromSync(db, NEW);
  await ok(db, server);
  expect(await confirmJournalKey(db)).toBe("confirmed");

  const phone = new HubDB(`testing-restore-key-phone-${Math.random()}`);
  phones.push(phone);
  await saveSyncSettings(phone, { serverUrl: SERVER, token: newToken });
  await saveJournalKeyFromSync(phone, NEW);
  await ok(phone, server);
  const state = await confirmJournalKey(phone);
  expect(state === "confirmed" ? "ok" : await unlockJournal(phone, NEW)).toBe("ok");
  // Both pages read on the Mac (past the Read back lock).
  const pages = await listReadBack();
  const texts = await Promise.all(pages.map((p) => readMorningPage(after, p.id, "2026-11-30")));
  expect(texts.map((t) => (t.state === "ok" ? t.text : t.state)).sort()).toEqual(["Pretend page after the Replace.", "Pretend page before the backup."]);
});
