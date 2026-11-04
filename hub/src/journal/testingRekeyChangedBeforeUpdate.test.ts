import Dexie from "dexie";
import { HubDB } from "../data/db";
import { FakeSyncServer } from "../sync/fakeServer";
import { saveSyncSettings, syncOnce } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { journalAad, openJson, sealJson, type JournalKey } from "./crypto";
import {
  ACCEPTED_SEQ_META, confirmJournalKey, giveOldPassphrase, journalNeedsOldPassphrase, loadJournalKey, saveJournalKeyFromSync,
  TOKEN_SEQ_META, unlockJournal,
} from "./keyStore";
import { confirmedDevice, keyFor } from "../test/journalKey";

// Testing session (journal-rekey check), bug (severity 2; 1 if she no longer remembers the
// passphrase she FIRST set the journal up with).
//
// What Esme would see: she changed her sync passphrase while her devices were still on the
// current (live) build. The sync/README already says she may, and the Mac app only gets the
// new web build when it is rebuilt, so this can also happen after the release: the helper is
// run, she types the new passphrase on the Mac's Sync page while the Mac app is still the old
// build. Then the update arrives.
//  1. Nothing ever carries the journal over. No device shows "Type your old passphrase once",
//     and a new phone set up with the passphrase she now uses stays on "Unlock journal";
//     typing it there says "That passphrase doesn't open your journal...". Only her FIRST
//     passphrase opens it. (The fix for bug #3 only works for a passphrase Saved on the new build.)
//  2. If she changes it again after the update (A, then B on the live build, then C), the Mac
//     does ask "Type your old passphrase once"; she types her old passphrase B and is told
//     "That isn't your old passphrase. Try again." Only A, two passphrases back, is accepted.
//
// Cause: keyStore.ts journalNeedsOldPassphrase (~511) and writeAcceptedKeyWrap (~461) only act
// on a "pending wrap", which only saveJournalKeyFromSync on THIS build makes (storeCandidate
// ~309). A passphrase saved on the live build has none, and the app never notices that the
// accepted sync token is not the journal's passphrase. giveOldPassphrase (~527) accepts only a
// passphrase whose own key or keywrap row gives the journal key; B (saved on the live build)
// has neither, so the prompt's "old passphrase" means "the first one", which it doesn't say.
//
// The live build's state is built by hand: its Save stores the key only (no copy of S, no
// pending wrap) and its sync engine never writes acceptedSeq / tokenSeq. Fictional passphrases.

const SERVER = "https://sync.example.test";
const A = "fake-rekey-before-update-alpha";
const B = "fake-rekey-before-update-bravo";
const C = "fake-rekey-before-update-charlie";
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
  const d = new HubDB(`testing-rekey-before-update-${++n}-${Date.now()}`);
  open.push(d);
  return d;
}
const changeServer = (server: FakeSyncServer, token: string) => ((server as unknown as { token: string }).token = token);

/** Drops the rows only this build writes, so the device looks exactly as the live build left it. */
async function asLiveBuild(d: HubDB) {
  await d.syncMeta.bulkDelete([ACCEPTED_SEQ_META, TOKEN_SEQ_META]);
}

async function writePage(d: HubDB, jk: JournalKey, text: string) {
  const id = `page:${DAY}:p1`;
  await d.journal.put({ id, kind: "page", date: DAY, fp: jk.fp, ...(await sealJson(jk.key, { v: 1, text, at: 1 }, journalAad(id))) });
  return id;
}

/**
 * The Mac on the live build: journal set up with A, a page written, then (helper run) B typed
 * on its Sync page and synced. The live build's Save of B makes a candidate that is retired at
 * once (B doesn't open the verifier); the confirmed key stays A's, with no copy of S.
 */
async function macChangedOnLiveBuild(server: FakeSyncServer) {
  const mac = device();
  await saveSyncSettings(mac, { serverUrl: SERVER, token: await deriveToken(A) });
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
  await confirmedDevice(mac, await keyFor(A)); // the live build's confirmed key: no copy of S
  const page = await writePage(mac, await keyFor(A), "A pretend page from before the change.");
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
  changeServer(server, await deriveToken(B));
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("needs-passphrase");
  await saveSyncSettings(mac, { serverUrl: SERVER, token: await deriveToken(B) });
  expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
  await asLiveBuild(mac);
  return { mac, page };
}

describe("a passphrase changed while her devices ran the live build", () => {
  it("is carried over after the update: the Mac asks once, then a new phone opens the journal with the passphrase she now uses", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac, page } = await macChangedOnLiveBuild(server);

    // The update arrives. The Mac opens and syncs as usual; she types her old passphrase if asked.
    expect(await confirmJournalKey(mac)).toBe("confirmed");
    expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
    const macAsked = await journalNeedsOldPassphrase(mac);
    if (macAsked) {
      expect(await giveOldPassphrase(mac, A)).toBe("ok");
      expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
    }

    // A new phone, set up with B (the passphrase sync uses now).
    const phone = device();
    await saveSyncSettings(phone, { serverUrl: SERVER, token: await deriveToken(B) });
    await saveJournalKeyFromSync(phone, B);
    expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
    const state = await confirmJournalKey(phone);
    const unlock = state === "confirmed" ? "ok" : await unlockJournal(phone, B);
    expect(unlock, `Mac asked for the old passphrase: ${macAsked}; phone was "${state}"`).toBe("ok");
    const jk = (await loadJournalKey(phone))!;
    expect((await openJson<{ text: string }>(jk.key, (await phone.journal.get(page))!, journalAad(page))).text).toBe(
      "A pretend page from before the change.",
    );
  });

  it("A, then B on the live build, then C after the update: the one-time prompt accepts her old passphrase B", async () => {
    const server = new FakeSyncServer(await deriveToken(A));
    const { mac } = await macChangedOnLiveBuild(server);

    // After the update she changes it again, the documented way: helper, then C on the Mac first.
    changeServer(server, await deriveToken(C));
    await saveSyncSettings(mac, { serverUrl: SERVER, token: await deriveToken(C) });
    await saveJournalKeyFromSync(mac, C);
    expect((await syncOnce({ db: mac, fetch: server.fetch })).kind).toBe("ok");
    expect(await confirmJournalKey(mac)).toBe("confirmed");
    expect(await journalNeedsOldPassphrase(mac)).toBe(true); // "Type your old passphrase once"

    // Her old passphrase is B: the one sync used until a minute ago.
    expect(await giveOldPassphrase(mac, B)).toBe("ok");
  });
});
