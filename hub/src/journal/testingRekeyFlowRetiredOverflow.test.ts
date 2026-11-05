import Dexie from "dexie";
import { HubDB } from "../data/db";
import { FakeSyncServer } from "../sync/fakeServer";
import { saveSyncSettings, syncOnce } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { journalAad, openJson, sealJson, type JournalKey } from "./crypto";
import { confirmJournalKey, giveOldPassphrase, JOURNAL_KEY_META, loadJournalKey, saveJournalKeyFromSync } from "./keyStore";
import { confirmedDevice, keyFor, verifierRow } from "../test/journalKey";

// Testing session, bug (severity 1 when it happens: journal pages lost; needs a phone already in
// the bug #4 state, two keys in use, so it is uncommon).
// What Esme would see: her phone had written some journal pages with the "losing" key (bug #4).
// After the update the phone shows "Unlock journal" (the defensive verifier check). She is in the
// middle of a passphrase change, sync keeps refusing, and she tries a few spellings on the phone's
// Sync page, then the new passphrase before the Mac has carried the journal over. When the journal
// then opens on the phone (by itself, once the Mac's wrap arrives), the pages the phone wrote with
// the losing key never open again, on any device: they count as "can't be opened" for good.
//
// Cause: keyStore.ts keeps only MAX_RETIRED = 5 retired keys (line 75, retireKeyIn 188-192). Every
// Sync page Save whose passphrase doesn't open the journal (a typo refused by the server, or the
// new passphrase before its wrap exists) is retired too (retireCandidateIn 195-202, called from
// confirmJournalKey 398 and the engine's 401). Those keys never sealed anything, but they push
// the losing key, the ONLY key that can open those pages for the repair pass (repairJournal
// 621-631), off the list. Fictional passphrases only.

const SERVER = "https://sync.example.test";
const A = "pretend-overflow-passphrase-alpha"; // the journal's own passphrase (the winner)
const LOSER = "pretend-overflow-passphrase-loser"; // the key bug #4 left on the phone
const B = "pretend-overflow-passphrase-bravo"; // the new sync passphrase
const TYPOS = ["pretend-overflow-passphrase-brav0", "pretend-overflow-passphrase-Bravo", "pretend-overflow-passphrase-bravo ", "pretend-overflow-pasphrase-bravo"];
const DAY = "2026-10-01";

let n = 0;
const open: HubDB[] = [];
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});
function device() {
  const d = new HubDB(`testing-rekey-overflow-${++n}`);
  open.push(d);
  return d;
}
const changeServer = (server: FakeSyncServer, token: string) => ((server as unknown as { token: string }).token = token);
async function savePassphrase(d: HubDB, server: FakeSyncServer, passphrase: string) {
  await saveSyncSettings(d, { serverUrl: SERVER, token: await deriveToken(passphrase) });
  await saveJournalKeyFromSync(d, passphrase);
  const kind = (await syncOnce({ db: d, fetch: server.fetch })).kind;
  await confirmJournalKey(d); // the Sync page does this after its sync
  return kind;
}
async function writePage(d: HubDB, jk: JournalKey, text: string, suffix: string) {
  const id = `page:${DAY}:${suffix}`;
  await d.journal.put({ id, kind: "page", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text, at: 1 }, journalAad(id))) });
  return id;
}

it("pages sealed with the bug #4 losing key are repaired after a passphrase change with a few refused tries on the phone", async () => {
  const server = new FakeSyncServer(await deriveToken(A));
  // The Mac: the journal's real key (A), set up before the update, synced.
  const mac = device();
  await saveSyncSettings(mac, { serverUrl: SERVER, token: await deriveToken(A) });
  await confirmedDevice(mac, await keyFor(A));
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");

  // The phone, in the bug #4 state: confirmed with the losing key, one page sealed with it.
  const phone = device();
  await saveSyncSettings(phone, { serverUrl: SERVER, token: await deriveToken(A) });
  const loser = await keyFor(LOSER);
  await phone.syncMeta.put({ key: JOURNAL_KEY_META, value: { ...loser, id: crypto.randomUUID() } });
  const page = await writePage(phone, loser, "A pretend page the phone wrote with the losing key.", "phone");
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok"); // the Mac's verifier arrives
  expect(await confirmJournalKey(phone)).toBe("locked"); // defensive check: "Unlock journal"

  // She changes the passphrase. On the phone's Sync page sync keeps refusing what she types…
  changeServer(server, await deriveToken(B));
  for (const t of TYPOS) expect(await savePassphrase(phone, server, t)).toBe("needs-passphrase");
  // …then the right one, before the Mac has carried the journal over (README allows that order).
  expect(await savePassphrase(phone, server, B)).toBe("ok");
  expect(await confirmJournalKey(phone)).toBe("locked");

  // The Mac takes the new passphrase (it writes B's wrap); the phone's journal opens by itself.
  expect(await savePassphrase(mac, server, B)).toBe("ok");
  if (!(await mac.journal.where("kind").equals("keywrap").count())) await giveOldPassphrase(mac, A);
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  expect(await confirmJournalKey(phone)).toBe("confirmed");

  // The repair pass should have re-sealed the phone's page with the journal key.
  const jk = (await loadJournalKey(phone))!;
  const row = (await phone.journal.get(page))!;
  expect(row.fp).toBe(jk.fp);
  expect((await openJson<{ text: string }>(jk.key, row, journalAad(page))).text).toBe("A pretend page the phone wrote with the losing key.");
}, 60_000);
