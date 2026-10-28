import { describe, it, expect, beforeEach } from "vitest";
import { db } from "./db";
import { validItem } from "./validate";
import {
  createItem, deleteItem, emptyBin, fileItem, listBin, listItems, putItemBack, restoreFromBin, saveItemNotes,
  updateItem,
} from "./repo";
import { exportBackup, parseBackup, restoreBackup } from "./backup";

const today = "2026-10-28";
const inboxItem = { kind: "task" as const, title: "Ask about the old house", areaId: "inbox" as const, priority: 2 as const };

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
  await db.pending.clear();
});

const row = (extra: Record<string, unknown> = {}) => ({
  id: "r1", kind: "task", title: "A thing", links: [], areaId: "art", priority: 2,
  status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01", ...extra,
});

describe("validator: Bin statuses", () => {
  it("accepts a deleted row with a deletedAt date", () => {
    expect(validItem(row({ status: "deleted", deletedAt: "2026-10-28" }))).toBe(true);
  });
  it("accepts a purged tombstone with an empty title", () => {
    expect(validItem(row({ status: "purged", title: "" }))).toBe(true);
  });
  it("refuses a deletedAt that is not a real date, and unknown statuses", () => {
    expect(validItem(row({ status: "deleted", deletedAt: "yesterday" }))).toBe(false);
    expect(validItem(row({ status: "gone" }))).toBe(false);
  });
  it("refuses a purged row that still carries content", () => {
    expect(validItem(row({ status: "purged", title: "still here" }))).toBe(false);
    expect(validItem(row({ status: "purged", title: "", notes: "secret" }))).toBe(false);
    expect(validItem(row({ status: "purged", title: "", tags: ["x"] }))).toBe(false);
    expect(validItem(row({ status: "purged", title: "", links: ["https://example.test"] }))).toBe(false);
  });
});

describe("delete, restore and the Bin", () => {
  it("delete moves an item to the Bin: hidden from listItems, listed by listBin", async () => {
    const it1 = await createItem(inboxItem, "2026-10-01");
    await deleteItem(it1.id, today);
    const got = (await db.items.get(it1.id))!;
    expect(got).toMatchObject({ status: "deleted", deletedAt: today, touchedAt: today, areaId: "inbox" });
    expect(await listItems()).toEqual([]);
    expect((await listBin()).map((i) => i.id)).toEqual([it1.id]);
  });

  it("the Bin lists newest deletions first", async () => {
    const a = await createItem({ ...inboxItem, title: "first" }, "2026-10-01");
    const b = await createItem({ ...inboxItem, title: "second" }, "2026-10-01");
    await deleteItem(a.id, "2026-10-20");
    await deleteItem(b.id, "2026-10-25");
    expect((await listBin()).map((i) => i.title)).toEqual(["second", "first"]);
  });

  it("restore puts it back as open in its own area, without deletedAt", async () => {
    const it1 = await createItem({ ...inboxItem, areaId: "writing" }, "2026-10-01");
    await deleteItem(it1.id, "2026-10-20");
    await restoreFromBin(it1.id, today);
    const got = (await db.items.get(it1.id))!;
    expect(got.status).toBe("open");
    expect(got.areaId).toBe("writing");
    expect("deletedAt" in got).toBe(false);
    expect(await listBin()).toEqual([]);
  });

  it("emptying replaces every deleted row with a purged tombstone and returns how many", async () => {
    const a = await createItem({ ...inboxItem, title: "secret one", notes: "private", tags: ["from-daily-notes"], links: ["https://example.test"], source: { kind: "backlog", key: "backlog:secret one" } }, "2026-10-01");
    const keep = await createItem({ ...inboxItem, title: "stays" }, "2026-10-01");
    await deleteItem(a.id, "2026-10-20");
    const before = (await db.items.get(a.id))!;
    const n = await emptyBin(today);
    expect(n).toBe(1);
    const tomb = (await db.items.get(a.id))!;
    expect(tomb).toEqual({
      id: a.id, kind: "task", title: "", links: [], areaId: "inbox", priority: 2,
      status: "purged", createdAt: "2026-10-01", touchedAt: today, updatedAt: tomb.updatedAt,
    });
    expect(tomb.updatedAt!).toBeGreaterThan(before.updatedAt!);
    expect(validItem(tomb)).toBe(true);
    // Hidden everywhere, including the Bin.
    expect(await listBin()).toEqual([]);
    expect((await listItems()).map((i) => i.id)).toEqual([keep.id]);
    // Marked pending, so the tombstone syncs.
    expect(await db.pending.get(["items", a.id])).toMatchObject({ updatedAt: tomb.updatedAt });
  });

  it("emptying an empty Bin changes nothing", async () => {
    await createItem(inboxItem, "2026-10-01");
    expect(await emptyBin(today)).toBe(0);
  });

  it("listItems never returns deleted or purged rows, even when asked for a status", async () => {
    const a = await createItem(inboxItem, "2026-10-01");
    await deleteItem(a.id, today);
    expect(await listItems({ status: "open" })).toEqual([]);
    await emptyBin(today);
    expect(await listItems({ status: "archived" })).toEqual([]);
  });
});

describe("filing from the sort card", () => {
  it("To-do files it as a task in the chosen area", async () => {
    const it1 = await createItem({ ...inboxItem, kind: "idea" }, "2026-10-01");
    await fileItem(it1.id, "task", "writing", today);
    expect(await db.items.get(it1.id)).toMatchObject({ kind: "task", areaId: "writing", status: "open", touchedAt: today });
  });

  it("Idea files it as an idea and drops due, repeat and day pins", async () => {
    const it1 = await createItem({ ...inboxItem, due: "2026-11-01", recur: ["mon"], pinnedDate: "2026-10-29" }, "2026-10-01");
    await fileItem(it1.id, "idea", "art", today);
    const got = (await db.items.get(it1.id))!;
    expect(got).toMatchObject({ kind: "idea", areaId: "art" });
    expect(got.due).toBeUndefined();
    expect(got.recur).toBeUndefined();
    expect(got.pinnedDate).toBeUndefined();
  });

  it("Goal turns it into a practice goal in that area and archives the item", async () => {
    const it1 = await createItem({ ...inboxItem, notes: "why it matters" }, "2026-10-01");
    const goal = await fileItem(it1.id, "goal", "body", today);
    expect(goal).toMatchObject({ title: inboxItem.title, areaId: "body", kind: "practice", notes: "why it matters" });
    expect((await db.items.get(it1.id))!.status).toBe("archived");
  });

  it("refuses the inbox as a destination", async () => {
    const it1 = await createItem(inboxItem, "2026-10-01");
    await expect(fileItem(it1.id, "task", "inbox", today)).rejects.toThrow();
    expect((await db.items.get(it1.id))!.areaId).toBe("inbox");
  });

  it("saveItemNotes saves the text, and an empty box removes the notes", async () => {
    const it1 = await createItem(inboxItem, "2026-10-01");
    await saveItemNotes(it1.id, "call first", today);
    expect((await db.items.get(it1.id))!.notes).toBe("call first");
    await saveItemNotes(it1.id, "   ", today);
    expect("notes" in (await db.items.get(it1.id))!).toBe(false);
  });

  it("putItemBack restores the exact earlier row (undo), re-stamped", async () => {
    const it1 = await createItem({ ...inboxItem, due: "2026-11-01" }, "2026-10-01");
    const snap = (await db.items.get(it1.id))!;
    await fileItem(it1.id, "idea", "mind", today);
    await putItemBack(snap, today);
    const got = (await db.items.get(it1.id))!;
    expect(got).toMatchObject({ kind: "task", areaId: "inbox", due: "2026-11-01", status: "open" });
    expect(got.updatedAt!).toBeGreaterThan(snap.updatedAt!);
  });

  it("putItemBack undoes a delete", async () => {
    const it1 = await createItem(inboxItem, "2026-10-01");
    const snap = (await db.items.get(it1.id))!;
    await deleteItem(it1.id, today);
    await putItemBack(snap, today);
    expect((await db.items.get(it1.id))!.status).toBe("open");
    expect("deletedAt" in (await db.items.get(it1.id))!).toBe(false);
  });
});

describe("backups and the Bin", () => {
  it("export keeps deleted and purged rows; Merge adds them when missing and they stay as they were", async () => {
    const a = await createItem({ ...inboxItem, title: "binned" }, "2026-10-01");
    const b = await createItem({ ...inboxItem, title: "gone" }, "2026-10-01");
    await deleteItem(b.id, today);
    await emptyBin(today);
    await deleteItem(a.id, today);
    const file = await exportBackup(today);
    expect(() => parseBackup(JSON.stringify(file))).not.toThrow();
    await db.items.clear();
    const r = await restoreBackup(JSON.stringify(file), "merge");
    expect((await db.items.get(a.id))!.status).toBe("deleted");
    expect((await db.items.get(b.id))!.status).toBe("purged");
    // A purged row is not counted as a task that came back.
    expect(r.addedItems).toBe(1);
    expect(r.skipped).toBe(0);
  });

  it("Merge does not count purged rows it already has as skipped", async () => {
    const b = await createItem(inboxItem, "2026-10-01");
    await deleteItem(b.id, today);
    await emptyBin(today);
    const file = await exportBackup(today);
    const r = await restoreBackup(JSON.stringify(file), "merge");
    expect(r).toEqual({ addedItems: 0, addedGoals: 0, skipped: 0 });
  });

  it("a purged row cannot be given content again (the tombstone rule is checked on every write)", async () => {
    const b = await createItem(inboxItem, "2026-10-01");
    await deleteItem(b.id, today);
    await emptyBin(today);
    await expect(updateItem(b.id, { title: "back from the dead" }, today)).rejects.toThrow();
  });
});
