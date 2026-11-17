import Dexie from "dexie";
import { HubDB } from "../data/db";
import { FakeSyncServer } from "../sync/fakeServer";
import { getMeta, saveSyncSettings, stopSyncing, syncOnce } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { deriveJournalSecret, deriveKeyWrapKey, journalAad, openJson, sealJson, toBase64, type JournalKey } from "./crypto";
import {
  confirmJournalKey, giveOldPassphrase, journalNeedsOldPassphrase, journalSecretForPairing, keyWrapId, loadJournalKey,
  pairingJournalCheck, saveJournalKeyFromPairing, saveJournalKeyFromSync, unlockJournalWithSecret, VERIFIER_ID,
} from "./keyStore";
import { confirmedDevice, keyFor, verifierRow } from "../test/journalKey";

// Pairing without the passphrase (2026-11-17): a device that syncs gives its sync token and its
// copy of the journal secret S; the new device ends up as if the passphrase had been typed
// there. Fictional passphrases only.

const SERVER = "https://sync.example.test";
const A = "pretend-pairing-passphrase-alpha";
const B = "pretend-pairing-passphrase-bravo";
const C = "pretend-pairing-passphrase-charlie";
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
  const d = new HubDB(`journal-pairing-${++n}`);
  open.push(d);
  return d;
}

function changeServer(server: FakeSyncServer, token: string) {
  (server as unknown as { token: string }).token = token;
}

async function savePassphrase(d: HubDB, server: FakeSyncServer, passphrase: string) {
  await saveSyncSettings(d, { serverUrl: SERVER, token: await deriveToken(passphrase) });
  await saveJournalKeyFromSync(d, passphrase);
  return (await syncOnce({ db: d, fetch: server.fetch })).kind;
}

async function writePage(d: HubDB, jk: JournalKey, text: string, suffix = "p1") {
  const id = `page:${DAY}:${suffix}`;
  await d.journal.put({ id, kind: "page", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text, at: 1 }, journalAad(id))) });
  return id;
}

async function readPage(d: HubDB, id: string) {
  const jk = (await loadJournalKey(d))!;
  return (await openJson<{ text: string }>(jk.key, (await d.journal.get(id))!, journalAad(id))).text;
}

async function macWithPage(server: FakeSyncServer) {
  const mac = device();
  expect(await savePassphrase(mac, server, A)).toBe("ok");
  expect(await confirmJournalKey(mac)).toBe("confirmed");
  const page = await writePage(mac, (await loadJournalKey(mac))!, "A pretend page from the Mac.");
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
  return { mac, page };
}

/** What the Sync page does with a v2 code: save its token, keep S as a candidate, sync. */
async function pairWith(phone: HubDB, server: FakeSyncServer, from: HubDB) {
  const token = (await getMeta<string>(from, "token"))!;
  const s = (await journalSecretForPairing(from))!;
  await saveSyncSettings(phone, { serverUrl: SERVER, token });
  const state = await saveJournalKeyFromPairing(phone, s, token);
  s.fill(0);
  const sync = (await syncOnce({ db: phone, fetch: server.fetch })).kind;
  return { state, sync, after: await confirmJournalKey(phone) };
}

const eq = (a: Uint8Array | undefined, b: Uint8Array) => !!a && a.length === b.length && a.every((x, i) => x === b[i]);

describe("the secret a device gives to a pairing code", () => {
  it("is its copy of S, for a confirmed key that opens the verifier", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac } = await macWithPage(server);
    expect(eq(await journalSecretForPairing(mac), await deriveJournalSecret(A))).toBe(true);
  });

  it("is none on a locked device, and none on a key from before the re-key update until the old passphrase is given", async () => {
    const locked = device();
    await saveSyncSettings(locked, { serverUrl: SERVER, token: await deriveToken(A) });
    expect(await journalSecretForPairing(locked)).toBeUndefined();

    const old = device();
    await saveSyncSettings(old, { serverUrl: SERVER, token: await deriveToken(A) });
    await confirmedDevice(old, await keyFor(A)); // key only, no S
    expect(await journalSecretForPairing(old)).toBeUndefined();
    expect(await giveOldPassphrase(old, B)).toBe("wrong");
    expect(await journalSecretForPairing(old)).toBeUndefined();
    expect(await giveOldPassphrase(old, A)).toBe("ok");
    expect(eq(await journalSecretForPairing(old), await deriveJournalSecret(A))).toBe(true);
  });

  it("is none when the synced verifier belongs to another key (this key lost; it will be retired)", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac } = await macWithPage(server);
    await mac.journal.put({ ...(await verifierRow(await keyFor("pretend-other-journal"))), updatedAt: Date.now() + 1000 });
    expect(await journalSecretForPairing(mac)).toBeUndefined();
  });
});

describe("a device set up from a v2 code", () => {
  it("syncs, reads the Mac's page, and writes one the Mac reads; the same key everywhere", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac, page } = await macWithPage(server);
    const phone = device();
    expect(await pairWith(phone, server, mac)).toEqual({ state: "checking", sync: "ok", after: "confirmed" });
    expect(await readPage(phone, page)).toBe("A pretend page from the Mac.");
    expect((await loadJournalKey(phone))!.fp).toBe((await loadJournalKey(mac))!.fp);

    const back = await writePage(phone, (await loadJournalKey(phone))!, "A pretend page from the phone.", "p2");
    expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
    expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
    expect(await readPage(mac, back)).toBe("A pretend page from the phone.");
  });

  it("can pass the code on (it has its own copy of S), and needs no old passphrase when it changes the passphrase", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac, page } = await macWithPage(server);
    const phone = device();
    expect((await pairWith(phone, server, mac)).after).toBe("confirmed");
    expect(eq(await journalSecretForPairing(phone), await deriveJournalSecret(A))).toBe(true);

    // The phone is where she changes the passphrase: it writes C's wrap by itself.
    changeServer(server, await deriveToken(C));
    expect(await savePassphrase(phone, server, C)).toBe("ok");
    expect(await confirmJournalKey(phone)).toBe("confirmed");
    expect(await journalNeedsOldPassphrase(phone)).toBe(false);
    const wrap = keyWrapId((await deriveKeyWrapKey(C)).fp);
    expect([...server.rows.values()].some((r) => r.id === wrap)).toBe(true);

    // A tablet that types only C opens the journal through it; the Mac too.
    const tablet = device();
    expect(await savePassphrase(tablet, server, C)).toBe("ok");
    expect(await confirmJournalKey(tablet)).toBe("confirmed");
    expect(await readPage(tablet, page)).toBe("A pretend page from the Mac.");
    expect(await savePassphrase(mac, server, C)).toBe("ok");
    expect(await confirmJournalKey(mac)).toBe("confirmed");
  });

  it("after a passphrase change (A then B) a code from the Mac carries B's token and the same S", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac, page } = await macWithPage(server);
    changeServer(server, await deriveToken(B));
    expect(await savePassphrase(mac, server, B)).toBe("ok");
    const phone = device();
    expect((await pairWith(phone, server, mac)).after).toBe("confirmed");
    expect(await getMeta(phone, "token")).toBe(await deriveToken(B));
    expect(await readPage(phone, page)).toBe("A pretend page from the Mac.");
  });

  it("a code whose secret isn't this journal's opens nothing and seals nothing", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    await macWithPage(server);
    const phone = device();
    const token = await deriveToken(A);
    await saveSyncSettings(phone, { serverUrl: SERVER, token });
    const stranger = await deriveJournalSecret("pretend-some-other-journal");
    await saveJournalKeyFromPairing(phone, stranger, token);
    expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
    expect(await confirmJournalKey(phone)).toBe("locked");
    expect(await loadJournalKey(phone)).toBeUndefined();
  });

  it("the journal secret never appears in clear: not stored, not sent", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac } = await macWithPage(server);
    const phone = device();
    await pairWith(phone, server, mac);
    const s = await deriveJournalSecret(A);
    const forms = [toBase64(s), toBase64(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), [...s].map((b) => b.toString(16).padStart(2, "0")).join("")];
    const sent = JSON.stringify(server.requests.map((r) => r.body)) + JSON.stringify([...server.rows.values()]);
    const local = JSON.stringify(await phone.syncMeta.toArray()) + JSON.stringify(await phone.journal.toArray());
    for (const f of forms) {
      expect(sent).not.toContain(f);
      expect(local).not.toContain(f);
    }
  });

  it("Stop syncing removes the token, as on a device set up by typing", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac } = await macWithPage(server);
    const phone = device();
    await pairWith(phone, server, mac);
    await stopSyncing(phone);
    expect(await getMeta(phone, "token")).toBeUndefined();
  });
});

describe("a key from a code is confirmed only by the journal's verifier (review I1)", () => {
  it("a wrong secret with a valid token and no verifier anywhere yet: never confirmed, nothing sealed sent; the Mac stays fine", async () => {
    const token = await deriveToken(A);
    const server = new FakeSyncServer(token);
    const phone = device();
    await saveSyncSettings(phone, { serverUrl: SERVER, token });
    const wrong = await deriveJournalSecret(A);
    wrong[0] ^= 1; // one changed character
    expect(await saveJournalKeyFromPairing(phone, wrong, token)).toBe("checking");
    for (let i = 0; i < 2; i++) expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
    expect(await confirmJournalKey(phone)).toBe("checking");
    expect(await loadJournalKey(phone)).toBeUndefined();
    expect(await phone.journal.count()).toBe(0);
    expect([...server.rows.values()].filter((r) => r.table === "journal")).toHaveLength(0);

    // The Mac sets up by typing: its verifier wins; the phone drops the wrong key.
    const { mac } = await macWithPage(server);
    expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
    expect(await confirmJournalKey(phone)).toBe("locked");
    expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
    expect(await confirmJournalKey(mac)).toBe("confirmed");
  });
});

describe("pairingJournalCheck: does a code's secret fit this device's journal?", () => {
  it("new on a device with no journal key; same for its own key; other for another key", async () => {
    const fresh = device();
    expect(await pairingJournalCheck(fresh, await deriveJournalSecret(A))).toBe("new");
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac } = await macWithPage(server);
    expect(await pairingJournalCheck(mac, await deriveJournalSecret(A))).toBe("same");
    expect(await pairingJournalCheck(mac, await deriveJournalSecret("pretend-other-journal"))).toBe("other");
  });

  it("other when a verifier is here that it can't open, or this device retired a different key", async () => {
    const d = device();
    await d.journal.put(await verifierRow(await keyFor(A)));
    expect(await pairingJournalCheck(d, await deriveJournalSecret("pretend-other-journal"))).toBe("other");
    expect(await pairingJournalCheck(d, await deriveJournalSecret(A))).toBe("new");

    const server = new FakeSyncServer(await deriveToken(A));
    const { mac } = await macWithPage(server);
    const other = "pretend-other-journal";
    await mac.journal.put({ ...(await verifierRow(await keyFor(other))), updatedAt: Date.now() + 1000 });
    expect(await confirmJournalKey(mac)).toBe("locked"); // A retired
    expect(await pairingJournalCheck(mac, await deriveJournalSecret(other))).toBe("other");
  });

  it("saveJournalKeyFromPairing never touches a device that already has a working key", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac, page } = await macWithPage(server);
    const before = (await mac.syncMeta.get("journalKey"))!.value;
    const other = await deriveJournalSecret("pretend-other-journal");
    expect(await saveJournalKeyFromPairing(mac, other, await deriveToken(A))).toBe("confirmed");
    expect(await saveJournalKeyFromPairing(mac, await deriveJournalSecret(A), await deriveToken(A))).toBe("confirmed");
    expect((await mac.syncMeta.get("journalKey"))!.value).toEqual(before);
    expect(await mac.syncMeta.get("journalCandidate")).toBeUndefined();
    expect(await readPage(mac, page)).toBe("A pretend page from the Mac.");
  });
});

describe("Unlock journal with a v2 code (Journal page)", () => {
  it("opens the journal when its secret opens the verifier; refuses another journal's", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac, page } = await macWithPage(server);
    const token = await deriveToken(A);
    const phone = device();
    await saveSyncSettings(phone, { serverUrl: SERVER, token });
    expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
    expect(await confirmJournalKey(phone)).toBe("locked");
    expect(await unlockJournalWithSecret(phone, await deriveJournalSecret("pretend-other-journal"), token)).toBe("wrong");
    expect(await unlockJournalWithSecret(phone, (await journalSecretForPairing(mac))!, token)).toBe("ok");
    expect(await readPage(phone, page)).toBe("A pretend page from the Mac.");
  });

  it("with no verifier yet: needs sync set up with the code's token, then waits for the journal's verifier (never the token)", async () => {
    const s = await deriveJournalSecret(A);
    const token = await deriveToken(A);
    const server = new FakeSyncServer(token);
    const d = device();
    expect(await unlockJournalWithSecret(d, s, token)).toBe("no-sync");
    await saveSyncSettings(d, { serverUrl: SERVER, token: await deriveToken(B) });
    expect(await unlockJournalWithSecret(d, s, token)).toBe("code-refused"); // not this device's sync
    await saveSyncSettings(d, { serverUrl: SERVER, token });
    expect(await unlockJournalWithSecret(d, s, token)).toBe("checking");
    expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok");
    expect(await confirmJournalKey(d)).toBe("checking"); // accepted token alone confirms nothing
    expect(await d.journal.get(VERIFIER_ID)).toBeUndefined();
    // The journal's own device sends its verifier: now it opens.
    await macWithPage(server);
    expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok");
    expect(await confirmJournalKey(d)).toBe("confirmed");
  });

  it("refused after the verifier changed to another key on this device (its old key is retired)", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac } = await macWithPage(server);
    const token = await deriveToken(A);
    // Another key's verifier wins: the Mac's key is retired and the journal locks.
    const other = "pretend-other-journal";
    await mac.journal.put({ ...(await verifierRow(await keyFor(other))), updatedAt: Date.now() + 1000 });
    expect(await confirmJournalKey(mac)).toBe("locked");
    expect(await unlockJournalWithSecret(mac, await deriveJournalSecret(other), token)).toBe("code-refused");
    expect(await loadJournalKey(mac)).toBeUndefined();
  });
});
