import Dexie from "dexie";
import { HubDB } from "../data/db";
import { deriveToken } from "../sync/token";
import { FakeSyncServer } from "../sync/fakeServer";
import { saveSyncSettings, syncOnce } from "../sync/engine";
import { journalAad, openJson, sealJson } from "./crypto";
import {
  confirmJournalKey, JOURNAL_CANDIDATE_META, JOURNAL_RETIRED_META, loadCandidate, loadJournalKey, repairJournal,
  saveJournalKeyFromSync, unlockJournal, VERIFIER_ID,
} from "./keyStore";
import { keyFor, verifierRow } from "../test/journalKey";

// The journal key on a device (journal brief §3; review C1): a typed passphrase only makes a
// CANDIDATE, which never seals anything; it is confirmed by the synced verifier, or by the
// server accepting the same passphrase's token when no verifier exists yet.

const PASS = "fake-journal-passphrase-good";
const TYPO = "fake-journal-passphrase-goof";
const SERVER = "https://sync.example.test";
let token: string;
let typoToken: string;
beforeAll(async () => {
  token = await deriveToken(PASS);
  typoToken = await deriveToken(TYPO);
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

/** A device whose journal is confirmed with PASS through a real first sync. */
async function confirmedThroughSync(server: FakeSyncServer) {
  const d = device();
  await saveSyncSettings(d, { serverUrl: SERVER, token });
  expect(await saveJournalKeyFromSync(d, PASS)).toBe("checking");
  expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("ok");
  expect(await confirmJournalKey(d)).toBe("confirmed");
  return d;
}

describe("confirming a key", () => {
  it("first device: Save makes a candidate; the server accepting the token confirms it and writes the verifier", async () => {
    const server = new FakeSyncServer(token);
    const d = device();
    await saveSyncSettings(d, { serverUrl: SERVER, token });
    expect(await saveJournalKeyFromSync(d, PASS)).toBe("checking");
    expect(await loadJournalKey(d)).toBeUndefined(); // nothing may seal yet
    expect(await d.journal.count()).toBe(0);
    await syncOnce({ db: d, fetch: server.fetch });
    expect(await confirmJournalKey(d)).toBe("confirmed");
    const jk = (await loadJournalKey(d))!;
    expect(jk.fp).toBe((await keyFor(PASS)).fp);
    expect(jk.key.extractable).toBe(false);
    const verifier = (await d.journal.get(VERIFIER_ID))!;
    expect(verifier).toMatchObject({ kind: "verifier", fp: jk.fp });
    expect(await openJson(jk.key, verifier, journalAad(VERIFIER_ID))).toMatchObject({ v: 1 });
    expect(await loadCandidate(d)).toBeUndefined();
    expect(JSON.stringify(await d.syncMeta.toArray())).not.toContain(PASS);
  });

  it("a second device: the synced verifier confirms the right passphrase at once", async () => {
    const server = new FakeSyncServer(token);
    await syncOnce({ db: await confirmedThroughSync(server), fetch: server.fetch });
    const phone = device();
    await saveSyncSettings(phone, { serverUrl: SERVER, token });
    await syncOnce({ db: phone, fetch: server.fetch });
    expect(await phone.journal.get(VERIFIER_ID)).toBeTruthy();
    expect(await unlockJournal(phone, TYPO)).toBe("wrong");
    expect(await loadJournalKey(phone)).toBeUndefined();
    expect(await unlockJournal(phone, PASS)).toBe("ok");
    expect((await loadJournalKey(phone))!.fp).toBe((await keyFor(PASS)).fp);
  });
});

describe("C1: a typo never seals anything", () => {
  it("offline typo on Sync Save with a confirmed key: the confirmed key stays; the typo is retired", async () => {
    const server = new FakeSyncServer(token);
    const d = await confirmedThroughSync(server);
    const good = (await loadJournalKey(d))!.fp;
    await saveSyncSettings(d, { serverUrl: SERVER, token: typoToken });
    expect(await saveJournalKeyFromSync(d, TYPO)).toBe("confirmed"); // it doesn't open the verifier
    expect((await loadJournalKey(d))!.fp).toBe(good);
    expect(await loadCandidate(d)).toBeUndefined();
    // Later the server refuses the typo: the confirmed key is never touched.
    expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("needs-passphrase");
    expect((await loadJournalKey(d))!.fp).toBe(good);
  });

  it("offline typo on first set-up: only a candidate, the Journal can't write, and the refusal retires it", async () => {
    const server = new FakeSyncServer(token);
    const d = device();
    await saveSyncSettings(d, { serverUrl: SERVER, token: typoToken });
    expect(await saveJournalKeyFromSync(d, TYPO)).toBe("checking");
    expect(await loadJournalKey(d)).toBeUndefined();
    const { saveMorningDraft, NOT_CONFIRMED } = await import("../data/journalRepo");
    // Even a caller holding the candidate's key cannot write with it.
    const cand = (await loadCandidate(d))!;
    const { db } = await import("../data/db");
    await expect(saveMorningDraft(cand, "2026-10-28", "device-aaaa", "Pretend")).rejects.toThrow(NOT_CONFIRMED);
    expect(await db.journal.count()).toBe(0);
    expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("needs-passphrase");
    expect(await confirmJournalKey(d)).toBe("locked");
    expect(await loadCandidate(d)).toBeUndefined();
    expect((await d.syncMeta.get(JOURNAL_RETIRED_META))!.value).toHaveLength(1);
  });

  it("a refusal landing between token save and key store (the Save race): the late candidate can never confirm", async () => {
    const server = new FakeSyncServer(token);
    const d = device();
    await saveSyncSettings(d, { serverUrl: SERVER, token: typoToken });
    expect((await syncOnce({ db: d, fetch: server.fetch })).kind).toBe("needs-passphrase"); // before the key exists
    expect(await saveJournalKeyFromSync(d, TYPO)).toBe("locked");
    expect(await loadJournalKey(d)).toBeUndefined();
    expect(await loadCandidate(d)).toBeUndefined();
  });

  it("two quick Saves (typo, then the right one), the typo's key finishing LAST: only the right key confirms", async () => {
    const server = new FakeSyncServer(token);
    const d = device();
    await saveSyncSettings(d, { serverUrl: SERVER, token: typoToken });
    await saveSyncSettings(d, { serverUrl: SERVER, token });
    expect(await saveJournalKeyFromSync(d, PASS)).toBe("checking");
    expect(await saveJournalKeyFromSync(d, TYPO)).toBe("checking"); // late typo: dropped, not stored
    expect((await loadCandidate(d))!.fp).toBe((await keyFor(PASS)).fp);
    await syncOnce({ db: d, fetch: server.fetch });
    expect(await confirmJournalKey(d)).toBe("confirmed");
    expect((await loadJournalKey(d))!.fp).toBe((await keyFor(PASS)).fp);
  });

  it("two quick Saves, the typo's key finishing FIRST (stored while its token was current): it can never confirm", async () => {
    const server = new FakeSyncServer(token);
    const d = device();
    await saveSyncSettings(d, { serverUrl: SERVER, token: typoToken });
    expect(await saveJournalKeyFromSync(d, TYPO)).toBe("checking"); // stored, bound to the typo's token
    await saveSyncSettings(d, { serverUrl: SERVER, token }); // the second Save's token
    await syncOnce({ db: d, fetch: server.fetch }); // the server accepts the RIGHT token
    expect(await d.syncMeta.get("acceptedToken")).toMatchObject({ value: token });
    expect(await confirmJournalKey(d)).toBe("locked"); // the typo candidate is retired, not confirmed
    expect(await loadJournalKey(d)).toBeUndefined();
    expect(await saveJournalKeyFromSync(d, PASS)).toBe("confirmed"); // the second Save's key arrives
    expect((await loadJournalKey(d))!.fp).toBe((await keyFor(PASS)).fp);
  });

  it("the right passphrase typed on the Sync page waits for the server, then confirms", async () => {
    const server = new FakeSyncServer(token);
    const d = device();
    await saveSyncSettings(d, { serverUrl: SERVER, token });
    expect(await saveJournalKeyFromSync(d, PASS)).toBe("checking");
    server.inject({ networkError: true });
    await syncOnce({ db: d, fetch: server.fetch }); // offline: still checking
    expect(await confirmJournalKey(d)).toBe("checking");
    await syncOnce({ db: d, fetch: server.fetch });
    expect(await confirmJournalKey(d)).toBe("confirmed");
  });
});

describe("unlock journal", () => {
  it("no token and no verifier: set up sync first; a key that only opens some other row is refused", async () => {
    const d = device();
    expect(await unlockJournal(d, PASS)).toBe("no-sync");
    // A page sealed with this passphrase is here (e.g. from a restore) but no verifier: still no.
    const jk = await keyFor(PASS);
    const id = "page:2026-10-28:p1";
    await d.journal.add({ id, kind: "page", date: "2026-10-28", fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text: "x", at: 1 }, journalAad(id))) });
    expect(await unlockJournal(d, PASS)).toBe("no-sync");
    expect(await loadJournalKey(d)).toBeUndefined();
  });

  it("no token, a verifier here: the passphrase must open it", async () => {
    const d = device();
    await d.journal.put(await verifierRow(await keyFor(PASS)));
    expect(await unlockJournal(d, TYPO)).toBe("wrong");
    expect(await loadJournalKey(d)).toBeUndefined();
    expect(await d.syncMeta.get(JOURNAL_CANDIDATE_META)).toBeUndefined();
    expect(await unlockJournal(d, PASS)).toBe("ok");
  });

  it("with a token the server has accepted: a different passphrase is wrong", async () => {
    const server = new FakeSyncServer(token);
    const d = device();
    await saveSyncSettings(d, { serverUrl: SERVER, token });
    await syncOnce({ db: d, fetch: server.fetch });
    expect(await unlockJournal(d, TYPO)).toBe("wrong");
    expect(await unlockJournal(d, PASS)).toBe("ok"); // accepted already: confirmed at once
    expect(await d.journal.get(VERIFIER_ID)).toBeTruthy();
  });

  it("with a token not yet accepted (maybe the Sync page's typo): a mismatch says so instead of 'wrong'", async () => {
    const d = device();
    await saveSyncSettings(d, { serverUrl: SERVER, token: typoToken });
    expect(await unlockJournal(d, PASS)).toBe("sync-unconfirmed");
    expect(await unlockJournal(d, TYPO)).toBe("checking"); // matches, waits for the server
    expect(await loadJournalKey(d)).toBeUndefined();
  });
});

describe("repair pass", () => {
  it("rows sealed with a retired key of the same fingerprint are re-sealed with the confirmed key", async () => {
    const d = device();
    const good = await keyFor(PASS);
    const old = await keyFor(TYPO);
    await d.journal.put(await verifierRow(good));
    await d.syncMeta.put({ key: "journalKey", value: { ...good, id: "g" } });
    await d.syncMeta.put({ key: JOURNAL_RETIRED_META, value: [{ ...old }] });
    const id = "page:2026-10-20:old1";
    await d.journal.add({ id, kind: "page", date: "2026-10-20", fp: old.fp, ...(await sealJson(old.key, { v: 1, text: "Pretend old", at: 1 }, journalAad(id))) });
    const stranger = await keyFor("fake-someone-else");
    const id2 = "page:2026-10-21:x1";
    await d.journal.add({ id: id2, kind: "page", date: "2026-10-21", fp: stranger.fp, ...(await sealJson(stranger.key, { v: 1, text: "x", at: 1 }, journalAad(id2))) });
    expect(await repairJournal(d)).toBe(1);
    const fixed = (await d.journal.get(id))!;
    expect(fixed.fp).toBe(good.fp);
    expect(await openJson(good.key, fixed, journalAad(id))).toMatchObject({ text: "Pretend old" });
    expect((await d.journal.get(id2))!.fp).toBe(stranger.fp); // nothing here opens it: left as it is
  });
});
