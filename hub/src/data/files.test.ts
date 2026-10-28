import { vi } from "vitest";
import { db } from "./db";
import { exportBackup, INVALID_BACKUP, restoreBackup } from "./backup";
import { addPicture, deleteGoal, deleteItem, emptyBin, getFile, saveGoalNotes } from "./repo";
import { MAX_FILE_DATA, MAX_NOTES_TEXT, validFile, validGoal, validItem } from "./validate";
import { pictureLine } from "../domain/page";
import type { FileRow, Goal, Item } from "../domain/types";

// Pictures on pages (round 3b): the `files` table is synced, validated, tracked and backed up
// like items and goals.

const today = "2026-10-28";
const PIXEL = "/9j/4AAQSkZJRgABAQ=="; // made-up base64 (valid shape, not a real image)
const file = (id: string, extra: Partial<FileRow> = {}): FileRow => ({
  id, mime: "image/jpeg", data: PIXEL, width: 40, height: 30, createdAt: "2026-10-20", ...extra,
});
const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `T ${id}`, links: [], areaId: "art", priority: 2,
  status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01", ...extra,
});
const goal = (id: string, extra: Partial<Goal> = {}): Goal => ({
  id, title: `G ${id}`, areaId: "art", kind: "practice", milestones: [], createdAt: "2026-10-01", ...extra,
});

let clock = 1_800_000_000_000;
beforeEach(async () => {
  clock = 1_800_000_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => clock);
  await Promise.all([db.items.clear(), db.goals.clear(), db.files.clear(), db.pending.clear(), db.syncMeta.clear()]);
});
afterEach(() => vi.restoreAllMocks());

describe("validFile", () => {
  it("accepts a picture row and a purged tombstone", () => {
    expect(validFile(file("f1"))).toBe(true);
    expect(validFile(file("f1", { updatedAt: 5 }))).toBe(true);
    expect(validFile(file("f1", { status: "purged", data: "", width: 0, height: 0 }))).toBe(true);
  });

  it.each([
    ["no id", { id: "" }],
    ["unknown type", { mime: "text/html" }],
    ["not base64", { data: "not base64!" }],
    ["base64 of the wrong length", { data: "abc" }],
    ["no data on a live picture", { data: "" }],
    ["too much data", { data: "A".repeat(MAX_FILE_DATA + 4) }],
    ["zero width", { width: 0 }],
    ["fractional height", { height: 2.5 }],
    ["bad date", { createdAt: "2026-02-30" }],
    ["unknown status", { status: "deleted" }],
    ["a tombstone that still has data", { status: "purged", width: 0, height: 0 }],
  ])("refuses %s", (_n, extra) => {
    expect(validFile({ ...file("f1"), ...extra })).toBe(false);
  });

  it("a picture just under the 700 KB the app aims for fits", () => {
    expect(validFile(file("big", { data: "A".repeat(Math.ceil(700_000 / 3) * 4) }))).toBe(true);
  });
});

describe("notes caps (round 3b)", () => {
  it("goal notes may hold up to 20,000 characters; item notes stay uncapped", () => {
    expect(MAX_NOTES_TEXT).toBe(20_000);
    expect(validGoal(goal("g", { notes: "x".repeat(20_000) }))).toBe(true);
    expect(validGoal(goal("g", { notes: "x".repeat(20_001) }))).toBe(false);
    expect(validGoal(goal("g", { why: "x".repeat(4001) }))).toBe(false); // why/cadence keep 4000
    expect(validItem(item("i", { notes: "x".repeat(30_000) }))).toBe(true);
  });
});

describe("writing pictures", () => {
  it("addPicture stores the row, stamped and marked pending for sync", async () => {
    const id = await addPicture({ mime: "image/jpeg", data: PIXEL, width: 40, height: 30 }, today);
    const row = await getFile(id);
    expect(row).toMatchObject({ id, mime: "image/jpeg", data: PIXEL, width: 40, height: 30, createdAt: today });
    expect(row!.updatedAt).toBe(clock);
    expect(await db.pending.get(["files", id])).toEqual({ table: "files", id, updatedAt: clock });
  });

  it("an invalid picture is never stored", async () => {
    await expect(db.files.add(file("bad", { data: "%%%" }))).rejects.toThrow(/picture could not be saved/);
    expect(await db.files.count()).toBe(0);
    expect(await db.pending.count()).toBe(0);
  });

  it("emptying the Bin purges the pictures only that page showed", async () => {
    await db.files.bulkAdd([file("p1"), file("p2"), file("shared"), file("g1")]);
    await db.items.bulkAdd([
      item("gone", { notes: `${pictureLine("p1")}\ntext ![](file:p2) inline\n${pictureLine("shared")}` }),
      item("keeps", { notes: pictureLine("shared") }),
    ]);
    await db.goals.add(goal("goal", { notes: `# Board\n${pictureLine("g1")}` }));
    await deleteItem("gone", today);
    await deleteGoal("goal", today);
    clock += 1000;
    expect(await emptyBin(today)).toBe(2);
    for (const id of ["p1", "p2", "g1"]) {
      expect(await db.files.get(id), id).toMatchObject({ id, data: "", width: 0, height: 0, status: "purged" });
      expect((await db.pending.get(["files", id]))!.updatedAt, id).toBe(clock);
    }
    expect(await db.files.get("shared")).toMatchObject({ data: PIXEL });
  });

  it("goal notes save up to the new cap", async () => {
    await db.goals.add(goal("g"));
    await saveGoalNotes("g", `# Page\n${"y".repeat(MAX_NOTES_TEXT - 7)}`);
    expect((await db.goals.get("g"))!.notes).toHaveLength(MAX_NOTES_TEXT);
  });
});

describe("backup with pictures", () => {
  it("export includes pictures and a replace restore brings them back", async () => {
    await db.items.add(item("a", { notes: pictureLine("f1") }));
    await db.files.add(file("f1"));
    const exported = JSON.parse(JSON.stringify(await exportBackup(today)));
    expect(exported.files).toHaveLength(1);
    await db.files.clear();
    await restoreBackup(exported, "replace");
    expect(await db.files.get("f1")).toMatchObject({ data: PIXEL, width: 40 });
  });

  it("merge adds only the missing pictures; replace with an older file (no pictures) clears them", async () => {
    await db.files.add(file("have", { width: 99 }));
    const backup = { app: "life-hub", schema: 1, exportedOn: today, items: [], goals: [], files: [file("have"), file("new")] };
    await restoreBackup(backup, "merge");
    expect((await db.files.get("have"))!.width).toBe(99);
    expect(await db.files.get("new")).toBeTruthy();
    await restoreBackup({ app: "life-hub", schema: 1, exportedOn: today, items: [], goals: [] }, "replace");
    expect(await db.files.count()).toBe(0);
  });

  it("a damaged picture makes the whole file refused", async () => {
    const backup = { app: "life-hub", schema: 1, exportedOn: today, items: [item("x")], goals: [], files: [file("f", { mime: "x" })] };
    await expect(restoreBackup(backup, "merge")).rejects.toThrow(INVALID_BACKUP);
    const dup = { app: "life-hub", schema: 1, exportedOn: today, items: [], goals: [], files: [file("f"), file("f")] };
    await expect(restoreBackup(dup, "merge")).rejects.toThrow(INVALID_BACKUP);
    expect(await db.items.count()).toBe(0);
  });
});
