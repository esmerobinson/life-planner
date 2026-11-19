import type { Item } from "./types";
import {
  completedInWeek, didLog, didTarget, folderFor, logWeeks, safeName, validDid, withDidEntry, MAX_DID_NOTE,
} from "./whatIDid";

// "What I did" (Esme, 19 Nov 2026). Made-up to-dos only.

const base = { links: [], priority: 2 as const, createdAt: "2026-11-01", touchedAt: "2026-11-01" };
const todo = (id: string, extra: Partial<Item> = {}): Item => ({
  id, kind: "task", title: `Pretend ${id}`, areaId: "writing", status: "done", completedAt: "2026-11-18", ...base, ...extra,
});
const label = (id: string) => ({ writing: "Writing", admin: "Admin", tech: "Tech projects", inbox: "Inbox" })[id] ?? id;

describe("safeName: a name macOS accepts", () => {
  it("swaps slashes and colons, drops control characters and leading dots, trims", () => {
    expect(safeName("Book/Chapter: one")).toBe("Book-Chapter- one");
    expect(safeName("  ..hidden  ")).toBe("hidden");
    expect(safeName("a\u0000b\nc")).toBe("abc");
  });
  it("never empty, never '.' or '..', at most 100 characters", () => {
    expect(safeName("")).toBe("Untitled");
    expect(safeName("...")).toBe("Untitled");
    expect(safeName("x".repeat(300))).toHaveLength(100);
  });
});

describe("folderFor", () => {
  it("the area's folder, with the project's inside it", () => {
    expect(folderFor("~/Desktop", "Tech projects")).toBe("~/Desktop/Tech projects");
    expect(folderFor("~/Desktop/", "Writing", "Book: draft 2")).toBe("~/Desktop/Writing/Book- draft 2");
  });
});

describe("validDid", () => {
  const entry = { id: "e1", on: "2026-11-18", note: "Pretend note", files: [{ name: "a.pdf", folder: "~/Desktop/Writing" }] };
  it("accepts absent, empty and well-formed lists", () => {
    expect(validDid(undefined)).toBe(true);
    expect(validDid([])).toBe(true);
    expect(validDid([entry, { id: "e2", on: "2026-11-19", session: "s1" }])).toBe(true);
  });
  it("refuses bad shapes, unknown keys, bad dates, duplicate ids and over-long text", () => {
    expect(validDid("x")).toBe(false);
    expect(validDid([{ ...entry, extra: 1 }])).toBe(false);
    expect(validDid([{ ...entry, on: "2026-13-01" }])).toBe(false);
    expect(validDid([entry, entry])).toBe(false);
    expect(validDid([{ ...entry, note: "x".repeat(MAX_DID_NOTE + 1) }])).toBe(false);
    expect(validDid([{ ...entry, files: [{ name: "", folder: "~" }] }])).toBe(false);
    expect(validDid([{ ...entry, files: [{ name: "a", folder: "~", size: 3 }] }])).toBe(false);
  });
});

describe("withDidEntry", () => {
  it("adds an entry, sets its note, adds files, and removes it once nothing is in it", () => {
    let list = withDidEntry(undefined, { id: "e1", on: "2026-11-18" }, { note: "Pretend wrote it" });
    expect(list).toEqual([{ id: "e1", on: "2026-11-18", note: "Pretend wrote it" }]);
    list = withDidEntry(list, { id: "e1", on: "2026-11-18" }, { addFiles: [{ name: "a.txt", folder: "~/Desktop/Writing" }] });
    expect(list![0]!.files).toEqual([{ name: "a.txt", folder: "~/Desktop/Writing" }]);
    list = withDidEntry(list, { id: "e1", on: "2026-11-18" }, { note: "  " });
    expect(list).toEqual([{ id: "e1", on: "2026-11-18", files: [{ name: "a.txt", folder: "~/Desktop/Writing" }] }]);
    list = withDidEntry(list, { id: "e1", on: "2026-11-18" }, { removeFile: 0 });
    expect(list).toBeUndefined();
  });
  it("keeps the other entries and the entry's own day and session", () => {
    const list = withDidEntry([{ id: "e0", on: "2026-11-10", note: "Old" }], { id: "e1", on: "2026-11-18", session: "s2" }, { note: "New" });
    expect(list).toEqual([{ id: "e0", on: "2026-11-10", note: "Old" }, { id: "e1", on: "2026-11-18", session: "s2", note: "New" }]);
  });
});

describe("the log", () => {
  const items: Item[] = [
    todo("plain", { did: [{ id: "e1", on: "2026-11-18", note: "Pretend wrote 500 words", files: [{ name: "draft.docx", folder: "~/Desktop/Writing" }] }] }),
    todo("proj", {
      title: "Pretend zine", areaId: "art", status: "open", completedAt: undefined,
      sessions: [{ id: "s1", doneOn: "2026-11-10" }, { id: "s2", title: "Pretend inking", doneOn: "2026-11-16" }, { id: "s3" }],
      did: [{ id: "e2", on: "2026-11-10", session: "s1", note: "Pretend sketches" }, { id: "e3", on: "2026-11-16", session: "s2", note: "Pretend inked" }],
    }),
    todo("binned", { status: "deleted", did: [{ id: "e4", on: "2026-11-18", note: "Pretend gone" }] }),
    todo("nothing"),
  ];
  it("one row per entry, newest first; a session's entry names the session as the to-do and the project", () => {
    const log = didLog(items, label);
    expect(log.map((e) => e.entryId)).toEqual(["e1", "e3", "e2"]);
    expect(log[0]).toMatchObject({ itemId: "plain", todo: "Pretend plain", area: "writing", areaLabel: "Writing", note: "Pretend wrote 500 words" });
    expect(log[0]!.project).toBeUndefined();
    expect(log[1]).toMatchObject({ todo: "Session 2: Pretend inking", project: "Pretend zine", area: "art" });
    expect(log[2]).toMatchObject({ todo: "Session 1", project: "Pretend zine" });
  });
  it("grouped by week, Monday to Sunday, newest week first", () => {
    const weeks = logWeeks(didLog(items, label));
    expect(weeks.map((w) => [w.monday, w.sunday, w.entries.map((e) => e.entryId)])).toEqual([
      ["2026-11-16", "2026-11-22", ["e1", "e3"]],
      ["2026-11-09", "2026-11-15", ["e2"]],
    ]);
  });
});

describe("completedInWeek: the weekly review's read-only list", () => {
  it("to-dos done that week (Monday to Sunday) and project sessions done that week, with their notes; never habits", () => {
    const items: Item[] = [
      todo("a", { completedAt: "2026-11-16", did: [{ id: "e1", on: "2026-11-16", note: "Pretend A note" }] }),
      todo("b", { completedAt: "2026-11-15" }), // last week
      todo("c", { completedAt: "2026-11-22" }),
      todo("habit", { status: "open", completedAt: undefined, recur: ["mon"], doneDates: ["2026-11-17"] }),
      todo("proj", {
        title: "Pretend zine", status: "open", completedAt: undefined,
        sessions: [{ id: "s1", doneOn: "2026-11-18" }, { id: "s2" }],
        did: [{ id: "e2", on: "2026-11-18", session: "s1", note: "Pretend session note" }],
      }),
      todo("idea", { kind: "idea", status: "done", completedAt: "2026-11-17" }),
      todo("gone", { status: "deleted", completedAt: "2026-11-17" }),
    ];
    const rows = completedInWeek(items, "2026-11-19", label);
    expect(rows.map((r) => [r.todo, r.on, r.note ?? null])).toEqual([
      ["Pretend c", "2026-11-22", null],
      ["Session 1", "2026-11-18", "Pretend session note"],
      ["Pretend a", "2026-11-16", "Pretend A note"],
    ]);
    expect(rows[1]!.project).toBe("Pretend zine");
  });
});

describe("didTarget (review M4, M7)", () => {
  it("a plain to-do's note always has the same id, so the side panel and a tick never make two", () => {
    expect(didTarget(todo("a"), "2026-11-18")).toEqual({ id: "note", on: "2026-11-18" });
    expect(didTarget(todo("a"), "2026-11-19").id).toBe(didTarget(todo("a"), "2026-11-18").id);
    expect(didTarget(todo("p", { sessions: [{ id: "s1" }] }), "2026-11-18", "s1")).toEqual({ id: "s1", on: "2026-11-18", session: "s1" });
  });
  it("an existing note keeps its id; a re-tick moves it to the new day, the side panel keeps its day", () => {
    const it = todo("a", { did: [{ id: "old-id", on: "2026-11-10", note: "Pretend" }] });
    expect(didTarget(it, "2026-11-18")).toEqual({ id: "old-id", on: "2026-11-10" });
    expect(didTarget(it, "2026-11-18", undefined, true)).toEqual({ id: "old-id", on: "2026-11-18" });
    expect(withDidEntry(it.did, { id: "old-id", on: "2026-11-18" }, { note: "Pretend more" })).toEqual([{ id: "old-id", on: "2026-11-18", note: "Pretend more" }]);
  });
});

describe("safeName in bytes (review M3)", () => {
  it("at most 200 UTF-8 bytes, never splitting a character", () => {
    const emoji = safeName("🎨".repeat(80));
    expect(new TextEncoder().encode(emoji).length).toBeLessThanOrEqual(200);
    expect(emoji).toBe("🎨".repeat(50));
    const cjk = safeName("漫".repeat(90));
    expect(new TextEncoder().encode(cjk).length).toBeLessThanOrEqual(200);
    expect([...cjk].every((c) => c === "漫")).toBe(true);
  });
});
