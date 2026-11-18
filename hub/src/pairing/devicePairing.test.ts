import Dexie from "dexie";
import { HubDB } from "../data/db";
import { deriveJournalSecret } from "../journal/crypto";
import { giveOldPassphrase, saveJournalKeyFromSync, confirmJournalKey } from "../journal/keyStore";
import { FakeSyncServer } from "../sync/fakeServer";
import { DEFAULT_SYNC_URL, saveSyncSettings, syncOnce } from "../sync/engine";
import { deriveToken } from "../sync/token";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { pairingCodeForDevice } from "./devicePairing";
import { parsePairing } from "./pairingText";

// The v2 code a device that syncs shows (2026-11-17). Fictional passphrases only.

const PASS = "pretend-device-pairing-passphrase";
let n = 0;
const open: HubDB[] = [];
afterEach(async () => {
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});
function device() {
  const d = new HubDB(`device-pairing-${++n}`);
  open.push(d);
  return d;
}

describe("pairingCodeForDevice", () => {
  it("carries the token, the journal secret and the address; nothing without a token", async () => {
    const d = device();
    expect(await pairingCodeForDevice(d)).toBeNull();
    const token = await deriveToken(PASS);
    await saveSyncSettings(d, { serverUrl: "https://sync.example.test/", token });
    await saveJournalKeyFromSync(d, PASS);
    expect((await syncOnce({ db: d, fetch: new FakeSyncServer(token).fetch })).kind).toBe("ok");
    expect(await confirmJournalKey(d)).toBe("confirmed");
    const code = (await pairingCodeForDevice(d))!;
    expect(code.journal).toBe(true);
    expect(parsePairing(code.text)).toEqual({ v: 2, token, secret: await deriveJournalSecret(PASS), serverUrl: "https://sync.example.test" });
    expect(code.text).not.toContain(PASS);
  });

  it("leaves the usual address out", async () => {
    const d = device();
    await saveSyncSettings(d, { serverUrl: DEFAULT_SYNC_URL, token: await deriveToken(PASS) });
    const code = (await pairingCodeForDevice(d))!;
    expect(parsePairing(code.text)).toMatchObject({ v: 2, serverUrl: null });
  });

  it("sync only when this device has no copy of the journal secret; the old passphrase given once adds it", async () => {
    const d = device();
    await saveSyncSettings(d, { serverUrl: "https://sync.example.test", token: await deriveToken(PASS) });
    await confirmedDevice(d, await keyFor(PASS)); // a key from before the re-key update
    const code = (await pairingCodeForDevice(d))!;
    expect(code.journal).toBe(false);
    expect(parsePairing(code.text)).toMatchObject({ v: 2, secret: null });
    expect(await giveOldPassphrase(d, PASS)).toBe("ok");
    expect((await pairingCodeForDevice(d))!.journal).toBe(true);
  });
});
