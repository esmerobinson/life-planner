import type { Item } from "./types";
import { shownPictureIds } from "./page";
import {
  applyDidPatch, completedInWeek, didEntries, didLog, validDidPhotos, MAX_DID_PHOTOS,
} from "./whatIDid";

// Photos on "What I did" notes (Esme, 19 Nov 2026: "add option to add photos"). The ids live in
// the item's own `didPhotos` (an older app version keeps an unknown item field, but refuses an
// unknown key inside a note). Made-up to-dos and ids only.

const base = { links: [], priority: 2 as const, createdAt: "2026-11-01", touchedAt: "2026-11-01" };
const todo = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `Pretend ${id}`, areaId: "writing", status: "done", completedAt: "2026-11-18", ...base, ...extra,
});
const label = (id: string) => ({ writing: "Writing" })[id] ?? id;
const DAY = "2026-11-18";

describe("validDidPhotos", () => {
  it("accepts absent and well-formed lists", () => {
    expect(validDidPhotos(undefined)).toBe(true);
    expect(validDidPhotos([{ entry: "note", ids: ["a1", "b-2"] }])).toBe(true);
  });
  it("refuses unknown keys, empty or repeated sets, bad ids and too many photos", () => {
    expect(validDidPhotos({})).toBe(false);
    expect(validDidPhotos([])).toBe(false);
    expect(validDidPhotos([{ entry: "note", ids: [] }])).toBe(false);
    expect(validDidPhotos([{ entry: "note", ids: ["a"], extra: 1 }])).toBe(false);
    expect(validDidPhotos([{ entry: "", ids: ["a"] }])).toBe(false);
    expect(validDidPhotos([{ entry: "note", ids: ["a/b"] }])).toBe(false);
    expect(validDidPhotos([{ entry: "note", ids: ["a", "a"] }])).toBe(false);
    expect(validDidPhotos([{ entry: "note", ids: ["a"] }, { entry: "note", ids: ["b"] }])).toBe(false);
    const many = Array.from({ length: MAX_DID_PHOTOS + 1 }, (_, i) => `p${i}`);
    expect(validDidPhotos([{ entry: "note", ids: many }])).toBe(false);
  });
});

describe("applyDidPatch: photos", () => {
  const at = { id: "note", on: DAY };
  it("a photo on a new note makes the note (its day kept) and lists the photo", () => {
    expect(applyDidPatch(todo("t"), at, { addPhotos: ["p1"] })).toEqual({
      did: [{ id: "note", on: DAY }],
      didPhotos: [{ entry: "note", ids: ["p1"] }],
    });
  });
  it("adds at the end, never twice; removes one; the last one gone takes the empty note with it", () => {
    let it = todo("t", { did: [{ id: "note", on: DAY }], didPhotos: [{ entry: "note", ids: ["p1"] }] });
    it = { ...it, ...applyDidPatch(it, at, { addPhotos: ["p2", "p1"] }) };
    expect(it.didPhotos).toEqual([{ entry: "note", ids: ["p1", "p2"] }]);
    it = { ...it, ...applyDidPatch(it, at, { removePhoto: "p1" }) };
    expect(it.didPhotos).toEqual([{ entry: "note", ids: ["p2"] }]);
    const gone = applyDidPatch(it, at, { removePhoto: "p2" });
    expect(gone).toEqual({ did: undefined, didPhotos: undefined });
  });
  it("a note with words keeps them when its photos go, and keeps its photos when its words go", () => {
    const it = todo("t", { did: [{ id: "note", on: DAY, note: "Pretend words" }], didPhotos: [{ entry: "note", ids: ["p1"] }] });
    expect(applyDidPatch(it, at, { removePhoto: "p1" })).toEqual({ did: [{ id: "note", on: DAY, note: "Pretend words" }], didPhotos: undefined });
    expect(applyDidPatch(it, at, { note: "" })).toEqual({ did: [{ id: "note", on: DAY }], didPhotos: [{ entry: "note", ids: ["p1"] }] });
  });
  it("other notes' photos are left as they are; at most MAX_DID_PHOTOS a note", () => {
    const it = todo("t", { didPhotos: [{ entry: "s1", ids: ["x"] }] });
    const many = Array.from({ length: MAX_DID_PHOTOS + 3 }, (_, i) => `p${i}`);
    const r = applyDidPatch(it, at, { addPhotos: many });
    expect(r.didPhotos![0]).toEqual({ entry: "s1", ids: ["x"] });
    expect(r.didPhotos![1]!.ids).toHaveLength(MAX_DID_PHOTOS);
  });
});

describe("didEntries, the log and the week: photos come with their note", () => {
  it("each note carries its photos", () => {
    const it = todo("t", { did: [{ id: "note", on: DAY, note: "Pretend" }], didPhotos: [{ entry: "note", ids: ["p1"] }] });
    expect(didEntries(it)).toEqual([{ id: "note", on: DAY, note: "Pretend", photos: ["p1"] }]);
    expect(didLog([it], label)[0]!.photos).toEqual(["p1"]);
    expect(completedInWeek([it], "2026-11-19", label)[0]!.photos).toEqual(["p1"]);
  });
  it("photos whose note an older app version took away still show (on the to-do's done day)", () => {
    const it = todo("t", { didPhotos: [{ entry: "note", ids: ["p1"] }] });
    expect(didEntries(it)).toEqual([{ id: "note", on: DAY, photos: ["p1"] }]);
    const project = todo("p", {
      status: "open", completedAt: undefined, touchedAt: "2026-11-17",
      sessions: [{ id: "s1", doneOn: DAY }, { id: "s2" }],
      didPhotos: [{ entry: "s1", ids: ["p2"] }],
    });
    expect(didEntries(project)).toEqual([{ id: "s1", on: DAY, session: "s1", photos: ["p2"] }]);
    expect(didLog([project], label)[0]).toMatchObject({ todo: "Session 1", photos: ["p2"] });
  });
});

describe("shownPictureIds", () => {
  it("a page's pictures and its notes' photos", () => {
    expect(shownPictureIds({ notes: "a\n![](file:pg1)", didPhotos: [{ entry: "note", ids: ["p1", "p2"] }] })).toEqual(["pg1", "p1", "p2"]);
    expect(shownPictureIds({})).toEqual([]);
  });
});
