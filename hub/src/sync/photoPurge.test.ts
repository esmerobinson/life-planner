import Dexie from "dexie";
import { vi } from "vitest";
import { db, HubDB } from "../data/db";
import { PHOTO_PURGE_GRACE_MS, sweepRemovedPhotos } from "../data/photoPurge";
import { saveDid, saveItemNotes } from "../data/repo";
import { pictureLine } from "../domain/page";
import type { FileRow, Item } from "../domain/types";
import { applyDidPatch } from "../domain/whatIDid";
import { FakeSyncServer } from "./fakeServer";
import { saveSyncSettings, syncOnce } from "./engine";

// Deleting removed photos across devices (re-review RI1 and RM2, 20 Nov 2026), through the fake
// server. The Mac is the app's own database (its repo writes there); the phone is a second one.
// Made-up rows and image bytes only.

const TOKEN = "beef".padEnd(64, "0"); // fake
const SERVER = "https://sync.example.test";
const DAY = "2026-11-20";
let clock = 1_900_000_000_000;
let n = 0;
const open: HubDB[] = [];

beforeEach(async () => {
  clock = 1_900_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await Promise.all([db.items.clear(), db.goals.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear(), db.quarantine.clear()]);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const d of open.splice(0)) {
    d.close();
    await Dexie.delete(d.name);
  }
});

async function phoneDb() {
  const d = new HubDB(`purge-phone-${++n}`);
  open.push(d);
  await saveSyncSettings(d, { serverUrl: SERVER, token: TOKEN });
  return d;
}
const picture = (id: string): FileRow => ({ id, mime: "image/jpeg", data: "/9j/4AAQ", width: 40, height: 30, createdAt: DAY });
const todo = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: "Pretend page", links: [], areaId: "art", priority: 2, status: "done",
  completedAt: DAY, createdAt: DAY, touchedAt: DAY, ...extra,
});
const data = async (d: HubDB, id: string) => (await d.files.get(id))?.data;

async function setUp(row: Item) {
  const server = new FakeSyncServer(TOKEN);
  await saveSyncSettings(db, { serverUrl: SERVER, token: TOKEN });
  await db.items.add(row);
  await syncOnce({ db, fetch: server.fetch });
  const phone = await phoneDb();
  await syncOnce({ db: phone, fetch: server.fetch });
  return { server, phone };
}

it("RI1, the reviewer's repro: the phone adds a photo, the Mac saves a draft without it after pulling: the photo survives everywhere", async () => {
  const { server, phone } = await setUp(todo("a", { notes: "draft" }));
  // 1. The phone adds photo P to the page and syncs.
  clock += 60_000;
  await phone.files.add(picture("P"));
  await phone.items.put({ ...(await phone.items.get("a"))!, notes: `draft\n${pictureLine("P")}` });
  await syncOnce({ db: phone, fetch: server.fetch });
  // 2. The Mac pulls that while she is typing (its editor never shows P) ...
  await syncOnce({ db, fetch: server.fetch });
  expect((await db.items.get("a"))!.notes).toContain("file:P");
  // 3. ... and her draft, made on "draft", is saved.
  clock += 1_000;
  await saveItemNotes("a", "draft and more words", DAY, "draft");
  clock += PHOTO_PURGE_GRACE_MS + 1_000;
  await sweepRemovedPhotos();
  for (let k = 0; k < 2; k++) {
    await syncOnce({ db, fetch: server.fetch });
    await syncOnce({ db: phone, fetch: server.fetch });
  }
  await sweepRemovedPhotos(clock + PHOTO_PURGE_GRACE_MS);
  await sweepRemovedPhotos(clock + PHOTO_PURGE_GRACE_MS, phone);
  expect(await data(db, "P")).toBe("/9j/4AAQ");
  expect(await data(phone, "P")).toBe("/9j/4AAQ");
  expect(server.data("files", "P")).toMatchObject({ data: "/9j/4AAQ" });
});

it("RM2: removed on one device while an offline device edits that note's words: the photo's data doesn't come back", async () => {
  const at = { id: "note", on: DAY };
  const { server, phone } = await setUp(todo("b", { did: [{ id: "note", on: DAY, note: "Pretend" }] }));
  await db.files.add(picture("P"));
  await saveDid("b", at, { addPhotos: ["P"] }, DAY);
  await syncOnce({ db, fetch: server.fetch });
  await syncOnce({ db: phone, fetch: server.fetch });
  // The Mac removes P and syncs; the phone, offline, then edits the note's words.
  clock += 60_000;
  await saveDid("b", at, { removePhoto: "P" }, DAY);
  await syncOnce({ db, fetch: server.fetch });
  clock += 60_000;
  const row = (await phone.items.get("b"))!;
  await phone.items.put({ ...row, ...applyDidPatch(row, at, { note: "Pretend, and more" }) });
  // The Mac's grace period ends: P is deleted there.
  clock += PHOTO_PURGE_GRACE_MS;
  await sweepRemovedPhotos();
  expect(await data(db, "P")).toBe("");
  // Both sync, the Mac first: the phone's put-back runs while its own (newer) row still shows P.
  for (let k = 0; k < 3; k++) {
    await syncOnce({ db, fetch: server.fetch });
    await syncOnce({ db: phone, fetch: server.fetch });
  }
  expect((await db.items.get("b"))!.didPhotos).toBeUndefined(); // the merge keeps it off the note
  // Each device's grace period, then a sweep, then sync.
  clock += PHOTO_PURGE_GRACE_MS + 1_000;
  await sweepRemovedPhotos();
  await sweepRemovedPhotos(clock, phone);
  for (let k = 0; k < 2; k++) {
    await syncOnce({ db, fetch: server.fetch });
    await syncOnce({ db: phone, fetch: server.fetch });
  }
  expect((await phone.items.get("b"))!.didPhotos).toBeUndefined();
  expect(await data(db, "P")).toBe("");
  expect(await data(phone, "P")).toBe("");
  expect(server.data("files", "P")).toMatchObject({ data: "", status: "purged" });
});
