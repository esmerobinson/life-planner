import { db } from "./db";
import { emptyBin, deleteItem, saveDid, tickItem, untickItem, updateItem } from "./repo";
import { clearDidDraft, keepDidDraft, readDidDraft, recoverDidDraft } from "./didDraft";
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

describe("the kept draft (this device, as she types)", () => {
  it("kept until the same words are saved; a later draft replaces it", () => {
    keepDidDraft({ itemId: "t1", at: { id: "e1", on: DAY }, text: "Pretend half" });
    expect(readDidDraft()).toEqual({ itemId: "t1", at: { id: "e1", on: DAY }, text: "Pretend half" });
    clearDidDraft("t1", "e1", "Pretend other");
    expect(readDidDraft()).not.toBeNull();
    clearDidDraft("t1", "e1", "Pretend half");
    expect(readDidDraft()).toBeNull();
  });

  it("a draft left behind (the app closed mid-word) is written to the to-do on the next start", async () => {
    await db.items.put(todo("t4", { status: "done", completedAt: DAY }));
    keepDidDraft({ itemId: "t4", at: { id: "e9", on: DAY }, text: "Pretend last words" });
    await recoverDidDraft(DAY);
    expect((await db.items.get("t4"))!.did).toEqual([{ id: "e9", on: DAY, note: "Pretend last words" }]);
    expect(readDidDraft()).toBeNull();
  });

  it("a broken or blocked store is just no draft", () => {
    localStorage.setItem("esmeworld-what-i-did", "{not json");
    expect(readDidDraft()).toBeNull();
  });
});
