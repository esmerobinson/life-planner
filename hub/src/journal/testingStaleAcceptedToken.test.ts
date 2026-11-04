import Dexie from "dexie";
import { db, HubDB } from "../data/db";
import { FakeSyncServer } from "../sync/fakeServer";
import { saveSyncSettings, syncOnce } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { confirmJournalKey, loadJournalKeyInfo, saveJournalKeyFromSync, unlockJournal } from "./keyStore";

// Testing session, bug (severity 2): two devices end up sealing the journal with two
// different keys, so each says "Can't open this entry on this device" for the other's entries.
//
// What Esme would see: she changes her sync passphrase (sync/README.md says she may) and sets
// the journal up on her phone with the new one. Her Mac, which had not synced since and had
// never opened the journal, still has the old passphrase saved on its Sync page. On the Mac
// she opens the Journal and types that saved (old) passphrase: the journal opens. Later the
// Mac's sync asks for the passphrase again, she types the new one, and sync carries on. From
// then on the Mac and the phone each write entries the other can't open.
//
// Cause: keyStore.ts confirmJournalKey rule (b) confirms a key when "the server accepted this
// token" using `acceptedToken` from ANY earlier run (engine.ts sets it at the end of a run and
// nothing ever clears it), so a token the server has since stopped accepting still confirms
// a journal key. Afterwards the Mac's verifier (sealed with the old key) wins last-write-wins
// on the server, and the phone's confirmed key is never re-checked against it. Fictional
// passphrases only.

const SERVER = "https://sync.example.test";
const OLD = "pretend-old-passphrase-three";
const NEW = "pretend-new-passphrase-four";
const dbs: HubDB[] = [];
let clock = 1_800_000_000_000;

beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => (clock += 1000));
  await Promise.all([db.journal.clear(), db.pending.clear(), db.syncMeta.clear()]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of dbs.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

it("after a passphrase change, the Mac and the phone never end up on different journal keys", async () => {
  const oldToken = await deriveToken(OLD);
  const newToken = await deriveToken(NEW);
  const server = new FakeSyncServer(oldToken);

  // Both devices synced with the old passphrase before the journal was ever used.
  const mac = new HubDB(`testing-stale-mac-${clock}`);
  const phone = new HubDB(`testing-stale-phone-${clock}`);
  dbs.push(mac, phone);
  await saveSyncSettings(mac, { serverUrl: SERVER, token: oldToken });
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");

  // The passphrase is changed on the server; the phone is set up with the new one and opens the journal.
  (server as unknown as { token: string }).token = newToken;
  await saveSyncSettings(phone, { serverUrl: SERVER, token: newToken });
  await saveJournalKeyFromSync(phone, NEW);
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  expect(await confirmJournalKey(phone)).toBe("confirmed");
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok"); // its verifier goes up

  // The Mac has not synced since. She opens its Journal and types the passphrase its Sync page still has.
  const macUnlock = await unlockJournal(mac, OLD);

  // Then the Mac's sync is refused, she types the new passphrase there, and both devices sync.
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("needs-passphrase");
  await saveSyncSettings(mac, { serverUrl: SERVER, token: newToken });
  await saveJournalKeyFromSync(mac, NEW);
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  await confirmJournalKey(mac);
  await confirmJournalKey(phone);

  const macKey = await loadJournalKeyInfo(mac);
  const phoneKey = await loadJournalKeyInfo(phone);
  // Whatever the Mac's unlock answered, the two devices must not seal with different keys.
  const confirmedKeys = [macKey?.fp, phoneKey?.fp].filter((fp): fp is string => fp !== undefined);
  expect(new Set(confirmedKeys).size, `Mac unlock said "${macUnlock}"; keys ${confirmedKeys.join(" vs ")}`).toBeLessThanOrEqual(1);
});
