import { describe, expect, it, vi } from "vitest";
import type { Goal, Item } from "../domain/types";
import { buildIndex, highlight, queryWords, searchIndex, searchJournal, snippet, type JournalDoc } from "./search";

// ⌘K search (option 3A): the pure part. Fictional data only.
const TODAY = "2026-11-04";

let n = 0;
const item = (o: Partial<Item>): Item => ({
  id: `i${++n}`, kind: "task", title: "Pretend", links: [], areaId: "art", priority: 2, status: "open",
  createdAt: "2026-10-01", touchedAt: "2026-10-01", ...o,
});
const goal = (o: Partial<Goal>): Goal => ({
  id: `g${++n}`, title: "Pretend goal", areaId: "art", kind: "practice", milestones: [], createdAt: "2026-10-01", ...o,
});

describe("query words and highlighting", () => {
  it("splits on spaces, lowercases, drops empties and repeats", () => {
    expect(queryWords("  Market  STALL market ")).toEqual(["market", "stall"]);
    expect(queryWords("   ")).toEqual([]);
  });

  it("marks every match of every word, case-insensitively, merging overlaps", () => {
    expect(highlight("Draw the Market stall", ["market", "stall"])).toEqual([
      { text: "Draw the ", bold: false },
      { text: "Market", bold: true },
      { text: " ", bold: false },
      { text: "stall", bold: true },
    ]);
    expect(highlight("aaa", ["a", "aa"])).toEqual([{ text: "aaa", bold: true }]);
    expect(highlight("nothing here", ["zzz"])).toEqual([{ text: "nothing here", bold: false }]);
  });

  it("a snippet is the words around the first match, with … where it is cut", () => {
    const long = `${"word ".repeat(30)}the pretend market hall in town ${"tail ".repeat(30)}`;
    const s = snippet(long, ["market"]);
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s).toContain("pretend market hall");
    expect(s.length).toBeLessThan(120);
    expect(snippet("short market note", ["market"])).toBe("short market note");
  });
});

describe("searching items, books, projects, goals and notes", () => {
  const items = [
    item({ title: "Draw the pretend market stall", areaId: "art", due: "2026-11-06" }),
    item({ title: "Ask about the pretend market", areaId: "inbox" }),
    item({ kind: "idea", title: "Pretend market zine", areaId: "content" }),
    item({ kind: "idea", title: "Night Pretend Bazaar", areaId: "mind", bookStatus: "read", author: "Lena Market", finishedOn: "2026-10-30" }),
    item({ title: "Pretend street scene", sessions: [{ id: "s1", title: "Market lighting" }, { id: "s2" }] }),
    item({ title: "Blender pretend project", notes: "Reference folder: market photos from the pretend trip\n![](file:abc)" }),
    item({ title: "Pretend market done long ago", status: "done", completedAt: "2026-10-02" }),
    item({ title: "Unrelated pretend thing" }),
  ];
  const goals = [
    goal({ title: "Sell pretend prints at the market", deadline: "2026-12-12", kind: "finite" }),
    goal({ title: "Pretend launch plan", areaId: "production", notes: "A pop-up near the pretend market hall" }),
  ];
  const index = buildIndex(items, goals, TODAY);

  it("groups by type in order: To-dos, Projects, Ideas, Books, Goals, Notes", () => {
    const r = searchIndex(index, "market");
    expect(r.map((g) => g.group)).toEqual(["todos", "projects", "ideas", "books", "goals", "notes"]);
    const todos = r.find((g) => g.group === "todos")!;
    expect(todos.hits.map((h) => h.title)).toEqual([
      "Draw the pretend market stall", "Ask about the pretend market", "Pretend market done long ago",
    ]);
    expect(todos.hits[0].meta).toBe("To-do · Art · Due Fri 6 Nov");
    expect(todos.hits[1].meta).toBe("Inbox");
    expect(todos.hits[2].meta).toBe("To-do · Art · Done");
  });

  it("books are found by author too, with their status in the meta line", () => {
    const books = searchIndex(index, "lena").find((g) => g.group === "books")!;
    expect(books.hits[0]).toMatchObject({ title: "Night Pretend Bazaar", sub: "Lena Market", meta: "Book · Read · finished Fri 30 Oct" });
  });

  it("a project is found by a session's title; the session shows as the snippet", () => {
    const p = searchIndex(index, "lighting").find((g) => g.group === "projects")!;
    expect(p.hits[0]).toMatchObject({ title: "Pretend street scene", sub: "Session: Market lighting" });
  });

  it("page notes match on their own (Notes group), with a snippet and no picture markup", () => {
    const notes = searchIndex(index, "photos").find((g) => g.group === "notes")!;
    expect(notes.hits[0]).toMatchObject({ title: "Blender pretend project", meta: "Note on a to-do · Art" });
    expect(notes.hits[0].sub).toContain("market photos from the pretend trip");
    expect(notes.hits[0].sub).not.toContain("file:");
    const goalNote = searchIndex(index, "pop-up").find((g) => g.group === "notes")!;
    expect(goalNote.hits[0]).toMatchObject({ title: "Pretend launch plan", meta: "Note on a goal · Production" });
  });

  it("every word must match (anywhere in title, author, sessions or notes)", () => {
    expect(searchIndex(index, "market zine").flatMap((g) => g.hits.map((h) => h.title))).toEqual(["Pretend market zine"]);
    expect(searchIndex(index, "market nothingmatches")).toEqual([]);
    expect(searchIndex(index, "")).toEqual([]);
  });

  it("goals show By <date>; opening an item or goal opens its side panel", () => {
    const g = searchIndex(index, "prints").find((x) => x.group === "goals")!;
    expect(g.hits[0]).toMatchObject({ meta: "Goal · Art · By 12 Dec", open: { panel: goals[0].id } });
  });

  it("caps each group (the total is still counted); with 1,000 items a query does no per-item text work", () => {
    const many = Array.from({ length: 1000 }, (_, i) =>
      item({ title: `Pretend errand ${i}`, notes: `Pretend market notes ${i} `.repeat(40) }),
    );
    const big = buildIndex(many, [], TODAY);
    // Deterministic, not a stopwatch: texts are lowercased once when the index is built, and a
    // snippet is cut only for the rows shown (8), never for all 1,000 matches.
    const lower = vi.spyOn(String.prototype, "toLowerCase");
    const r = searchIndex(big, "market errand", 8);
    const calls = lower.mock.calls.length;
    lower.mockRestore();
    expect(r[0]).toMatchObject({ group: "notes", total: 1000 });
    expect(r[0].hits).toHaveLength(8);
    expect(calls).toBeLessThanOrEqual(1 + 8);
    // `cap` Infinity is "See all": every match.
    expect(searchIndex(big, "market errand", Infinity)[0].hits).toHaveLength(1000);
  });

  it("an Inbox item is just Inbox (it has no type until it is sorted)", () => {
    const r = searchIndex(index, "ask about");
    expect(r[0].hits[0].meta).toBe("Inbox");
  });
});

describe("searching the journal (decrypted, in memory)", () => {
  const docs: JournalDoc[] = [
    { id: "j1", kind: "checkin", date: "2026-10-22", title: "Daily check-in", text: "The pretend market was crowded, I used paced breathing", context: "Name one feeling…" },
    { id: "j2", kind: "exercise", date: "2026-10-19", title: "Mental health exercise · Day 38", text: "Left the pretend market early and that was okay" },
    { id: "j3", kind: "morning", date: "2026-10-02", title: "Morning pages", text: "The pretend market dream again" },
  ];

  it("finds entries by their text, newest first, with a snippet and the day", () => {
    const hits = searchJournal(docs, "market", TODAY);
    expect(hits.map((h) => h.id)).toEqual(["j1", "j2", "j3"]);
    expect(hits[0]).toMatchObject({ title: "Daily check-in", meta: "Thu 22 Oct", open: { path: "/journal/check-in" } });
    expect(hits[0].sub).toContain("pretend market was crowded");
    expect(hits[1].open).toEqual({ path: "/journal/exercise" });
    expect(hits[2].open).toEqual({ path: "/journal/read-back" });
  });

  it("lowercases each entry once, not on every keystroke", () => {
    searchJournal(docs, "market", TODAY); // first search prepares the entries
    const lower = vi.spyOn(String.prototype, "toLowerCase");
    searchJournal(docs, "market", TODAY);
    const calls = lower.mock.calls.length;
    lower.mockRestore();
    expect(calls).toBeLessThanOrEqual(1 + docs.length); // the query, and one snippet per hit
  });

  it("never returns a morning page under 28 days old, even if one slipped into the list", () => {
    const fresh: JournalDoc = { id: "j4", kind: "morning", date: "2026-10-29", title: "Morning pages", text: "pretend market" };
    expect(searchJournal([...docs, fresh], "market", TODAY).map((h) => h.id)).not.toContain("j4");
  });
});
