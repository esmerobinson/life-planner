import Dexie from "dexie";
import { HubDB } from "../data/db";
import { deriveJournalSecret } from "../journal/crypto";
import { confirmJournalKey, saveJournalKeyFromSync } from "../journal/keyStore";
import { FakeSyncServer } from "../sync/fakeServer";
import { DEFAULT_SYNC_URL, saveSyncSettings, syncOnce } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { verifierRow, keyFor } from "../test/journalKey";
import { checkPairingCode, codeAddressAllowed } from "./acceptCode";

// Review C1 (2026-11-17): what a device does with a v2 code. Fictional passphrases and addresses.

const PASS = "pretend-accept-code-passphrase";
const HERS = "https://sync.example.test";
const OTHER = "https://elsewhere.example.test";

let n = 0;
const open: HubDB[] = [];
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});
function device() {
  const d = new HubDB(`accept-code-${++n}`);
  open.push(d);
  return d;
}

async function code(p: { secret?: Uint8Array | null; serverUrl?: string | null; token?: string } = {}) {
  return {
    v: 2 as const,
    token: p.token ?? (await deriveToken(PASS)),
    secret: p.secret === undefined ? await deriveJournalSecret(PASS) : p.secret,
    serverUrl: p.serverUrl === undefined ? HERS : p.serverUrl,
  };
}

/** A device that syncs with HERS, journal confirmed with PASS. */
async function syncingDevice() {
  const d = device();
  const token = await deriveToken(PASS);
  await saveSyncSettings(d, { serverUrl: HERS, token });
  await saveJournalKeyFromSync(d, PASS);
  expect((await syncOnce({ db: d, fetch: new FakeSyncServer(token).fetch })).kind).toBe("ok");
  expect(await confirmJournalKey(d)).toBe("confirmed");
  return d;
}

describe("codeAddressAllowed (review M3)", () => {
  it("https anywhere; http only to this machine, and only in a dev build or when she typed that address herself", () => {
    expect(codeAddressAllowed(HERS, { dev: false })).toBe(true);
    for (const local of ["http://127.0.0.1:8790", "http://localhost:8787"]) {
      expect(codeAddressAllowed(local, { dev: false })).toBe(false);
      expect(codeAddressAllowed(local, { dev: true })).toBe(true);
      expect(codeAddressAllowed(local, { dev: false, typed: `${local}/` })).toBe(true);
    }
    expect(codeAddressAllowed("http://sync.example.test", { dev: true })).toBe(false);
    expect(codeAddressAllowed("ftp://sync.example.test", { dev: true })).toBe(false);
    expect(codeAddressAllowed("not an address", { dev: true })).toBe(false);
  });
});

describe("checkPairingCode (review C1)", () => {
  it("a new device: accepted; a non-default address must be confirmed, the usual one not", async () => {
    const d = device();
    expect(await checkPairingCode(d, await code(), { dev: false })).toEqual({
      ok: true, serverUrl: HERS, configured: false, journal: "new", confirmAddress: true, journalNeedsPassphrase: false,
    });
    expect(await checkPairingCode(d, await code({ serverUrl: null }), { dev: false })).toMatchObject({
      ok: true, serverUrl: DEFAULT_SYNC_URL, confirmAddress: false,
    });
    expect(await checkPairingCode(d, await code({ serverUrl: "http://127.0.0.1:8790" }), { dev: false })).toMatchObject({
      ok: false, why: "bad-address",
    });
  });

  it("a configured device with a different address: refused", async () => {
    const d = await syncingDevice();
    expect(await checkPairingCode(d, await code({ serverUrl: OTHER }), { dev: false })).toEqual({
      ok: false, why: "other-address", serverUrl: OTHER,
    });
    // The usual address is "different" too when this device syncs elsewhere.
    expect(await checkPairingCode(d, await code({ serverUrl: null }), { dev: false })).toMatchObject({ ok: false, why: "other-address" });
  });

  it("a configured device with a mismatched secret: refused; its own secret or none: nothing new for the journal", async () => {
    const d = await syncingDevice();
    expect(await checkPairingCode(d, await code({ secret: await deriveJournalSecret("pretend-other-journal") }), { dev: false })).toMatchObject({
      ok: false, why: "other-journal",
    });
    expect(await checkPairingCode(d, await code(), { dev: false })).toEqual({
      ok: true, serverUrl: HERS, configured: true, journal: "same", confirmAddress: false, journalNeedsPassphrase: false,
    });
    expect(await checkPairingCode(d, await code({ secret: null }), { dev: false })).toMatchObject({ ok: true, journal: "none" });
  });

  it("a device with only a verifier here (journal locked): a secret that doesn't open it is refused", async () => {
    const d = device();
    await d.journal.put(await verifierRow(await keyFor(PASS)));
    expect(await checkPairingCode(d, await code({ secret: await deriveJournalSecret("pretend-other-journal") }), { dev: false })).toMatchObject({
      ok: false, why: "other-journal",
    });
    expect(await checkPairingCode(d, await code(), { dev: false })).toMatchObject({ ok: true, journal: "new" });
  });

  it("a locked device with a retired key and no verifier to prove the code: sync only, never 'another journal' (review RI1)", async () => {
    const d = device();
    await saveSyncSettings(d, { serverUrl: HERS, token: await deriveToken(PASS) });
    const older = await keyFor("pretend-older-losing-key");
    await d.syncMeta.put({ key: "journalRetired", value: [{ key: older.key, mac: older.mac, fp: older.fp }] });
    expect(await checkPairingCode(d, await code(), { dev: false })).toEqual({
      ok: true, serverUrl: HERS, configured: true, journal: "none", confirmAddress: false, journalNeedsPassphrase: true,
    });
  });

  it("an http address this device already syncs with is allowed (it isn't new)", async () => {
    const d = device();
    await saveSyncSettings(d, { serverUrl: "http://127.0.0.1:8790", token: await deriveToken(PASS) });
    expect(await checkPairingCode(d, await code({ serverUrl: "http://127.0.0.1:8790" }), { dev: false })).toMatchObject({ ok: true, configured: true });
  });
});
