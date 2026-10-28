import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../data/db";
import { importBacklog } from "./backlog";
import { importGoogleTasks, parseGoogleTasks } from "./googleTasks";
import fixture from "./__fixtures__/googleTasks.json";

const TODAY = "2026-10-28";
const NOT_EXPORT = [{ line: "", reason: "This is not a Google Tasks export." }];

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

const one = (task: Record<string, unknown>, listTitle = "L") =>
  ({ lists: [{ id: "l", title: listTitle, tasks: [task] }] });

describe("parseGoogleTasks", () => {
  it("keeps only needsAction tasks and reports blank titles and bad dues", () => {
    const { items, notes } = parseGoogleTasks(fixture);
    expect(items).toHaveLength(9);
    expect(items.map((i) => i.title)).not.toContain("Returned the imaginary ladder");
    expect(items.map((i) => i.title)).not.toContain("Old finished errand");
    expect(notes).toHaveLength(2);
    expect(notes.some((n) => /title/i.test(n.reason))).toBe(true);
    expect(notes.some((n) => /due/i.test(n.reason) && n.line.includes("plumber"))).toBe(true);
    const plumber = items.find((i) => i.title.includes("plumber"))!;
    expect(plumber.due).toBeUndefined();
  });

  it("fills in list title, key, parent and notes", () => {
    const { items } = parseGoogleTasks(fixture);
    const shelf = items.find((i) => i.googleId === "t2")!;
    expect(shelf).toMatchObject({ listTitle: "Home", key: "gtasks:t2", notes: "Use the blue drill", due: "2026-11-01" });
    expect(items.find((i) => i.googleId === "t3")!.parentId).toBe("t2");
    expect(items.find((i) => i.googleId === "t5")!.title).toBe("Café menu ✨ résumé");
  });

  it("uses the date part of due and never converts it through a timezone", () => {
    for (const due of ["2026-11-01T23:30:00.000Z", "2026-11-01T00:00:00.000Z"]) {
      expect(parseGoogleTasks(one({ id: "a", title: "x", status: "needsAction", due })).items[0].due).toBe("2026-11-01");
    }
  });

  it("reports a task with no usable id and one with an impossible date", () => {
    const r = parseGoogleTasks({ lists: [{ id: "l", title: "L", tasks: [
      { title: "No id here", status: "needsAction" },
      { id: "", title: "Empty id", status: "needsAction" },
      { id: "z", title: "Bad day", status: "needsAction", due: "2026-13-45T00:00:00.000Z" },
    ] }] });
    expect(r.items.map((i) => i.title)).toEqual(["Bad day"]);
    expect(r.items[0].due).toBeUndefined();
    expect(r.notes).toHaveLength(3);
  });

  it.each([
    ["null", null],
    ["array", []],
    ["empty object", {}],
    ["lists is a number", { lists: 5 }],
    ["string", "nope"],
  ])("a non-matching shape (%s) gives the not-an-export note", (_n, raw) => {
    expect(parseGoogleTasks(raw)).toEqual({ items: [], notes: NOT_EXPORT });
  });

  it("never throws on odd lists or tasks", () => {
    for (const raw of [
      { lists: [{ id: "l", title: "L", tasks: "abc" }] },
      { lists: [null, 3, [], { tasks: null }] },
      { lists: [{ id: "l", title: "L", tasks: [null, 5, [], { id: 3, title: 4, status: "needsAction" }] }] },
      { lists: [{ id: "l", title: 7, tasks: [{ id: "a", title: "ok", status: "needsAction", notes: 5, due: 5, parent: 9 }] }] },
    ]) {
      expect(() => parseGoogleTasks(raw)).not.toThrow();
    }
    const r = parseGoogleTasks({ lists: [{ id: "l", title: "L", tasks: "abc" }] });
    expect(r.items).toEqual([]);
    expect(r.notes.length).toBeGreaterThan(0);
  });
});

describe("importGoogleTasks", () => {
  it("adds everything as inbox tasks with list tags, then a second import adds nothing", async () => {
    const r = await importGoogleTasks(fixture, TODAY);
    expect(r).toMatchObject({ added: 8, alreadyHad: 0, duplicateTitles: 1, skipped: 2 });
    expect(r.notes).toHaveLength(2);
    const rows = await db.items.toArray();
    expect(rows).toHaveLength(8);
    const lights = rows.find((i) => i.title === "Buy fictional lightbulbs")!;
    expect(lights).toMatchObject({
      kind: "task", areaId: "inbox", priority: 2, links: [], status: "open",
      createdAt: TODAY, touchedAt: TODAY, tags: ["home"], source: { kind: "gtasks", key: "gtasks:t1" },
    });
    expect(lights.due).toBeUndefined();
    expect(rows.find((i) => i.title.startsWith("Café"))!.tags).toEqual(["work stuff"]);

    const again = await importGoogleTasks(fixture, TODAY);
    expect(again).toMatchObject({ added: 0, alreadyHad: 8, duplicateTitles: 1 });
    expect(await db.items.count()).toBe(8);
  });

  it("keeps notes and due, and adds a Part of line for a subtask", async () => {
    await importGoogleTasks(fixture, TODAY);
    const shelf = (await db.items.filter((i) => i.title === "Fix the pretend shelf").first())!;
    expect(shelf.notes).toBe("Use the blue drill");
    expect(shelf.due).toBe("2026-11-01");
    const sub = (await db.items.filter((i) => i.title === "Hang the shelf pictures").first())!;
    expect(sub.notes).toBe("Part of: Fix the pretend shelf");
  });

  it("appends Part of after the subtask's own notes", async () => {
    await importGoogleTasks({ lists: [{ id: "l", title: "L", tasks: [
      { id: "p", title: "Parent job", status: "needsAction" },
      { id: "c", title: "Child job", status: "needsAction", parent: "p", notes: "Bring tape" },
    ] }] }, TODAY);
    expect((await db.items.filter((i) => i.title === "Child job").first())!.notes).toBe("Bring tape\nPart of: Parent job");
  });

  it("a subtask whose parent is not in the export gets no Part of line", async () => {
    await importGoogleTasks(one({ id: "c", title: "Orphan job", status: "needsAction", parent: "gone" }), TODAY);
    expect((await db.items.toArray())[0].notes).toBeUndefined();
  });

  it("collapses a within-export duplicate title and merges its list tag", async () => {
    await importGoogleTasks(fixture, TODAY);
    const shared = await db.items.filter((i) => i.title === "Shared title").toArray();
    expect(shared).toHaveLength(1);
    expect(shared[0].tags).toEqual(["work stuff", "reading list"]);
  });

  it("does not add a title that matches an existing item from any source, and counts it", async () => {
    await importBacklog("- [ ] Read a pretend NOVEL!!\n- [ ] Unrelated chore", TODAY);
    const r = await importGoogleTasks(fixture, TODAY);
    expect(r.added).toBe(7);
    expect(r.duplicateTitles).toBe(2);
    expect(await db.items.filter((i) => i.source?.kind === "gtasks" && i.title.includes("novel")).count()).toBe(0);
    // the existing item is never touched, tags included
    expect((await db.items.filter((i) => i.title.startsWith("Read a pretend")).first())!.tags).toBeUndefined();
  });

  it("emoji, punctuation and extra spaces are ignored when comparing titles", async () => {
    await importBacklog("- [ ] Café menu résumé", TODAY);
    const r = await importGoogleTasks(one({ id: "e", title: "Café   menu ✨, résumé!", status: "needsAction" }), TODAY);
    expect(r).toMatchObject({ added: 0, duplicateTitles: 1 });
  });

  it("never touches an existing row in any status, even after tick or archive", async () => {
    await importGoogleTasks(fixture, TODAY);
    const a = (await db.items.filter((i) => i.title === "Buy fictional lightbulbs").first())!;
    const b = (await db.items.filter((i) => i.title === "Fix the pretend shelf").first())!;
    await db.items.update(a.id, { status: "done", completedAt: "2026-10-29", touchedAt: "2026-10-29" });
    await db.items.update(b.id, { status: "archived", areaId: "art", title: "Renamed by me" });
    const before = await db.items.orderBy("id").toArray();
    const r = await importGoogleTasks(fixture, "2026-11-30");
    expect(r.added).toBe(0);
    expect(r.alreadyHad).toBe(8);
    expect(await db.items.orderBy("id").toArray()).toEqual(before);
  });

  it("uses one transaction", async () => {
    const spy = vi.spyOn(db, "transaction");
    await importGoogleTasks(fixture, TODAY);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("a bad file adds nothing and reports it", async () => {
    const r = await importGoogleTasks({ lists: 5 }, TODAY);
    expect(r).toEqual({ added: 0, alreadyHad: 0, duplicateTitles: 0, skipped: 1, notes: NOT_EXPORT, duplicates: [] });
    expect(await db.items.count()).toBe(0);
  });

  it("lists skipped duplicates: cross-source with notes and due, and in-file", async () => {
    await importBacklog("- [ ] Read a pretend novel", TODAY);
    const raw = { lists: [
      { id: "a", title: "Books", tasks: [{ id: "n1", title: "READ a pretend novel", status: "needsAction", notes: "Chapter 3", due: "2026-12-01T00:00:00.000Z" }] },
      { id: "b", title: "Misc", tasks: [
        { id: "n2", title: "Shared thing", status: "needsAction" },
        { id: "n3", title: "shared thing", status: "needsAction", notes: "x" },
      ] },
    ] };
    const r = await importGoogleTasks(raw, TODAY);
    expect(r.duplicates).toEqual([
      { title: "READ a pretend novel", listTitle: "Books", hadNotes: true, hadDue: true, reason: "existing" },
      { title: "shared thing", listTitle: "Misc", hadNotes: true, hadDue: false, reason: "in-file" },
    ]);
    expect(r.duplicateTitles).toBe(r.duplicates.length);
  });

  it("fixture duplicates list matches duplicateTitles", async () => {
    const r = await importGoogleTasks(fixture, TODAY);
    expect(r.duplicates).toEqual([
      { title: "Shared title", listTitle: "Reading List", hadNotes: false, hadDue: false, reason: "in-file" },
    ]);
    expect(r.duplicateTitles).toBe(1);
  });

  it("the same task id twice gives a parse note, not alreadyHad", async () => {
    const raw = { lists: [{ id: "l", title: "L", tasks: [
      { id: "same", title: "First copy", status: "needsAction" },
      { id: "same", title: "Second copy", status: "needsAction" },
    ] }] };
    const p = parseGoogleTasks(raw);
    expect(p.items).toHaveLength(1);
    expect(p.notes).toEqual([{ line: "Second copy", reason: "duplicate task id in file" }]);
    const r = await importGoogleTasks(raw, TODAY);
    expect(r).toMatchObject({ added: 1, alreadyHad: 0, skipped: 1 });
  });

  it("2026-02-30 due is rejected and reported", () => {
    const r = parseGoogleTasks(one({ id: "d", title: "Odd day", status: "needsAction", due: "2026-02-30T00:00:00.000Z" }));
    expect(r.items[0].due).toBeUndefined();
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0].reason).toMatch(/due/i);
  });

  it("emoji-only titles are never duplicates of each other or of existing emoji-only rows", async () => {
    await db.items.add({ id: "e0", kind: "task", title: "🎉", links: [], areaId: "inbox", priority: 2, status: "open", createdAt: TODAY, touchedAt: TODAY });
    const raw = { lists: [{ id: "l", title: "L", tasks: [
      { id: "e1", title: "✨", status: "needsAction" },
      { id: "e2", title: "🎉", status: "needsAction" },
    ] }] };
    const r = await importGoogleTasks(raw, TODAY);
    expect(r).toMatchObject({ added: 2, duplicateTitles: 0 });
  });

  it("an existing done or archived item with the same title counts as a duplicate", async () => {
    const base = { kind: "task" as const, links: [], areaId: "art" as const, priority: 2 as const, createdAt: TODAY, touchedAt: TODAY };
    await db.items.bulkAdd([
      { ...base, id: "x1", title: "Finished pretend job", status: "done", completedAt: TODAY },
      { ...base, id: "x2", title: "Shelved pretend job", status: "archived" },
    ]);
    const raw = { lists: [{ id: "l", title: "L", tasks: [
      { id: "g1", title: "Finished pretend job", status: "needsAction" },
      { id: "g2", title: "Shelved pretend job", status: "needsAction" },
    ] }] };
    const r = await importGoogleTasks(raw, TODAY);
    expect(r).toMatchObject({ added: 0, duplicateTitles: 2 });
    expect(r.duplicates.map((d) => d.reason)).toEqual(["existing", "existing"]);
  });

  it("merged tags are not repeated when both copies come from the same list", async () => {
    const raw = { lists: [{ id: "l", title: "Same List", tasks: [
      { id: "m1", title: "Twice listed", status: "needsAction" },
      { id: "m2", title: "twice listed", status: "needsAction" },
    ] }] };
    await importGoogleTasks(raw, TODAY);
    expect((await db.items.toArray())[0].tags).toEqual(["same list"]);
  });
});
