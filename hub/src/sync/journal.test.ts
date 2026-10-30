import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import {
  addMorningPhoto, ensureCheckinSet, finishMorningPage, readCheckinDay, readMorningDay, readMorningPage, saveAnswer,
  saveMorningDraft,
} from "../data/repo";
import { journalId } from "../data/validate";
import { fileAad, journalAad, openBytes, promptKey, sealBytes, sealJson, toBase64, type JournalKey } from "../journal/crypto";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// The journal syncs like every other row, sealed all the way (journal brief §3). Every part of
// a day is its own row, so two devices writing the same day offline lose nothing (review C2).
// The Mac here is the app's own database (the repo writes to it); the phone is a second
// database whose rows are sealed exactly as the repo seals them.

const TOKEN = "70e4".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const DAY = "2026-10-28";
const MAC = "device-mac-0001";
const PHONE = "device-phone-01";
let clock = 1_800_000_000_000;
let n = 0;
const open: HubDB[] = [];
let jk: JournalKey;
beforeAll(async () => {
  jk = await keyFor("fake-journal-sync");
});
beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock++);
  await Promise.all([db.journal.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear()]);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  await confirmedDevice(db, jk);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function phoneDevice() {
  const d = new HubDB(`journal-sync-phone-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}

/** A row sealed as the repo seals it. */
async function sealed(kind: string, date: string, suffix: string | undefined, entry: unknown) {
  const id = journalId(kind as never, date, suffix);
  return { id, kind: kind as never, date, fp: jk.fp, ...(await sealJson(jk.key, entry, journalAad(id))) };
}

async function phonePhoto(phone: HubDB, fileId: string) {
  const jpeg = Uint8Array.from([255, 216, 255, 224, 9, 9]);
  const s = await sealBytes(jk.key, jpeg, fileAad(fileId));
  await phone.files.add({ id: fileId, mime: "image/jpeg", data: s.ct, iv: s.iv, fp: jk.fp, encrypted: true, width: 4, height: 3, createdAt: DAY });
  await phone.journal.add(await sealed("photo", DAY, fileId, { v: 1, fileId, at: clock }));
  return jpeg;
}

it("a page and an encrypted photo travel between devices sealed; the server never sees plaintext", async () => {
  const server = new FakeSyncServer(TOKEN);
  const phone = await phoneDevice();
  const jpeg = await phonePhoto(phone, "ph1");
  const pageId = await finishMorningPage(jk, "2026-09-01", MAC, "Pretend secret words");
  await syncOnce({ db: phone, fetch: server.fetch });
  await syncOnce({ db, fetch: server.fetch });
  await syncOnce({ db: phone, fetch: server.fetch });
  const onServer = JSON.stringify([...server.rows.values()]);
  expect(onServer).not.toContain("Pretend");
  expect(onServer).not.toContain(toBase64(jpeg));
  const f = (await db.files.get("ph1"))!;
  expect(await openBytes(jk.key, { iv: f.iv!, ct: f.data }, fileAad("ph1"))).toEqual(jpeg);
  expect(await phone.journal.get(pageId)).toBeTruthy();
  expect(await readMorningPage(jk, pageId, "2026-12-01")).toEqual({ state: "ok", text: "Pretend secret words" });
});

it("offline overlap: a photo on the phone and a finished page on the Mac — both survive everywhere", async () => {
  const server = new FakeSyncServer(TOKEN);
  const phone = await phoneDevice();
  await phonePhoto(phone, "ph1"); // 07:00, phone offline
  await saveMorningDraft(jk, DAY, MAC, "Pretend draft"); // 07:05 on the Mac
  await finishMorningPage(jk, DAY, MAC, "Pretend page"); // 07:30, later stamps
  await syncOnce({ db, fetch: server.fetch });
  await syncOnce({ db: phone, fetch: server.fetch });
  await syncOnce({ db, fetch: server.fetch });
  expect(await readMorningDay(jk, DAY, MAC)).toMatchObject({ done: true, pages: 1, photos: ["ph1"], draft: "" });
  const phoneKinds = (await phone.journal.where("date").equals(DAY).toArray()).map((r) => r.kind).sort();
  expect(phoneKinds).toEqual(["draft", "page", "photo"]);
});

it("offline overlap the other way: a finished page on the phone, a photo on the Mac — the page is never erased", async () => {
  const server = new FakeSyncServer(TOKEN);
  const phone = await phoneDevice();
  await phone.journal.add(await sealed("page", DAY, "phonepage1", { v: 1, text: "Pretend phone page", at: clock }));
  await addMorningPhoto(jk, DAY, { mime: "image/jpeg", data: toBase64(Uint8Array.from([255, 216, 1])), width: 4, height: 3 });
  await syncOnce({ db: phone, fetch: server.fetch });
  await syncOnce({ db, fetch: server.fetch });
  const day = await readMorningDay(jk, DAY, MAC);
  expect(day.pages).toBe(1);
  expect(day.photos).toHaveLength(1);
  expect(await readMorningPage(jk, `page:${DAY}:phonepage1`, "2026-12-01")).toEqual({ state: "ok", text: "Pretend phone page" });
});

it("two check-ins started offline with different questions: every answer is kept", async () => {
  const server = new FakeSyncServer(TOKEN);
  const phone = await phoneDevice();
  // The phone opens first (offline) with its three and answers two.
  await phone.journal.add(await sealed("set", DAY, undefined, { v: 1, prompts: ["M1", "D3", "K5"], at: clock }));
  await phone.journal.add(await sealed("answer", DAY, "M1", { v: 1, prompt: "M1", answer: "Pretend phone M1", done: true, at: clock }));
  await phone.journal.add(await sealed("answer", DAY, "D3", { v: 1, prompt: "D3", answer: "Pretend phone D3", done: true, at: clock }));
  // The Mac (not synced) opens later in the evening with other questions and answers them.
  await ensureCheckinSet(jk, DAY, ["M6", "E5", "K2"]);
  await saveAnswer(jk, DAY, "M6", MAC, "Pretend mac M6", true);
  await saveAnswer(jk, DAY, "K2", MAC, "Pretend mac K2", true);
  await syncOnce({ db: phone, fetch: server.fetch });
  await syncOnce({ db, fetch: server.fetch });
  const day = await readCheckinDay(jk, DAY);
  // One set wins (the Mac's, written last); the other set's answered questions follow it.
  expect(day.prompts.slice(0, 3)).toEqual(["M6", "E5", "K2"]);
  expect(new Set(day.prompts.slice(3))).toEqual(new Set(["M1", "D3"]));
  for (const [p, text] of [["M1", "Pretend phone M1"], ["D3", "Pretend phone D3"], ["M6", "Pretend mac M6"], ["K2", "Pretend mac K2"]]) {
    expect(day.answers.get(p!)?.answer).toBe(text);
    expect(day.prompts).toContain(p);
  }
});

it("the phone answers, the Mac (not yet synced) skips the same question: the phone's answer survives everywhere", async () => {
  const server = new FakeSyncServer(TOKEN);
  const phone = await phoneDevice();
  await ensureCheckinSet(jk, DAY, ["M1", "D3", "K2"]);
  await syncOnce({ db, fetch: server.fetch });
  await syncOnce({ db: phone, fetch: server.fetch }); // both have the day's questions
  // The phone answers M1 in its own row (as the repo writes it).
  const pk = await promptKey(jk, "M1");
  await phone.journal.add(await sealed("answer", DAY, `${pk}:${PHONE}`, { v: 1, prompt: "M1", answer: "Pretend phone answer", done: true, at: clock }));
  // Later, the Mac skips M1 without having pulled the phone's answer.
  await saveAnswer(jk, DAY, "M1", MAC, null, true);
  await syncOnce({ db: phone, fetch: server.fetch });
  await syncOnce({ db, fetch: server.fetch });
  await syncOnce({ db: phone, fetch: server.fetch });
  expect((await readCheckinDay(jk, DAY)).answers.get("M1")).toMatchObject({ answer: "Pretend phone answer", done: true });
  expect(await phone.journal.where("kind").equals("answer").count()).toBe(2); // both rows, nothing replaced
  const ids = (await phone.journal.where("kind").equals("answer").toArray()).map((r) => r.id);
  expect(ids.every((id) => !id.includes("M1"))).toBe(true);
});

it("a journal row an older build held in quarantine applies once this build has the table", async () => {
  const server = new FakeSyncServer(TOKEN);
  const row = await sealed("page", "2026-10-27", "q1", { v: 1, text: "Pretend", at: 1 });
  await db.quarantine.put({
    table: "journal", id: row.id, updatedAt: 42, data: { ...row, updatedAt: 42 },
    reason: "A later version of the app syncs this.", cursor: 0,
  });
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect(await db.quarantine.count()).toBe(0);
  expect(await db.journal.get(row.id)).toMatchObject({ kind: "page", date: "2026-10-27", updatedAt: 42 });
});

it("a journal row that carries plaintext from elsewhere is held, never applied", async () => {
  const server = new FakeSyncServer(TOKEN);
  const bad = { ...(await sealed("page", "2026-10-26", "leak1", { v: 1, text: "x", at: 1 })), text: "Pretend leak" };
  await server.fetch(`${SERVER}/v1/sync`, {
    method: "POST", headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ deviceId: "other-device-1", cursor: 0, changes: [{ table: "journal", id: bad.id, updatedAt: 9, data: { ...bad, updatedAt: 9 } }] }),
  });
  expect((await syncOnce({ db, fetch: server.fetch })).kind).toBe("ok");
  expect(await db.journal.get(bad.id)).toBeUndefined();
  expect(await db.quarantine.count()).toBe(1);
});

it("the server accepting the token records it (what confirms a journal key)", async () => {
  const server = new FakeSyncServer(TOKEN);
  const v = (await db.syncMeta.get("tokenVersion"))!.value;
  await syncOnce({ db, fetch: server.fetch });
  expect((await db.syncMeta.get("acceptedToken"))!.value).toBe(TOKEN);
  expect((await db.syncMeta.get("tokenVersion"))!.value).toBe(v);
});
