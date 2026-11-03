import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db";
import {
  addSession, changeToProject, createItem, emptyBin, deleteItem, fileItem, removeSession, setSessionDone, tickItem, untickItem,
  updateItem, updateSession,
} from "./repo";
import type { Item } from "../domain/types";

const TODAY = "2026-11-02";
const base = { kind: "task" as const, title: "Pretend street scene", areaId: "art" as const, priority: 2 as const };

async function project(n = 4, extra: Partial<Item> = {}): Promise<Item> {
  return createItem(
    { ...base, due: "2026-11-09", sessions: Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}` })), ...extra },
    "2026-10-29",
  );
}
const get = async (id: string) => (await db.items.get(id))!;

beforeEach(async () => {
  await db.items.clear();
});

describe("project to-dos in the repo", () => {
  it("a project is stored with its sessions and stamped for sync", async () => {
    const p = await project();
    expect(p.sessions).toHaveLength(4);
    expect(typeof p.updatedAt).toBe("number");
  });

  it("the main tick logs the next session today; the last one makes it done", async () => {
    const p = await project(2);
    await tickItem(p.id, TODAY);
    let got = await get(p.id);
    expect(got.status).toBe("open");
    expect(got.sessions!.map((s) => s.doneOn)).toEqual([TODAY, undefined]);
    await tickItem(p.id, "2026-11-03");
    got = await get(p.id);
    expect(got).toMatchObject({ status: "done", completedAt: "2026-11-03" });
    expect(got.sessions![1].doneOn).toBe("2026-11-03");
  });

  it("the main tick logs the session planned for today first", async () => {
    const p = await project(3, { sessions: [{ id: "a" }, { id: "b", plannedFor: TODAY }, { id: "c" }] });
    await tickItem(p.id, TODAY);
    expect((await get(p.id)).sessions!.map((s) => s.doneOn)).toEqual([undefined, TODAY, undefined]);
  });

  it("ticking the main box when every session is already done only marks it done", async () => {
    const p = await project(1, { sessions: [{ id: "a", doneOn: "2026-10-30" }] });
    expect(p.status).toBe("open");
    await tickItem(p.id, TODAY);
    const got = await get(p.id);
    expect(got).toMatchObject({ status: "done", completedAt: TODAY });
    expect(got.sessions).toEqual([{ id: "a", doneOn: "2026-10-30" }]);
  });

  it("unticking takes off today's session; on a done project it reopens it and unticks the last one", async () => {
    const p = await project(2);
    await tickItem(p.id, TODAY);
    await untickItem(p.id, TODAY);
    expect((await get(p.id)).sessions!.every((s) => s.doneOn === undefined)).toBe(true);
    await tickItem(p.id, "2026-10-30");
    await tickItem(p.id, "2026-10-31");
    expect((await get(p.id)).status).toBe("done");
    await untickItem(p.id, TODAY);
    const got = await get(p.id);
    expect(got.status).toBe("open");
    expect(got.completedAt).toBeUndefined();
    expect(got.sessions!.map((s) => s.doneOn)).toEqual(["2026-10-30", undefined]);
  });

  it("unticking a done project that still has open sessions (an older app's tick) just reopens it", async () => {
    const p = await project(4, {
      sessions: [{ id: "a", doneOn: "2026-10-30" }, { id: "b", doneOn: "2026-10-31" }, { id: "c" }, { id: "d" }],
    });
    await db.items.update(p.id, { status: "done", completedAt: "2026-11-01" });
    await untickItem(p.id, TODAY);
    const got = await get(p.id);
    expect(got.status).toBe("open");
    expect(got.completedAt).toBeUndefined();
    expect(got.sessions!.map((s) => s.doneOn)).toEqual(["2026-10-30", "2026-10-31", undefined, undefined]);
    // None ticked at all: it reopens too (it used to stay stuck in Done).
    const q = await project(2);
    await db.items.update(q.id, { status: "done", completedAt: "2026-11-01" });
    await untickItem(q.id, TODAY);
    expect((await get(q.id)).status).toBe("open");
  });

  it("a session box ticks and unticks that session (today's date); the status follows", async () => {
    const p = await project(2);
    await setSessionDone(p.id, "s2", true, TODAY);
    expect((await get(p.id)).sessions!.map((s) => s.doneOn)).toEqual([undefined, TODAY]);
    await setSessionDone(p.id, "s1", true, TODAY);
    expect(await get(p.id)).toMatchObject({ status: "done", completedAt: TODAY });
    await setSessionDone(p.id, "s1", false, TODAY);
    const got = await get(p.id);
    expect(got.status).toBe("open");
    expect(got.completedAt).toBeUndefined();
    expect(got.sessions![0]).toEqual({ id: "s1" });
  });

  it("a session's title, details and planned day are set and cleared; caps hold", async () => {
    const p = await project(2);
    await updateSession(p.id, "s1", { title: "  Market stalls ", details: "Awnings and crates", plannedFor: "2026-11-05" }, TODAY);
    expect((await get(p.id)).sessions![0]).toEqual({
      id: "s1", title: "Market stalls", details: "Awnings and crates", plannedFor: "2026-11-05",
    });
    await updateSession(p.id, "s1", { title: " ", details: "", plannedFor: undefined }, TODAY);
    expect((await get(p.id)).sessions![0]).toEqual({ id: "s1" });
    await expect(updateSession(p.id, "s1", { title: "x".repeat(121) }, TODAY)).rejects.toThrow();
    await expect(updateSession(p.id, "s1", { details: "x".repeat(1001) }, TODAY)).rejects.toThrow();
    await expect(updateSession(p.id, "s1", { plannedFor: "2026-02-30" }, TODAY)).rejects.toThrow();
  });

  it("+ Add a session adds an unnamed one (up to 20) and reopens a done project", async () => {
    const p = await project(1);
    await tickItem(p.id, TODAY);
    expect((await get(p.id)).status).toBe("done");
    await addSession(p.id, TODAY);
    const got = await get(p.id);
    expect(got.status).toBe("open");
    expect(got.sessions).toHaveLength(2);
    const full = await project(20);
    await expect(addSession(full.id, TODAY)).rejects.toThrow();
  });

  it("a not-done session can be removed; a done one or the last one cannot", async () => {
    const p = await project(3, { sessions: [{ id: "a", doneOn: "2026-10-30" }, { id: "b" }, { id: "c" }] });
    await removeSession(p.id, "c", TODAY);
    expect((await get(p.id)).sessions!.map((s) => s.id)).toEqual(["a", "b"]);
    await expect(removeSession(p.id, "a", TODAY)).rejects.toThrow();
    // Removing the only session left to do completes it.
    await removeSession(p.id, "b", TODAY);
    expect(await get(p.id)).toMatchObject({ status: "done", completedAt: TODAY });
    const one = await project(1);
    await expect(removeSession(one.id, "s1", TODAY)).rejects.toThrow();
  });

  it("Change to → Project keeps title, area, notes and deadline; gives 4 sessions; drops a repeat", async () => {
    const t = await createItem({ ...base, notes: "Low-poly", due: "2026-11-09", recur: ["mon"] }, "2026-10-29");
    await changeToProject(t.id, TODAY);
    const got = await get(t.id);
    expect(got).toMatchObject({ kind: "task", title: base.title, areaId: "art", notes: "Low-poly", due: "2026-11-09" });
    expect(got.sessions).toHaveLength(4);
    expect(got.recur).toBeUndefined();
    const idea = await createItem({ ...base, kind: "idea" }, "2026-10-29");
    await changeToProject(idea.id, TODAY);
    expect(await get(idea.id)).toMatchObject({ kind: "task" });
  });

  it("a project changed back to a to-do loses its sessions", async () => {
    const p = await project();
    await updateItem(p.id, { sessions: undefined }, TODAY);
    expect((await get(p.id)).sessions).toBeUndefined();
  });

  it("a project added to the inbox keeps its sessions filed as a to-do, and loses them filed as an idea", async () => {
    const a = await project(3, { areaId: "inbox" });
    await fileItem(a.id, "task", "art", TODAY);
    expect((await get(a.id)).sessions).toHaveLength(3);
    const b = await project(3, { areaId: "inbox" });
    await fileItem(b.id, "idea", "art", TODAY);
    expect(await get(b.id)).toMatchObject({ kind: "idea", areaId: "art" });
    expect((await get(b.id)).sessions).toBeUndefined();
  });

  it("emptying the Bin leaves a tombstone without sessions", async () => {
    const p = await project();
    await deleteItem(p.id, TODAY);
    await emptyBin(TODAY);
    const got = await get(p.id);
    expect(got.status).toBe("purged");
    expect(got.sessions).toBeUndefined();
  });

  it("an invalid project is never written (the change tracker validates every write)", async () => {
    const p = await project();
    await expect(updateItem(p.id, { sessions: [] }, TODAY)).rejects.toThrow();
    expect((await get(p.id)).sessions).toHaveLength(4);
  });

  it("Change to → Project on an idea carrying dormant sessions (an older app's) brings them back", async () => {
    const idea = await createItem(
      { ...base, kind: "idea", sessions: [{ id: "x", title: "Market stalls", doneOn: "2026-10-30" }, { id: "y" }] },
      "2026-10-29",
    );
    await changeToProject(idea.id, TODAY);
    expect((await get(idea.id)).sessions).toEqual([{ id: "x", title: "Market stalls", doneOn: "2026-10-30" }, { id: "y" }]);
  });
});
