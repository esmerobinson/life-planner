import Dexie from "dexie";
import { HubDB } from "../data/db";
import { FakeSyncServer } from "../sync/fakeServer";
import { saveSyncSettings, syncOnce } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { deriveJournalSecret, deriveKeyWrapKey, journalAad, openJson, sealJson, toBase64, type JournalKey } from "./crypto";
import {
  confirmJournalKey, giveOldPassphrase, JOURNAL_PENDING_WRAP_META, journalNeedsOldPassphrase, keyWrapId, loadJournalKey,
  saveJournalKeyFromSync, unlockJournal, VERIFIER_ID,
} from "./keyStore";
import { confirmedDevice, keyFor, verifierRow } from "../test/journalKey";

// Journal re-key (bugs #3, #4; journal-rekey brief): the journal key stays the same when the
// sync passphrase changes; each passphrase the server has accepted gets a synced `keywrap` row
// holding the journal secret S sealed with that passphrase's key-wrap key. Fictional
// passphrases only.

const SERVER = "https://sync.example.test";
const A = "pretend-rekey-passphrase-alpha";
const B = "pretend-rekey-passphrase-bravo";
const C = "pretend-rekey-passphrase-charlie";
const TYPO = "pretend-rekey-passphrase-brav0";
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
  const d = new HubDB(`journal-rekey-${++n}`);
  open.push(d);
  return d;
}

/** The server takes a new passphrase (the sync helper run again). */
function changeServer(server: FakeSyncServer, token: string) {
  (server as unknown as { token: string }).token = token;
}

/** Types `passphrase` on the Sync page (Save), then syncs once. */
async function savePassphrase(d: HubDB, server: FakeSyncServer, passphrase: string) {
  await saveSyncSettings(d, { serverUrl: SERVER, token: await deriveToken(passphrase) });
  await saveJournalKeyFromSync(d, passphrase);
  return (await syncOnce({ db: d, fetch: server.fetch })).kind;
}

/** A journal page sealed with `jk`, written straight into `d` (as journalRepo would). */
async function writePage(d: HubDB, jk: JournalKey, text: string, suffix = "p1") {
  const id = `page:${DAY}:${suffix}`;
  await d.journal.put({ id, kind: "page", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text, at: 1 }, journalAad(id))) });
  return id;
}

async function readPage(d: HubDB, id: string) {
  const jk = (await loadJournalKey(d))!;
  return (await openJson<{ text: string }>(jk.key, (await d.journal.get(id))!, journalAad(id))).text;
}

const serverWraps = (server: FakeSyncServer) =>
  [...server.rows.values()].filter((r) => r.table === "journal" && r.id.startsWith("keywrap:")).map((r) => r.id);

/** The Mac: journal set up with A through a real first sync, one page written and synced. */
async function macWithPage(server: FakeSyncServer) {
  const mac = device();
  expect(await savePassphrase(mac, server, A)).toBe("ok");
  expect(await confirmJournalKey(mac)).toBe("confirmed");
  const page = await writePage(mac, (await loadJournalKey(mac))!, "A pretend old page.");
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
  return { mac, page };
}

describe("changing the sync passphrase keeps the journal", () => {
  it("a new device with only the new passphrase opens the journal and reads old pages (Save and Unlock)", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac, page } = await macWithPage(server);
    const journalFp = (await loadJournalKey(mac))!.fp;

    changeServer(server, await deriveToken(B));
    expect(await savePassphrase(mac, server, B)).toBe("ok");
    expect((await loadJournalKey(mac))!.fp).toBe(journalFp); // the journal key never changes
    expect(serverWraps(server)).toEqual([keyWrapId((await deriveKeyWrapKey(B)).fp)]);

    // A phone set up with B on its Sync page.
    const phone = device();
    expect(await savePassphrase(phone, server, B)).toBe("ok");
    expect(await confirmJournalKey(phone)).toBe("confirmed");
    expect((await loadJournalKey(phone))!.fp).toBe(journalFp);
    expect(await readPage(phone, page)).toBe("A pretend old page.");

    // A tablet whose sync was set up (token only) unlocks the Journal with B.
    const tablet = device();
    await saveSyncSettings(tablet, { serverUrl: SERVER, token: await deriveToken(B) });
    expect((await syncOnce({ db: tablet, fetch: server.fetch })).kind).toBe("ok");
    expect(await unlockJournal(tablet, TYPO)).toBe("wrong");
    expect(await unlockJournal(tablet, B)).toBe("ok");
    expect(await readPage(tablet, page)).toBe("A pretend old page.");
  });

  it("the old passphrase still opens the journal, also on a device that has the wrap", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac, page } = await macWithPage(server);
    changeServer(server, await deriveToken(B));
    expect(await savePassphrase(mac, server, B)).toBe("ok");
    const tablet = device();
    await saveSyncSettings(tablet, { serverUrl: SERVER, token: await deriveToken(B) });
    await syncOnce({ db: tablet, fetch: server.fetch });
    expect(await tablet.journal.get(keyWrapId((await deriveKeyWrapKey(B)).fp))).toBeTruthy();
    expect(await unlockJournal(tablet, A)).toBe("ok");
    expect(await readPage(tablet, page)).toBe("A pretend old page.");
  });

  it("a typo'd new passphrase never writes a wrap; the right one then does", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac } = await macWithPage(server);
    changeServer(server, await deriveToken(B));
    expect(await savePassphrase(mac, server, TYPO)).toBe("needs-passphrase");
    expect(await confirmJournalKey(mac)).toBe("confirmed"); // the journal stays open
    expect(await mac.journal.where("kind").equals("keywrap").count()).toBe(0);
    expect(await mac.syncMeta.get(JOURNAL_PENDING_WRAP_META)).toBeUndefined();
    expect(serverWraps(server)).toEqual([]);
    expect(await savePassphrase(mac, server, B)).toBe("ok");
    expect(serverWraps(server)).toEqual([keyWrapId((await deriveKeyWrapKey(B)).fp)]);
  });

  it("a typo saved offline (never accepted) writes nothing, even after another sync", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac } = await macWithPage(server);
    server.inject({ networkError: true });
    expect(await savePassphrase(mac, server, TYPO)).toBe("offline");
    await confirmJournalKey(mac);
    expect(await mac.journal.where("kind").equals("keywrap").count()).toBe(0);
    expect(await savePassphrase(mac, server, A)).toBe("ok"); // the right (unchanged) one again
    expect(await mac.journal.where("kind").equals("keywrap").count()).toBe(0); // its own passphrase needs no wrap
    expect(serverWraps(server)).toEqual([]);
  });

  it("a device confirmed before this update (no copy of S) asks for the old passphrase once; after it the wrap exists", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const mac = device();
    await saveSyncSettings(mac, { serverUrl: SERVER, token: await deriveToken(A) });
    await confirmedDevice(mac, await keyFor(A)); // stored the old way: key only, no S
    const page = await writePage(mac, await keyFor(A), "A pretend page from before.");
    expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
    expect(await journalNeedsOldPassphrase(mac)).toBe(false);

    changeServer(server, await deriveToken(B));
    expect(await savePassphrase(mac, server, B)).toBe("ok");
    expect(await confirmJournalKey(mac)).toBe("confirmed");
    expect(await journalNeedsOldPassphrase(mac)).toBe(true);
    expect(serverWraps(server)).toEqual([]);

    expect(await giveOldPassphrase(mac, TYPO)).toBe("wrong");
    expect(await giveOldPassphrase(mac, B)).toBe("wrong"); // the new one can't give the journal's key yet
    expect(await journalNeedsOldPassphrase(mac)).toBe(true);
    expect(await giveOldPassphrase(mac, A)).toBe("ok");
    expect(await journalNeedsOldPassphrase(mac)).toBe(false);
    expect(await mac.journal.get(keyWrapId((await deriveKeyWrapKey(B)).fp))).toBeTruthy();
    expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
    expect(serverWraps(server)).toHaveLength(1);

    const phone = device();
    expect(await savePassphrase(phone, server, B)).toBe("ok");
    expect(await confirmJournalKey(phone)).toBe("confirmed");
    expect(await readPage(phone, page)).toBe("A pretend page from before.");
  });

  it("a new phone that typed the new passphrase BEFORE the Mac opens by itself once the Mac's wrap arrives", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac, page } = await macWithPage(server);
    changeServer(server, await deriveToken(B));
    const phone = device();
    expect(await savePassphrase(phone, server, B)).toBe("ok");
    expect(await confirmJournalKey(phone)).toBe("locked"); // no wrap yet: B can't open it
    expect(await savePassphrase(mac, server, B)).toBe("ok"); // the Mac writes the wrap
    expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
    expect(await confirmJournalKey(phone)).toBe("confirmed");
    expect(await readPage(phone, page)).toBe("A pretend old page.");
  });

  it("two changes in a row (A, then B, then C) work on every device", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac, page } = await macWithPage(server);
    changeServer(server, await deriveToken(B));
    expect(await savePassphrase(mac, server, B)).toBe("ok");
    const phone = device();
    expect(await savePassphrase(phone, server, B)).toBe("ok");
    expect(await confirmJournalKey(phone)).toBe("confirmed");

    // C is typed first on the phone (which got the journal through B's wrap).
    changeServer(server, await deriveToken(C));
    expect(await savePassphrase(phone, server, C)).toBe("ok");
    expect(serverWraps(server).sort()).toEqual(
      [keyWrapId((await deriveKeyWrapKey(B)).fp), keyWrapId((await deriveKeyWrapKey(C)).fp)].sort(),
    );
    expect(await savePassphrase(mac, server, C)).toBe("ok");
    expect(await confirmJournalKey(mac)).toBe("confirmed");
    const tablet = device();
    expect(await savePassphrase(tablet, server, C)).toBe("ok");
    expect(await confirmJournalKey(tablet)).toBe("confirmed");
    expect(await readPage(tablet, page)).toBe("A pretend old page.");
    const fps = await Promise.all([mac, phone, tablet].map(async (d) => (await loadJournalKey(d))!.fp));
    expect(new Set(fps).size).toBe(1);
  });

  it("a wrap holding another journal's secret (different fingerprint) is ignored", async () => {
    const d = device();
    await d.journal.put(await verifierRow(await keyFor(A)));
    const kek = await deriveKeyWrapKey(B);
    const stranger = await deriveJournalSecret("pretend-some-other-journal");
    const id = keyWrapId(kek.fp);
    await d.journal.put({
      id, kind: "keywrap", date: DAY, fp: kek.fp,
      ...(await sealJson(kek.key, { v: 1, s: toBase64(stranger), fp: (await keyFor("pretend-some-other-journal")).fp }, journalAad(id))),
    });
    expect(await unlockJournal(d, B)).toBe("wrong");
    expect(await loadJournalKey(d)).toBeUndefined();
    await saveSyncSettings(d, { serverUrl: SERVER, token: await deriveToken(B) });
    await saveJournalKeyFromSync(d, B);
    expect(await confirmJournalKey(d)).toBe("locked");
    expect(await loadJournalKey(d)).toBeUndefined();
  });

  it("nothing new is sent in clear: S only leaves the device sealed with the KEK", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac } = await macWithPage(server);
    changeServer(server, await deriveToken(B));
    expect(await savePassphrase(mac, server, B)).toBe("ok");
    const phone = device();
    expect(await savePassphrase(phone, server, B)).toBe("ok");
    expect(await confirmJournalKey(phone)).toBe("confirmed");
    const s = await deriveJournalSecret(A);
    const forms = [toBase64(s), [...s].map((b) => b.toString(16).padStart(2, "0")).join(""), A, B];
    const sent = JSON.stringify(server.requests.map((r) => r.body)) + JSON.stringify([...server.rows.values()]);
    for (const f of forms) expect(sent).not.toContain(f);
    for (const d of [mac, phone]) {
      const local = JSON.stringify(await d.syncMeta.toArray()) + JSON.stringify(await d.journal.toArray());
      for (const f of forms) expect(local).not.toContain(f);
    }
    // The wrap opens only with B's KEK.
    const kek = await deriveKeyWrapKey(B);
    const row = (await phone.journal.get(keyWrapId(kek.fp)))!;
    expect(await openJson(kek.key, row, journalAad(row.id))).toMatchObject({ v: 1, fp: (await keyFor(A)).fp });
    await expect(openJson((await deriveKeyWrapKey(A)).key, row, journalAad(row.id))).rejects.toThrow();
  });
});

describe("a confirmed key that can't open the synced verifier (bug #4, defensive)", () => {
  it("stops sealing, keeps every row, and the repair pass re-seals them once the right key is confirmed", async () => {
    const d = device();
    const loser = await keyFor(B);
    const winner = await keyFor(A);
    await confirmedDevice(d, loser);
    const page = await writePage(d, loser, "A pretend page sealed with the losing key.");
    // The other device's verifier wins on the server and arrives here.
    await d.journal.put({ ...(await verifierRow(winner)), updatedAt: Date.now() + 1000 });
    expect(await confirmJournalKey(d)).toBe("locked");
    expect(await loadJournalKey(d)).toBeUndefined();
    expect((await d.journal.get(page))!.fp).toBe(loser.fp); // untouched
    expect((await d.journal.get(VERIFIER_ID))!.fp).toBe(winner.fp);
    expect(await unlockJournal(d, A)).toBe("ok");
    expect((await d.journal.get(page))!.fp).toBe(winner.fp);
    expect(await readPage(d, page)).toBe("A pretend page sealed with the losing key.");
  });
});

describe("a stale acceptance never confirms a key (bug #4)", () => {
  it("a token accepted BEFORE the candidate was made waits for a fresh sync", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const d = device();
    await saveSyncSettings(d, { serverUrl: SERVER, token: await deriveToken(A) });
    expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok");
    expect(await unlockJournal(d, A)).toBe("checking"); // accepted long ago: not enough
    expect(await loadJournalKey(d)).toBeUndefined();
    expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok");
    expect(await confirmJournalKey(d)).toBe("confirmed");
  });

  it("a sync that finished between the token's Save and the key's store still counts (same Save)", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const d = device();
    await saveSyncSettings(d, { serverUrl: SERVER, token: await deriveToken(A) });
    expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok"); // raced ahead of the key
    expect(await saveJournalKeyFromSync(d, A)).toBe("confirmed");
  });
});

// Fix round 1 (review I1): only positive evidence that ANOTHER key won (the verifier's
// fingerprint differs) retires a confirmed key. A verifier with this key's fingerprint that
// won't open is damaged: it is sealed afresh, and her real passphrase keeps working.
describe("a damaged verifier (review I1)", () => {
  /** The verifier with one ciphertext character changed (same fingerprint). */
  async function damageVerifier(d: HubDB) {
    const v = (await d.journal.get(VERIFIER_ID))!;
    const ct = v.ct.startsWith("A") ? `B${v.ct.slice(1)}` : `A${v.ct.slice(1)}`;
    await d.journal.put({ ...v, ct });
    return { ...v, ct };
  }

  it("keeps the device confirmed, re-seals the verifier, and the journal stays readable", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac, page } = await macWithPage(server);
    const fp = (await loadJournalKey(mac))!.fp;
    await damageVerifier(mac);
    expect(await confirmJournalKey(mac)).toBe("confirmed");
    expect((await loadJournalKey(mac))!.fp).toBe(fp);
    expect(await readPage(mac, page)).toBe("A pretend old page.");
    const v = (await mac.journal.get(VERIFIER_ID))!;
    expect(v.fp).toBe(fp);
    expect(await openJson((await loadJournalKey(mac))!.key, v, journalAad(VERIFIER_ID))).toMatchObject({ v: 1 });
    expect(await mac.syncMeta.get("journalRetired")).toBeUndefined();
  });

  it("Unlock with her real passphrase works on a device whose only verifier copy is damaged (and the new passphrase's wrap too)", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac, page } = await macWithPage(server);
    changeServer(server, await deriveToken(B));
    expect(await savePassphrase(mac, server, B)).toBe("ok");
    for (const passphrase of [A, B]) {
      const d = device();
      await saveSyncSettings(d, { serverUrl: SERVER, token: await deriveToken(B) });
      expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok");
      await damageVerifier(d);
      expect(await unlockJournal(d, TYPO)).toBe("wrong");
      expect(await unlockJournal(d, passphrase)).toBe("ok");
      expect(await readPage(d, page)).toBe("A pretend old page.");
      expect(await openJson((await loadJournalKey(d))!.key, (await d.journal.get(VERIFIER_ID))!, journalAad(VERIFIER_ID))).toMatchObject({ v: 1 });
    }
  });

  it("Sync page Save of the real passphrase confirms on a new device despite a damaged verifier", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { page } = await macWithPage(server);
    const d = device();
    await saveSyncSettings(d, { serverUrl: SERVER, token: await deriveToken(A) });
    expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok");
    await damageVerifier(d);
    expect(await saveJournalKeyFromSync(d, A)).toBe("confirmed");
    expect(await readPage(d, page)).toBe("A pretend old page.");
  });

  it("a confirmed key that can't decrypt right now (a WebCrypto/keychain refusal) retires nothing and changes no row", async () => {
    const d = device();
    const good = await keyFor(A);
    await d.journal.put(await verifierRow(good));
    const before = await d.journal.get(VERIFIER_ID);
    // The same key bits, but WebCrypto refuses to decrypt with it.
    const s = await deriveJournalSecret(A);
    const encryptOnly = await crypto.subtle.importKey("raw", s as BufferSource, { name: "AES-GCM" }, false, ["encrypt"]);
    await d.syncMeta.put({ key: "journalKey", value: { key: encryptOnly, mac: good.mac, fp: good.fp, id: "refusing" } });
    expect(await confirmJournalKey(d)).toBe("confirmed");
    expect((await d.syncMeta.get("journalKey"))!.value).toMatchObject({ id: "refusing" });
    expect(await d.syncMeta.get("journalRetired")).toBeUndefined();
    expect(await d.journal.get(VERIFIER_ID)).toEqual(before);
  });

  it("a key row WebKit can't read (dropped at start-up) retires nothing; the passphrase opens it again", async () => {
    const { dropUnreadableKeys } = await import("./unreadableKeys");
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac, page } = await macWithPage(server);
    const before = await mac.journal.get(VERIFIER_ID);
    expect(await dropUnreadableKeys(mac, async (k) => (k === "journalKey" ? "unreadable" : "absent"))).toEqual(["journalKey"]);
    expect(await confirmJournalKey(mac)).toBe("locked");
    expect(await mac.syncMeta.get("journalRetired")).toBeUndefined();
    expect(await mac.journal.get(VERIFIER_ID)).toEqual(before);
    expect(await unlockJournal(mac, A)).toBe("ok");
    expect(await readPage(mac, page)).toBe("A pretend old page.");
  });
});

describe("fix round 1: minor items", () => {
  it("M1: candidates never sealed anything, so a passphrase change or a typo adds nothing to the retired keys", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac } = await macWithPage(server);
    changeServer(server, await deriveToken(B));
    expect(await savePassphrase(mac, server, TYPO)).toBe("needs-passphrase");
    expect(await savePassphrase(mac, server, B)).toBe("ok");
    changeServer(server, await deriveToken(C));
    expect(await savePassphrase(mac, server, C)).toBe("ok");
    expect(await mac.syncMeta.get("journalRetired")).toBeUndefined();
  });

  it("M2: a wrap holding another journal's secret doesn't hide the old-passphrase prompt; the prompt then writes the right wrap", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const mac = device();
    await saveSyncSettings(mac, { serverUrl: SERVER, token: await deriveToken(A) });
    await confirmedDevice(mac, await keyFor(A)); // from before the update: no copy of S
    const kek = await deriveKeyWrapKey(B);
    const id = keyWrapId(kek.fp);
    const stranger = await deriveJournalSecret("pretend-some-other-journal");
    await mac.journal.put({
      id, kind: "keywrap", date: DAY, fp: kek.fp,
      ...(await sealJson(kek.key, { v: 1, s: toBase64(stranger), fp: (await keyFor("pretend-some-other-journal")).fp }, journalAad(id))),
    });
    expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
    changeServer(server, await deriveToken(B));
    expect(await savePassphrase(mac, server, B)).toBe("ok");
    expect(await journalNeedsOldPassphrase(mac)).toBe(true);
    expect(await giveOldPassphrase(mac, A)).toBe("ok");
    expect(await openJson(kek.key, (await mac.journal.get(id))!, journalAad(id))).toMatchObject({ fp: (await keyFor(A)).fp });
    expect(await journalNeedsOldPassphrase(mac)).toBe(false);
  });

  it("M3: when the follow-up run that sends a new wrap fails, the sync still reports the first run's success; the next sync sends it", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac } = await macWithPage(server);
    changeServer(server, await deriveToken(B));
    await saveSyncSettings(mac, { serverUrl: SERVER, token: await deriveToken(B) });
    await saveJournalKeyFromSync(mac, B);
    const flaky: typeof fetch = async (input, init) => {
      if (typeof init?.body === "string" && init.body.includes("keywrap:")) throw new TypeError("pretend network blip");
      return server.fetch(input, init);
    };
    expect((await syncOnce({ db: mac, fetch: flaky })).kind).toBe("ok");
    expect(serverWraps(server)).toEqual([]);
    expect((await mac.pending.toArray()).filter((p) => p.table === "journal" && p.id.startsWith("keywrap:"))).toHaveLength(1);
    expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
    expect(serverWraps(server)).toHaveLength(1);
  });
});
