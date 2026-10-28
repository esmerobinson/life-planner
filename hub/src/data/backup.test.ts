import { db } from "./db";
import { exportBackup, restoreBackup } from "./backup";
import type { Goal, Item } from "../domain/types";

const item = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `T ${id}`, links: [], areaId: "art", priority: 2,
  status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01", ...extra,
});
const goal = (id: string): Goal => ({
  id, title: `G ${id}`, areaId: "art", kind: "finite", milestones: [{ id: "m", title: "x", done: false }],
  createdAt: "2026-10-01",
});

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

async function snapshot() {
  return { items: await db.items.orderBy("id").toArray(), goals: await db.goals.orderBy("id").toArray() };
}

describe("backup", () => {
  it("export then clear then restore(replace) gives identical items and goals", async () => {
    await db.items.bulkAdd([item("a", { notes: "n", tags: ["x"] }), item("b", { status: "done" })]);
    await db.goals.add(goal("g1"));
    const before = await snapshot();
    const file = await exportBackup("2026-10-28");
    expect(file).toMatchObject({ app: "life-hub", schema: 1, exportedOn: "2026-10-28" });
    const roundTripped = JSON.parse(JSON.stringify(file));
    await db.items.clear();
    await db.goals.clear();
    const r = await restoreBackup(roundTripped, "replace");
    expect(r).toEqual({ addedItems: 2, addedGoals: 1, skipped: 0 });
    expect(await snapshot()).toEqual(before);
  });

  it("merge adds missing ids and never changes an existing row", async () => {
    await db.items.add(item("a", { status: "done", completedAt: "2026-10-02" }));
    const file = { app: "life-hub", schema: 1, exportedOn: "2026-10-28",
      items: [item("a", { status: "open", title: "changed" }), item("b")], goals: [goal("g1")] };
    const r = await restoreBackup(file, "merge");
    expect(r).toEqual({ addedItems: 1, addedGoals: 1, skipped: 1 });
    const a = await db.items.get("a");
    expect(a?.status).toBe("done");
    expect(a?.title).toBe("T a");
    expect(await db.items.get("b")).toBeTruthy();
  });

  it("invalid JSON, wrong app name, schema 2, a row missing id, and a truncated file are rejected with a calm message and the db is unchanged", async () => {
    await db.items.add(item("keep"));
    const before = await snapshot();
    const good = { app: "life-hub", schema: 1, exportedOn: "2026-10-28", items: [item("n")], goals: [] };
    const { id: _id, ...noId } = item("z");
    const bad: unknown[] = [
      "{not json",
      JSON.stringify(good).slice(0, 40),
      { ...good, app: "other" },
      { ...good, schema: 2 },
      { ...good, items: [noId] },
      { ...good, items: [item("q"), { ...item("r"), priority: 9 }] },
      null, 42, [], "text",
    ];
    for (const mode of ["merge", "replace"] as const) {
      for (const raw of bad) {
        await expect(restoreBackup(raw, mode)).rejects.toThrow(/backup/i);
        expect(await snapshot()).toEqual(before);
      }
    }
  });

  it("restore failing mid-way leaves the db unchanged", async () => {
    await db.items.add(item("keep"));
    await db.goals.add(goal("kg"));
    const before = await snapshot();
    const file = { app: "life-hub", schema: 1, exportedOn: "2026-10-28",
      items: [item("n1"), item("n2"), { id: "broken" }], goals: [goal("g2")] };
    for (const mode of ["merge", "replace"] as const) {
      await expect(restoreBackup(file, mode)).rejects.toThrow();
      expect(await snapshot()).toEqual(before);
    }
  });
});
