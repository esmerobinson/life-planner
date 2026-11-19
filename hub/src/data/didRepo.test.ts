import { db } from "./db";
import { emptyBin, deleteItem, saveDid, tickItem, untickItem, updateItem } from "./repo";
import { clearDidDraft, keepDidDraft, readDidDraft, recoverDidDraft } from "./didDraft";
import { vi } from "vitest";
import { didTarget } from "../domain/whatIDid";
import type { Item } from "../domain/types";

// "What I did" notes on a to-do (2026-11-19). Made-up to-dos only.

const DAY = "2026-11-18";
const todo = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `Pretend ${id}`, links: [], areaId: "writing", priority: 2, status: "open",
  createdAt: "2026-11-01", touchedAt: "2026-11-01", ...extra,
});

beforeEach(async () => {
  await Promise.all([db.items.clear(), db.pending.clear(), db.syncMeta.clear()]);
  localStorage.clear();
});

it("a note is saved on the to-do, edited in place, and goes when emptied; ticking writes no note", async () => {
  await db.items.put(todo("t1"));
  await tickItem("t1", DAY);
  expect((await db.items.get("t1"))!.did).toBeUndefined();
  const at = didTarget((await db.items.get("t1"))!, DAY);
  expect(at.on).toBe(DAY);
  await saveDid("t1", at, { note: "Pretend wrote the intro" }, DAY);
  expect((await db.items.get("t1"))!.did).toEqual([{ id: at.id, on: DAY, note: "Pretend wrote the intro" }]);
  // Opened again, the same note.
  expect(didTarget((await db.items.get("t1"))!, "2026-11-20")).toEqual({ id: at.id, on: DAY });
  await saveDid("t1", at, { addFiles: [{ name: "intro.docx", folder: "~/Desktop/Writing" }] }, DAY);
  await saveDid("t1", at, { note: "" }, DAY);
  expect((await db.items.get("t1"))!.did).toEqual([{ id: at.id, on: DAY, files: [{ name: "intro.docx", folder: "~/Desktop/Writing" }] }]);
  await saveDid("t1", at, { removeFile: 0 }, DAY);
  expect("did" in (await db.items.get("t1"))!).toBe(false);
});

it("unticking, ticking, editing and the Bin keep the note; emptying the Bin removes it", async () => {
  await db.items.put(todo("t2", { status: "done", completedAt: DAY, did: [{ id: "e1", on: DAY, note: "Pretend kept" }] }));
  await untickItem("t2", DAY);
  await tickItem("t2", "2026-11-19");
  await updateItem("t2", { title: "Pretend renamed" }, DAY);
  expect((await db.items.get("t2"))!.did).toEqual([{ id: "e1", on: DAY, note: "Pretend kept" }]);
  await deleteItem("t2", DAY);
  expect((await db.items.get("t2"))!.did).toHaveLength(1);
  await emptyBin(DAY);
  expect((await db.items.get("t2"))!.did).toBeUndefined();
});

it("a project: one note per session ticked", async () => {
  await db.items.put(todo("p1", { sessions: [{ id: "s1" }, { id: "s2" }] }));
  const one = didTarget((await db.items.get("p1"))!, DAY, "s1");
  const two = didTarget((await db.items.get("p1"))!, "2026-11-19", "s2");
  expect(one.session).toBe("s1");
  expect(one.id).not.toBe(two.id);
  await saveDid("p1", one, { note: "Pretend session one" }, DAY);
  await saveDid("p1", two, { note: "Pretend session two" }, DAY);
  const did = (await db.items.get("p1"))!.did!;
  expect(did.map((e) => [e.session, e.on, e.note])).toEqual([["s1", DAY, "Pretend session one"], ["s2", "2026-11-19", "Pretend session two"]]);
  expect(didTarget((await db.items.get("p1"))!, "2026-11-25", "s1").id).toBe(one.id);
});

it("a to-do gone from the list (or in the Bin) is not written to", async () => {
  await expect(saveDid("missing", { id: "e1", on: DAY }, { note: "x" }, DAY)).resolves.toBe(false);
  await db.items.put(todo("t3", { status: "deleted" }));
  await expect(saveDid("t3", { id: "e1", on: DAY }, { note: "x" }, DAY)).resolves.toBe(false);
});

describe("the kept draft (this device, as she types; review C1)", () => {
  const at = { id: "note", on: DAY };
  const stamp = async (id: string) => (await db.items.get(id))!.updatedAt!;

  it("one draft per note: kept until the same words are saved; another note's draft is separate (M5)", () => {
    keepDidDraft({ itemId: "t1", at, text: "Pretend half", typedAt: 5 });
    keepDidDraft({ itemId: "t2", at, text: "Pretend other", typedAt: 6 });
    expect(readDidDraft("t1", "note")).toEqual({ itemId: "t1", at, text: "Pretend half", typedAt: 5 });
    clearDidDraft("t1", "note", "Pretend different");
    expect(readDidDraft("t1", "note")).not.toBeNull();
    clearDidDraft("t1", "note", "Pretend half");
    expect(readDidDraft("t1", "note")).toBeNull();
    expect(readDidDraft("t2", "note")).not.toBeNull();
  });

  it("left behind and typed after the to-do last changed: saved on the next start, with its own typed-at time (not now)", async () => {
    await db.items.put(todo("t4", { status: "done", completedAt: DAY }));
    const before = await stamp("t4");
    keepDidDraft({ itemId: "t4", at, text: "Pretend last words", typedAt: before + 10 });
    vi.spyOn(Date, "now").mockReturnValue(before + 1_000_000);
    await recoverDidDraft();
    vi.restoreAllMocks();
    const row = (await db.items.get("t4"))!;
    expect(row.did).toEqual([{ id: "note", on: DAY, note: "Pretend last words" }]);
    expect(row.updatedAt).toBe(before + 10);
    expect(readDidDraft("t4", "note")).toBeNull();
  });

  it("R2: a phone draft older than the Mac's later note never overwrites it", async () => {
    // The phone typed at T; the Mac then extended the note and that synced in (stamp > T).
    keepDidDraft({ itemId: "t5", at, text: "Pretend first words", typedAt: 1_000 });
    await db.items.put(todo("t5", { status: "done", completedAt: DAY, did: [{ id: "note", on: DAY, note: "Pretend first words, and the whole ending" }] }));
    const was = await db.items.get("t5");
    await recoverDidDraft();
    expect(await db.items.get("t5")).toEqual(was);
    expect(readDidDraft("t5", "note")).toBeNull();
  });

  it("R1: an empty or unchanged draft never writes the to-do, so an untick or rename made elsewhere survives", async () => {
    await db.items.put(todo("t6", { title: "Pretend renamed on the Mac", status: "open", did: [{ id: "note", on: DAY, note: "Pretend kept" }] }));
    const was = await db.items.get("t6");
    keepDidDraft({ itemId: "t6", at, text: "", typedAt: Date.now() + 60_000 });
    await recoverDidDraft();
    keepDidDraft({ itemId: "t6", at, text: "Pretend kept", typedAt: Date.now() + 60_000 });
    await recoverDidDraft();
    expect(await db.items.get("t6")).toEqual(was);
    expect(readDidDraft("t6", "note")).toBeNull();
  });

  it("saving the same words again writes nothing (no new stamp)", async () => {
    await db.items.put(todo("t7", { did: [{ id: "note", on: DAY, note: "Pretend same" }] }));
    const was = await db.items.get("t7");
    await saveDid("t7", at, { note: "Pretend same" }, DAY);
    expect(await db.items.get("t7")).toEqual(was);
  });

  it("writing a note never changes touchedAt (review M10: the farm and 'not looked at' read it)", async () => {
    await db.items.put(todo("t8", { touchedAt: "2026-11-01" }));
    await saveDid("t8", at, { note: "Pretend words" }, DAY);
    expect((await db.items.get("t8"))!.touchedAt).toBe("2026-11-01");
  });

  it("a broken or blocked store is just no draft", () => {
    localStorage.setItem("esmeworld-what-i-did:t1:note", "{not json");
    expect(readDidDraft("t1", "note")).toBeNull();
  });
});
