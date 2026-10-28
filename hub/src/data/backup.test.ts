import { vi } from "vitest";
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

  it("a write failing inside the transaction rolls back both tables, in both modes", async () => {
    await db.items.add(item("keep"));
    await db.goals.add(goal("kg"));
    const before = await snapshot();
    const file = { app: "life-hub", schema: 1, exportedOn: "2026-10-28",
      items: [item("n1")], goals: [goal("g2")] };
    for (const mode of ["merge", "replace"] as const) {
      const spy = vi.spyOn(db.goals, "bulkAdd").mockRejectedValueOnce(new Error("boom"));
      await expect(restoreBackup(file, mode)).rejects.toThrow(/backup|restore/i);
      spy.mockRestore();
      expect(await snapshot()).toEqual(before);
    }
  });

  describe("field validation", () => {
    const good = () => ({ app: "life-hub", schema: 1, exportedOn: "2026-10-28", items: [item("n")], goals: [goal("g")] });
    const withItem = (extra: Record<string, unknown>) => ({ ...good(), items: [{ ...item("n"), ...extra }] });
    const withGoal = (extra: Record<string, unknown>) => ({ ...good(), goals: [{ ...goal("g"), ...extra }] });
    const cases: [string, unknown][] = [
      ["recur object", withItem({ recur: {} })],
      ["recur bad day", withItem({ recur: ["funday"] })],
      ["due number", withItem({ due: 5 })],
      ["due impossible", withItem({ due: "2026-13-45" })],
      ["pinnedDate", withItem({ pinnedDate: "soon" })],
      ["weekOf", withItem({ weekOf: "2026-02-30" })],
      ["hiddenOn", withItem({ hiddenOn: 1 })],
      ["completedAt", withItem({ completedAt: "x" })],
      ["createdAt", withItem({ createdAt: "yesterday" })],
      ["touchedAt", withItem({ touchedAt: "2026-1-1" })],
      ["tags", withItem({ tags: [1] })],
      ["links", withItem({ links: "a" })],
      ["notes", withItem({ notes: 3 })],
      ["goalId", withItem({ goalId: 3 })],
      ["source kind", withItem({ source: { kind: "x", key: "k" } })],
      ["source key", withItem({ source: { kind: "manual" } })],
      ["monthlyTarget NaN", withGoal({ monthlyTarget: NaN })],
      ["monthlyTarget 0", withGoal({ monthlyTarget: 0 })],
      ["deadline", withGoal({ deadline: "nope" })],
      ["goal createdAt", withGoal({ createdAt: "nope" })],
      ["exportedOn", { ...good(), exportedOn: "yesterday" }],
    ];
    it.each(cases)("rejects bad %s and changes nothing", async (_n, raw) => {
      await db.items.add(item("keep"));
      const before = await snapshot();
      for (const mode of ["merge", "replace"] as const) {
        await expect(restoreBackup(raw, mode)).rejects.toThrow(/backup/i);
        expect(await snapshot()).toEqual(before);
      }
    });

    it("a fully valid backup with every optional field round-trips", async () => {
      const full = item("full", {
        notes: "n", tags: ["a"], goalId: "g", due: "2026-10-30", recur: ["mon", "sun"],
        pinnedDate: "2026-10-29", weekOf: "2026-10-26", hiddenOn: "2026-10-28",
        completedAt: "2026-10-27", source: { kind: "backlog", key: "k" },
      });
      const fullGoal = { ...goal("g"), deadline: "2026-12-01", monthlyTarget: 4 };
      await restoreBackup({ app: "life-hub", schema: 1, exportedOn: "2026-10-28", items: [full], goals: [fullGoal] }, "replace");
      expect(await db.items.get("full")).toEqual(full);
      expect(await db.goals.get("g")).toEqual(fullGoal);
    });
  });

  describe("gtasks source", () => {
    const g = item("g1", { source: { kind: "gtasks", key: "gtasks:abc" }, tags: ["home"], areaId: "inbox" });

    it("round-trips a gtasks item with replace and merge", async () => {
      await db.items.add(g);
      const file = JSON.parse(JSON.stringify(await exportBackup("2026-10-28")));
      await db.items.clear();
      await restoreBackup(file, "replace");
      expect(await db.items.get("g1")).toEqual(g);
      await db.items.clear();
      await restoreBackup(file, "merge");
      expect(await db.items.get("g1")).toEqual(g);
    });

    it("still rejects an unknown source kind", async () => {
      const raw = { app: "life-hub", schema: 1, exportedOn: "2026-10-28", goals: [], items: [{ ...g, source: { kind: "nonsense", key: "k" } }] };
      await expect(restoreBackup(raw, "merge")).rejects.toThrow(/backup/i);
    });
  });

  describe("new areas", () => {
    const NEW = ["tech", "production", "admin"] as const;
    const seed = async () => {
      await db.items.bulkAdd(NEW.map((a) => item(`i-${a}`, { areaId: a })));
      await db.goals.bulkAdd(NEW.map((a) => ({ ...goal(`g-${a}`), areaId: a })));
    };

    it("items and goals in tech, production and admin export and restore (replace)", async () => {
      await seed();
      const before = await snapshot();
      const file = JSON.parse(JSON.stringify(await exportBackup("2026-10-28")));
      await db.items.clear();
      await db.goals.clear();
      await restoreBackup(file, "replace");
      expect(await snapshot()).toEqual(before);
    });

    it("items and goals in the new areas restore with merge", async () => {
      await seed();
      const before = await snapshot();
      const file = JSON.parse(JSON.stringify(await exportBackup("2026-10-28")));
      await db.items.clear();
      await db.goals.clear();
      const r = await restoreBackup(file, "merge");
      expect(r).toEqual({ addedItems: 3, addedGoals: 3, skipped: 0 });
      expect(await snapshot()).toEqual(before);
    });

    it("an unknown area id is still rejected for items and goals", async () => {
      const base = { app: "life-hub", schema: 1, exportedOn: "2026-10-28" };
      await expect(
        restoreBackup({ ...base, items: [item("x", { areaId: "nonsense" as never })], goals: [] }, "merge"),
      ).rejects.toThrow(/backup/i);
      await expect(
        restoreBackup({ ...base, items: [], goals: [{ ...goal("g"), areaId: "nonsense" }] }, "replace"),
      ).rejects.toThrow(/backup/i);
      expect(await db.items.count()).toBe(0);
    });
  });
});
