import Dexie from "dexie";
import { vi } from "vitest";
import { HubDB } from "../data/db";
import { deriveJournalKey, fileAad, journalAad, openBytes, openJson, sealJson, toBase64 } from "../journal/crypto";
import type { MorningEntry } from "../journal/entries";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// The journal and its encrypted photos sync like every other row (journal brief §3): the
// server only ever sees sealed rows; another device with the same key opens them.

const TOKEN = "70e4".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
let clock = 1_800_000_000_000;
let n = 0;
const open: HubDB[] = [];
let key: CryptoKey;
beforeAll(async () => {
  key = await deriveJournalKey("pretend passphrase");
});
beforeEach(() => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock++);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function device(name: string) {
  const d = new HubDB(`journal-sync-${name}-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

const morning = async (date: string, entry: MorningEntry) => {
  const id = `morning:${date}`;
  return { id, kind: "morning" as const, date, ...(await sealJson(key, entry, journalAad(id))) };
};

it("a journal entry and an encrypted photo travel from the phone to the Mac, sealed all the way", async () => {
  const server = new FakeSyncServer(TOKEN);
  const phone = await device("phone");
  const mac = await device("mac");
  const jpeg = Uint8Array.from([255, 216, 255, 224, 9, 9]);
  const photo = await (await import("../journal/crypto")).sealBytes(key, jpeg, fileAad("ph1"));
  await phone.files.add({
    id: "ph1", mime: "image/jpeg", data: photo.ct, iv: photo.iv, encrypted: true, width: 4, height: 3, createdAt: "2026-10-28",
  });
  await phone.journal.add(await morning("2026-10-28", { v: 1, text: "Pretend secret words", pages: 1, photos: ["ph1"] }));

  expect(await syncOnce({ db: phone, fetch: server.fetch })).toMatchObject({ kind: "ok", sent: 2 });
  // What the server holds: no plaintext anywhere.
  const onServer = JSON.stringify([...server.rows.values()]);
  expect(onServer).not.toContain("Pretend");
  expect(onServer).not.toContain(toBase64(jpeg));
  expect(server.data("journal", "morning:2026-10-28")).toMatchObject({ kind: "morning", date: "2026-10-28" });

  expect(await syncOnce({ db: mac, fetch: server.fetch })).toMatchObject({ kind: "ok", received: 2 });
  const row = (await mac.journal.get("morning:2026-10-28"))!;
  expect((await openJson<MorningEntry>(key, row, journalAad(row.id))).text).toBe("Pretend secret words");
  const f = (await mac.files.get("ph1"))!;
  expect(await openBytes(key, { iv: f.iv!, ct: f.data }, fileAad("ph1"))).toEqual(jpeg);
  expect(await mac.pending.count()).toBe(0);
});

it("two devices editing the same day merge by last write wins", async () => {
  const server = new FakeSyncServer(TOKEN);
  const phone = await device("phone");
  const mac = await device("mac");
  await phone.journal.put(await morning("2026-10-28", { v: 1, text: "", pages: 0, draft: "Pretend phone", photos: [] }));
  await mac.journal.put(await morning("2026-10-28", { v: 1, text: "Pretend mac", pages: 1, photos: [] })); // later
  await syncOnce({ db: phone, fetch: server.fetch });
  await syncOnce({ db: mac, fetch: server.fetch });
  await syncOnce({ db: phone, fetch: server.fetch });
  for (const d of [phone, mac]) {
    const r = (await d.journal.get("morning:2026-10-28"))!;
    expect((await openJson<MorningEntry>(key, r, journalAad(r.id))).pages).toBe(1);
  }
});

it("a journal row an older build held in quarantine applies once this build has the table", async () => {
  const server = new FakeSyncServer(TOKEN);
  const phone = await device("phone");
  const sealed = await morning("2026-10-27", { v: 1, text: "Pretend", pages: 1, photos: [] });
  await phone.quarantine.put({
    table: "journal", id: sealed.id, updatedAt: 42, data: { ...sealed, updatedAt: 42 },
    reason: "A later version of the app syncs this.", cursor: 0,
  });
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  expect(await phone.quarantine.count()).toBe(0);
  expect(await phone.journal.get(sealed.id)).toMatchObject({ kind: "morning", date: "2026-10-27", updatedAt: 42 });
});

it("a journal row that carries plaintext from elsewhere is held, never applied", async () => {
  const server = new FakeSyncServer(TOKEN);
  const phone = await device("phone");
  const bad = { ...(await morning("2026-10-26", { v: 1, text: "x", pages: 1, photos: [] })), text: "Pretend leak" };
  await server.fetch(`${SERVER}/v1/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ deviceId: "other-device-1", cursor: 0, changes: [{ table: "journal", id: bad.id, updatedAt: 9, data: { ...bad, updatedAt: 9 } }] }),
  });
  expect((await syncOnce({ db: phone, fetch: server.fetch })).kind).toBe("ok");
  expect(await phone.journal.count()).toBe(0);
  expect(await phone.quarantine.count()).toBe(1);
});
