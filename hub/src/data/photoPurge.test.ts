import { vi } from "vitest";
import { db } from "./db";
import { PHOTO_PURGE_GRACE_MS, sweepRemovedPhotos } from "./photoPurge";
import { deleteGoal, deleteItem, emptyBin, saveDid, saveGoalNotes, saveItemNotes } from "./repo";
import { pictureLine } from "../domain/page";
import type { FileRow, Goal, Item } from "../domain/types";

// A removed photo is really deleted (review I1, 20 Nov 2026): once nothing shows it any more, its
// file row becomes the content-free "purged" tombstone sync already carries, after a short grace
// period (room to put it back). Emptying the Bin also deletes photos removed earlier from what is
// emptied. Made-up rows and image bytes only.

const DAY = "2026-11-20";
const PIXEL = "/9j/4AAQSkZJRgABAQ==";
const file = (id: string, extra: Partial<FileRow> = {}): FileRow => ({ id, mime: "image/jpeg", data: PIXEL, width: 40, height: 30, createdAt: DAY, ...extra });
const todo = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "art", priority: 2, status: "done",
  completedAt: DAY, createdAt: "2026-11-01", touchedAt: "2026-11-01", ...extra,
});
const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({
  id, title: `Pretend ${id}`, areaId: "art", kind: "practice", milestones: [], createdAt: "2026-11-01", ...extra,
});
const at = { id: "note", on: DAY };
const isPurged = async (id: string) => {
  const f = await db.files.get(id);
  return f?.status === "purged" && f.data === "";
};

let clock = 1_800_000_000_000;
beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await Promise.all([db.items.clear(), db.goals.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
});
afterEach(() => vi.restoreAllMocks());

it("the reviewer's repro: add a photo to a note, Remove it, delete the to-do, empty the Bin: the photo is gone", async () => {
  await db.files.add(file("p1"));
  await db.items.add(todo("t"));
  await saveDid("t", at, { addPhotos: ["p1"] }, DAY);
  await saveDid("t", at, { removePhoto: "p1" }, DAY);
  await deleteItem("t", DAY);
  await emptyBin(DAY); // well inside the grace period: emptying doesn't wait
  expect(await isPurged("p1")).toBe(true);
  expect(await db.pending.get(["files", "p1"])).toBeDefined(); // sent, so every device drops it
});

it("Remove on a note: kept through the grace period, then deleted", async () => {
  await db.files.add(file("p1"));
  await db.items.add(todo("t"));
  await saveDid("t", at, { addPhotos: ["p1"] }, DAY);
  await saveDid("t", at, { removePhoto: "p1" }, DAY);
  await sweepRemovedPhotos(clock + PHOTO_PURGE_GRACE_MS - 1);
  expect(await isPurged("p1")).toBe(false);
  await sweepRemovedPhotos(clock + PHOTO_PURGE_GRACE_MS);
  expect(await isPurged("p1")).toBe(true);
});

it("a picture line taken off a to-do's or a goal's page is deleted after the grace period", async () => {
  await db.files.bulkAdd([file("pg"), file("gg")]);
  await db.items.add(todo("t", { notes: `a\n${pictureLine("pg")}` }));
  await db.goals.add(goal("g", { notes: pictureLine("gg") }));
  await saveItemNotes("t", "a", DAY);
  await saveGoalNotes("g", "");
  await sweepRemovedPhotos(clock + PHOTO_PURGE_GRACE_MS);
  expect(await isPurged("pg")).toBe(true);
  expect(await isPurged("gg")).toBe(true);
});

it("put back within the grace period (or still shown anywhere else, the Bin included): never deleted", async () => {
  await db.files.bulkAdd([file("back"), file("shared"), file("binned")]);
  await db.items.bulkAdd([
    todo("t", { notes: `${pictureLine("back")}\n${pictureLine("shared")}\n${pictureLine("binned")}` }),
    todo("other", { did: [{ id: "note", on: DAY }], didPhotos: [{ entry: "note", ids: ["shared"] }] }),
    todo("inBin", { status: "deleted", deletedAt: DAY, notes: pictureLine("binned") }),
  ]);
  await saveItemNotes("t", "x", DAY);
  clock += 5_000;
  await saveItemNotes("t", pictureLine("back"), DAY); // put back (an undo, another device's edit)
  await sweepRemovedPhotos(clock + PHOTO_PURGE_GRACE_MS);
  for (const id of ["back", "shared", "binned"]) expect(await isPurged(id), id).toBe(false);
  // Nothing is left waiting: a later removal starts its own grace period.
  expect(await db.syncMeta.get("removedPhotos")).toMatchObject({ value: [] });
});

it("emptying the Bin deletes photos removed earlier from a binned to-do's page and from a goal's", async () => {
  await db.files.bulkAdd([file("pg"), file("gg"), file("kept")]);
  await db.items.bulkAdd([todo("t", { notes: `${pictureLine("pg")}\n${pictureLine("kept")}` })]);
  await db.goals.add(goal("g", { notes: pictureLine("gg") }));
  await saveItemNotes("t", pictureLine("kept"), DAY);
  await saveGoalNotes("g", "");
  await deleteItem("t", DAY);
  await deleteGoal("g", DAY);
  await emptyBin(DAY);
  for (const id of ["pg", "gg", "kept"]) expect(await isPurged(id), id).toBe(true);
});

it("a journal photo (sealed) is never touched", async () => {
  await db.files.add(file("sealed", { encrypted: true, iv: "AAAAAAAAAAAAAAAAAAAAAA==".slice(0, 16) }));
  await db.items.add(todo("t", { notes: pictureLine("sealed") }));
  await saveItemNotes("t", "", DAY);
  await sweepRemovedPhotos(clock + PHOTO_PURGE_GRACE_MS);
  expect(await db.files.get("sealed")).toMatchObject({ data: PIXEL });
});

it("deleted by itself once the grace period has passed (no later action needed)", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await db.files.add(file("p1"));
    await db.items.add(todo("t"));
    await saveDid("t", at, { addPhotos: ["p1"] }, DAY);
    await saveDid("t", at, { removePhoto: "p1" }, DAY);
    clock += PHOTO_PURGE_GRACE_MS + 2_000;
    await vi.advanceTimersByTimeAsync(PHOTO_PURGE_GRACE_MS + 2_000);
    vi.useRealTimers();
    await vi.waitFor(async () => expect(await isPurged("p1")).toBe(true));
  } finally {
    vi.useRealTimers();
  }
});

it("emptying the Bin also deletes photos another device removed from the binned to-do's notes (its didPhotosGone)", async () => {
  await db.files.add(file("elsewhere"));
  await db.items.add(todo("t", { did: [{ id: "note", on: DAY, note: "Pretend" }], didPhotosGone: ["elsewhere"] }));
  await deleteItem("t", DAY);
  await emptyBin(DAY);
  expect(await isPurged("elsewhere")).toBe(true);
});
