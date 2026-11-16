import Dexie from "dexie";
import { HubDB } from "../data/db";
import { FakeSyncServer } from "../sync/fakeServer";
import { saveSyncSettings, syncOnce } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { confirmJournalKey, giveOldPassphrase, journalNeedsOldPassphrase, loadJournalKeyInfo, saveJournalKeyFromSync } from "./keyStore";
import { JOURNAL_KEY_META } from "./keyStore";
import { confirmedDevice, keyFor } from "../test/journalKey";

// Testing session, bug (severity 3: annoying, never a lock-out; B or A both still work).
// What Esme would see: she changes the passphrase the README way. On the Mac she types the new
// one and answers "Type your old passphrase once". Then she types the new one on her phone
// (journal already open there, set up before this update) while the phone is offline or on a
// slow connection. Everything works. At the NEXT passphrase change, if she does the phone first,
// the phone asks "Type your old passphrase once" again, although she already did the change
// there and the phone had everything it needed (her passphrase's KEK and the synced wrap).
//
// Cause: keyStore.ts. The phone's candidate is retired before the Mac's wrap arrives
// (confirmJournalKey line 398). When the wrap then arrives, writeAcceptedKeyWrap (lines 477-485)
// opens it with the pending KEK, sees it holds this journal's secret, and only drops the pending
// wrap: the secret inside is never kept as this device's copy of S. The pending-wrap path that
// would keep it (lines 424-433) only runs on a device with no confirmed key. With a fast
// connection the sync usually lands before the key is made and S is kept, so this depends on
// timing; offline at Save it always happens. Fictional passphrases only.

const SERVER = "https://sync.example.test";
const A = "pretend-again-passphrase-alpha";
const B = "pretend-again-passphrase-bravo";
const C = "pretend-again-passphrase-charlie";

let n = 0;
const open: HubDB[] = [];
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});
function device() {
  const d = new HubDB(`testing-rekey-again-${++n}`);
  open.push(d);
  return d;
}
const changeServer = (server: FakeSyncServer, token: string) => ((server as unknown as { token: string }).token = token);
const sync = async (d: HubDB, server: FakeSyncServer) => (await syncOnce({ db: d, fetch: server.fetch })).kind;

/** A device set up before the update: journal open with A (no copy of S), synced. */
async function preUpdate(server: FakeSyncServer) {
  const d = device();
  await saveSyncSettings(d, { serverUrl: SERVER, token: await deriveToken(A) });
  const jk = await keyFor(A);
  await confirmedDevice(d, jk);
  expect(await sync(d, server)).toBe("ok");
  await d.syncMeta.put({ key: JOURNAL_KEY_META, value: { ...jk, id: crypto.randomUUID() } });
  return d;
}

it("a phone that took the new passphrase while offline keeps the journal secret from the wrap, so the next change doesn't ask again", async () => {
  const server = new FakeSyncServer(await deriveToken(A));
  const mac = await preUpdate(server);
  const phone = await preUpdate(server);

  // Change 1 (A -> B), README order: the Mac first, with the one-time prompt.
  changeServer(server, await deriveToken(B));
  await saveSyncSettings(mac, { serverUrl: SERVER, token: await deriveToken(B) });
  await saveJournalKeyFromSync(mac, B);
  expect(await sync(mac, server)).toBe("ok");
  expect(await journalNeedsOldPassphrase(mac)).toBe(true);
  expect(await giveOldPassphrase(mac, A)).toBe("ok");
  expect(await sync(mac, server)).toBe("ok"); // B's wrap is on the server

  // Then the phone, offline when she presses Save; it syncs a little later.
  await saveSyncSettings(phone, { serverUrl: SERVER, token: await deriveToken(B) });
  server.inject({ networkError: true });
  const saving = saveJournalKeyFromSync(phone, B);
  expect(await sync(phone, server)).toBe("offline");
  await saving;
  expect(await sync(phone, server)).toBe("ok");
  expect(await confirmJournalKey(phone)).toBe("confirmed");
  expect(await journalNeedsOldPassphrase(phone)).toBe(false); // no prompt for this change: fine

  // The phone opened B's wrap (it holds the journal secret) and should now keep its copy of S.
  expect((await loadJournalKeyInfo(phone))!.s).toBeDefined();

  // Change 2 (B -> C), phone first: no "Type your old passphrase once" again.
  changeServer(server, await deriveToken(C));
  await saveSyncSettings(phone, { serverUrl: SERVER, token: await deriveToken(C) });
  await saveJournalKeyFromSync(phone, C);
  expect(await sync(phone, server)).toBe("ok");
  expect(await journalNeedsOldPassphrase(phone)).toBe(false);
}, 60_000);
