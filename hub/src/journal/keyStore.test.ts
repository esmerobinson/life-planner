import Dexie from "dexie";
import { HubDB } from "../data/db";
import { deriveToken } from "../sync/token";
import { FakeSyncServer } from "../sync/fakeServer";
import { saveSyncSettings, syncOnce } from "../sync/engine";
import { journalAad, sealJson } from "./crypto";
import { JOURNAL_KEY_META, loadJournalKey, saveJournalKeyFromSync, unlockJournal } from "./keyStore";

// The journal key on a device (journal brief §3): made from the sync passphrase, checked
// before it is kept, stored as a non-extractable CryptoKey, never the passphrase.

const PASS = "pretend sync passphrase";
const SERVER = "https://sync.example.test";
let token: string;
beforeAll(async () => {
  token = await deriveToken(PASS);
});

let n = 0;
const open: HubDB[] = [];
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});
function device() {
  const d = new HubDB(`journal-key-${++n}`);
  open.push(d);
  return d;
}

describe("unlock journal", () => {
  it("with this device's sync token: the right passphrase stores a key; a wrong one stores nothing", async () => {
    const d = device();
    await saveSyncSettings(d, { serverUrl: SERVER, token });
    expect(await unlockJournal(d, "pretend sync passphrasE")).toBe("wrong");
    expect(await unlockJournal(d, "")).toBe("wrong");
    expect(await loadJournalKey(d)).toBeUndefined();
    expect(await unlockJournal(d, PASS)).toBe("ok");
    const key = await loadJournalKey(d);
    expect(key).toBeInstanceOf(CryptoKey);
    expect(key!.extractable).toBe(false);
    // The passphrase is nowhere in the database.
    const meta = await d.syncMeta.toArray();
    expect(JSON.stringify(meta)).not.toContain(PASS);
  });

  it("the stored key survives closing and reopening the database, and still works", async () => {
    const d = device();
    await saveSyncSettings(d, { serverUrl: SERVER, token });
    await unlockJournal(d, PASS);
    const sealed = await sealJson((await loadJournalKey(d))!, { a: 1 }, "x");
    d.close();
    const again = new HubDB(d.name);
    open.push(again);
    const key = await loadJournalKey(again);
    expect(key).toBeInstanceOf(CryptoKey);
    const { openJson } = await import("./crypto");
    expect(await openJson(key!, sealed, "x")).toEqual({ a: 1 });
  });

  it("without a token: nothing to check against (set up sync first), or an entry here must open", async () => {
    const d = device();
    expect(await unlockJournal(d, PASS)).toBe("no-sync");
    expect(await loadJournalKey(d)).toBeUndefined();
    // An entry from this passphrase arrives (e.g. a restored backup).
    const { deriveJournalKey } = await import("./crypto");
    const id = "morning:2026-10-28";
    const sealed = await sealJson(await deriveJournalKey(PASS), { v: 1, text: "Pretend", pages: 1, photos: [] }, journalAad(id));
    await d.journal.add({ id, kind: "morning", date: "2026-10-28", ...sealed });
    expect(await unlockJournal(d, "pretend typo")).toBe("wrong");
    expect(await loadJournalKey(d)).toBeUndefined();
    expect(await unlockJournal(d, PASS)).toBe("ok");
    expect(await loadJournalKey(d)).toBeInstanceOf(CryptoKey);
  });
});

describe("the Sync page's Save and a refused passphrase", () => {
  it("Save stores the key tied to the new token; a 401 for that token forgets both", async () => {
    const d = device();
    const server = new FakeSyncServer(token);
    const typo = await deriveToken("pretend typo");
    await saveSyncSettings(d, { serverUrl: SERVER, token: typo });
    await saveJournalKeyFromSync(d, "pretend typo");
    expect(await loadJournalKey(d)).toBeInstanceOf(CryptoKey);
    expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("needs-passphrase");
    expect(await loadJournalKey(d)).toBeUndefined();
  });

  it("a key checked against entries (not a token) is kept after a 401", async () => {
    const d = device();
    await d.syncMeta.put({ key: JOURNAL_KEY_META, value: { key: await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]), tokenVersion: null } });
    await saveSyncSettings(d, { serverUrl: SERVER, token: await deriveToken("pretend typo") });
    expect((await syncOnce({ db: d, fetch: new FakeSyncServer(token).fetch })).kind).toBe("needs-passphrase");
    expect(await loadJournalKey(d)).toBeInstanceOf(CryptoKey);
  });

  it("the right passphrase keeps its key through syncing", async () => {
    const d = device();
    await saveSyncSettings(d, { serverUrl: SERVER, token });
    await saveJournalKeyFromSync(d, PASS);
    expect((await syncOnce({ db: d, fetch: new FakeSyncServer(token).fetch })).kind).toBe("ok");
    expect(await loadJournalKey(d)).toBeInstanceOf(CryptoKey);
  });
});
