import Dexie from "dexie";
import { db, HubDB } from "../data/db";
import { finishMorningPage, listReadBack, readMorningPage } from "../data/repo";
import { FakeSyncServer } from "../sync/fakeServer";
import { saveSyncSettings, syncOnce } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { confirmJournalKey, loadJournalKey, saveJournalKeyFromSync, unlockJournal } from "./keyStore";

// Testing session, bug (severity 2; 1 if she no longer remembers the old passphrase):
// what Esme would see: she changes her sync passphrase the documented way (sync/README.md:
// "run the helper again; every device then needs the new passphrase") and types the NEW
// passphrase on her Mac and on a new phone. Sync works on both. But on the new phone the
// Journal stays "Unlock journal", and typing the new passphrase there says "That isn't the
// journal's passphrase". The journal page tells her to "Type your sync passphrase"; only the
// OLD one opens it. Her journal is unreadable on every new device unless she still knows the
// old passphrase. (journal-report.md lists "passphrase changes are still not supported"; the
// sync README and the Journal's unlock text don't say so.)
//
// Cause: the journal key is derived once from the first passphrase and the synced verifier
// row stays sealed with it (keyStore.ts confirmJournalKey: a candidate that doesn't open the
// verifier is retired); there is no re-key flow, so a key from the new passphrase is never
// accepted. Fictional passphrases only.

const SERVER = "https://sync.example.test";
const OLD = "pretend-old-passphrase-one";
const NEW = "pretend-new-passphrase-two";
const DAY = "2026-10-01";
const LATER = "2026-11-04"; // past the 4-week Read back lock
const phones: HubDB[] = [];

beforeEach(async () => {
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.items.clear(), db.goals.clear()]);
});
afterEach(async () => {
  for (const d of phones.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

describe("changing the sync passphrase", () => {
  it("a new phone set up with the NEW passphrase can open the journal with it", async () => {
    const oldToken = await deriveToken(OLD);
    const server = new FakeSyncServer(oldToken);

    // The Mac: sync and journal set up with the old passphrase; one morning page written.
    await saveSyncSettings(db, { serverUrl: SERVER, token: oldToken });
    await saveJournalKeyFromSync(db, OLD);
    expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
    expect(await confirmJournalKey(db)).toBe("confirmed");
    const macKey = (await loadJournalKey(db))!;
    await finishMorningPage(macKey, DAY, "device-mac-0001", "A pretend morning page.");
    expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");

    // She changes the passphrase on the server (the sync helper), and types the new one on the Mac.
    const newToken = await deriveToken(NEW);
    (server as unknown as { token: string }).token = newToken;
    await saveSyncSettings(db, { serverUrl: SERVER, token: newToken });
    await saveJournalKeyFromSync(db, NEW);
    expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");

    // A new phone: the new passphrase on its Sync page; sync works.
    const phone = new HubDB(`testing-pp-phone-${Date.now()}`);
    phones.push(phone);
    await saveSyncSettings(phone, { serverUrl: SERVER, token: newToken });
    await saveJournalKeyFromSync(phone, NEW);
    expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
    expect(await phone.journal.count()).toBeGreaterThan(0); // the sealed rows arrived

    // The journal should open there with the passphrase she now uses.
    const state = await confirmJournalKey(phone);
    const unlock = state === "confirmed" ? "ok" : await unlockJournal(phone, NEW);
    expect(unlock).toBe("ok");
  });

  it("(control) the old page is still readable on the Mac after the change", async () => {
    const oldToken = await deriveToken(OLD);
    const server = new FakeSyncServer(oldToken);
    await saveSyncSettings(db, { serverUrl: SERVER, token: oldToken });
    await saveJournalKeyFromSync(db, OLD);
    await syncOnce({ db, fetch: server.fetch });
    expect(await confirmJournalKey(db)).toBe("confirmed");
    const jk = (await loadJournalKey(db))!;
    await finishMorningPage(jk, DAY, "device-mac-0001", "A pretend morning page.");
    const [page] = await listReadBack();
    expect(await readMorningPage(jk, page!.id, LATER)).toEqual({ state: "ok", text: "A pretend morning page." });
  });
});
