import Dexie from "dexie";
import { HubDB } from "../data/db";
import { FakeSyncServer } from "../sync/fakeServer";
import { saveSyncSettings, syncOnce } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { journalAad, openJson, sealJson } from "./crypto";
import { confirmJournalKey, loadJournalKey, saveJournalKeyFromSync } from "./keyStore";

// Testing session (journal-rekey check), bug (severity 3: she must type the passphrase twice;
// rare: the journal was set up on the Mac just before it went offline).
//
// What Esme would see: she sets the journal up on the Mac and writes a page, and the Mac goes
// offline before its next sync. She changes the sync passphrase (helper) and types the new one
// on her phone, whose journal opens and gets used. When the Mac is back, sync asks for the
// passphrase; she types the new one on the Mac's Sync page and it syncs. The Mac's Journal now
// says "Unlock journal", although the passphrase she just typed opens it (typing it again in
// Unlock works and her Mac page comes back, also on the phone). Until then the phone shows
// "Can't open this entry on this device" for the Mac's page.
//
// Cause: keyStore.ts confirmJournalKey (~387-399): at Save, the new passphrase's candidate is
// checked against the Mac's own, not yet sent, verifier and retired. The sync then brings the
// phone's newer verifier (last write wins), the Mac's confirmed key is retired (~367-376), and
// afterwards only the pending wrap's KEK is tried against the new verifier (~424-433), never
// the passphrase's own key, which opens it. Nothing is lost. Fictional passphrases only.

const SERVER = "https://sync.example.test";
const A = "fake-rekey-split-first-alpha";
const B = "fake-rekey-split-first-bravo";
const DAY = "2026-10-01";
const open: HubDB[] = [];
let n = 0;
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});
const device = () => {
  const d = new HubDB(`testing-rekey-split-${++n}-${Date.now()}`);
  open.push(d);
  return d;
};
const changeServer = (s: FakeSyncServer, t: string) => ((s as unknown as { token: string }).token = t);

it("the Mac opens the journal with the new passphrase it was just given, once it has synced", async () => {
  const server = new FakeSyncServer(await deriveToken(A));
  const mac = device();
  await saveSyncSettings(mac, { serverUrl: SERVER, token: await deriveToken(A) });
  await saveJournalKeyFromSync(mac, A);
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
  expect(await confirmJournalKey(mac)).toBe("confirmed"); // its verifier is written, not sent yet
  const jk = (await loadJournalKey(mac))!;
  const page = `page:${DAY}:m1`;
  await mac.journal.put({ id: page, kind: "page", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text: "Mac page.", at: 1 }, journalAad(page))) });
  // The Mac is offline from here. The passphrase changes; the phone is set up with B and used.
  changeServer(server, await deriveToken(B));
  const phone = device();
  await saveSyncSettings(phone, { serverUrl: SERVER, token: await deriveToken(B) });
  await saveJournalKeyFromSync(phone, B);
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  expect(await confirmJournalKey(phone)).toBe("confirmed");
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");

  // The Mac is back: refused, she types B on its Sync page, it syncs (twice, to settle).
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("needs-passphrase");
  await saveSyncSettings(mac, { serverUrl: SERVER, token: await deriveToken(B) });
  await saveJournalKeyFromSync(mac, B);
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");

  expect(await confirmJournalKey(mac)).toBe("confirmed");
  const now = (await loadJournalKey(mac))!;
  expect((await openJson<{ text: string }>(now.key, (await mac.journal.get(page))!, journalAad(page))).text).toBe("Mac page.");
});
