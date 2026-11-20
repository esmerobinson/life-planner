import { vi } from "vitest";
import { db } from "./db";
import { exportBackup, restoreBackup } from "./backup";
import { deleteItem, emptyBin, saveDid } from "./repo";
import { validItem } from "./validate";
import { pictureLine } from "../domain/page";
import type { FileRow, Item } from "../domain/types";

// Photos on "What I did" notes (Esme, 19 Nov 2026): stored, checked, backed up and emptied from
// the Bin like a page's pictures. Made-up to-dos and made-up image bytes only.

const DAY = "2026-11-18";
const PIXEL = "/9j/4AAQSkZJRgABAQ==";
const file = (id: string): FileRow => ({ id, mime: "image/jpeg", data: PIXEL, width: 40, height: 30, createdAt: DAY });
const todo = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "writing", priority: 2, status: "done",
  completedAt: DAY, createdAt: "2026-11-01", touchedAt: "2026-11-01", ...extra,
});

let clock = 1_800_000_000_000;
beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await Promise.all([db.items.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
});
afterEach(() => vi.restoreAllMocks());

describe("the validator", () => {
  it("takes a to-do with photos; refuses bad photo lists and a tombstone that keeps them", () => {
    expect(validItem(todo("a", { did: [{ id: "note", on: DAY }], didPhotos: [{ entry: "note", ids: ["p1"] }] }))).toBe(true);
    expect(validItem(todo("b", { didPhotos: [] as never }))).toBe(false);
    expect(validItem(todo("c", { didPhotos: [{ entry: "note", ids: ["../x"] }] }))).toBe(false);
    const tomb = { ...todo("d"), title: "", status: "purged" as const, completedAt: undefined };
    expect(validItem(tomb)).toBe(true);
    expect(validItem({ ...tomb, didPhotos: [{ entry: "note", ids: ["p1"] }] })).toBe(false);
    expect(validItem(todo("e", { didPhotosGone: ["p1"] }))).toBe(true);
    expect(validItem(todo("f", { didPhotosGone: ["p1", "p1"] }))).toBe(false);
    expect(validItem({ ...tomb, didPhotosGone: ["p1"] })).toBe(false);
  });
});

describe("saveDid with photos", () => {
  it("adds and removes photos on a note; words and photos live side by side", async () => {
    await db.items.put(todo("t"));
    const at = { id: "note", on: DAY };
    expect(await saveDid("t", at, { addPhotos: ["p1"] }, DAY)).toBe(true);
    let it = (await db.items.get("t"))!;
    expect(it.did).toEqual([{ id: "note", on: DAY }]);
    expect(it.didPhotos).toEqual([{ entry: "note", ids: ["p1"] }]);
    await saveDid("t", at, { note: "Pretend painted" }, DAY);
    await saveDid("t", at, { addPhotos: ["p2"] }, DAY);
    it = (await db.items.get("t"))!;
    expect(it.did).toEqual([{ id: "note", on: DAY, note: "Pretend painted" }]);
    expect(it.didPhotos).toEqual([{ entry: "note", ids: ["p1", "p2"] }]);
    await saveDid("t", at, { note: "" }, DAY);
    await saveDid("t", at, { removePhoto: "p1" }, DAY);
    await saveDid("t", at, { removePhoto: "p2" }, DAY);
    it = (await db.items.get("t"))!;
    expect("did" in it).toBe(false);
    expect("didPhotos" in it).toBe(false);
    expect(it.didPhotosGone).toEqual(["p1", "p2"]); // so a device that syncs later doesn't bring them back
  });
});

describe("the Bin", () => {
  it("emptying the Bin empties a binned to-do's note photos, unless another row still shows them", async () => {
    await db.files.bulkAdd([file("p1"), file("shared")]);
    await db.items.bulkAdd([
      todo("gone", { did: [{ id: "note", on: DAY }], didPhotos: [{ entry: "note", ids: ["p1", "shared"] }] }),
      todo("keeps", { notes: pictureLine("shared") }),
    ]);
    await deleteItem("gone", DAY);
    // In the Bin, its photos are kept.
    expect((await db.items.get("gone"))!.didPhotos).toHaveLength(1);
    clock += 1000;
    await emptyBin(DAY);
    expect(await db.items.get("gone")).not.toHaveProperty("didPhotos");
    expect(await db.files.get("p1")).toMatchObject({ data: "", status: "purged" });
    expect(await db.files.get("shared")).toMatchObject({ data: PIXEL });
  });

  it("a page picture another to-do's note still shows is kept when its page is emptied", async () => {
    await db.files.add(file("both"));
    await db.items.bulkAdd([
      todo("page", { notes: pictureLine("both") }),
      todo("note", { did: [{ id: "note", on: DAY }], didPhotos: [{ entry: "note", ids: ["both"] }] }),
    ]);
    await deleteItem("page", DAY);
    await emptyBin(DAY);
    expect(await db.files.get("both")).toMatchObject({ data: PIXEL });
  });
});

it("a backup keeps note photos (the to-do's field and the picture rows)", async () => {
  await db.files.add(file("p1"));
  await db.items.add(todo("t", { did: [{ id: "note", on: DAY }], didPhotos: [{ entry: "note", ids: ["p1"] }] }));
  const backup = JSON.parse(JSON.stringify(await exportBackup(DAY)));
  await db.items.clear();
  await db.files.clear();
  await restoreBackup(backup, "replace");
  expect((await db.items.get("t"))!.didPhotos).toEqual([{ entry: "note", ids: ["p1"] }]);
  expect(await db.files.get("p1")).toMatchObject({ data: PIXEL });
});
