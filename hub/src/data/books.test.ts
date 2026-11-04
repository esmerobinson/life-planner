import { describe, expect, it, beforeEach } from "vitest";
import { db } from "./db";
import {
  archiveItem, createBook, createItem, deleteItem, emptyBin, makeBook, restoreItem, setBookStatus, unBook, updateBook, updateItem,
} from "./repo";
import { validItem } from "./validate";
import { BOOK_LIMITS, bookLine, isBook } from "../domain/books";

// Reading list (books are ideas under Mind). Fictional data only.
const TODAY = "2026-11-04";

const row = (o: Record<string, unknown> = {}) => ({
  id: "b1", kind: "idea", title: "Pretend novel", links: [], areaId: "mind", priority: 2,
  status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01", ...o,
});

describe("book fields in the item validator (all optional, tight caps)", () => {
  it("a row without book fields is still valid (older rows)", () => {
    expect(validItem(row())).toBe(true);
  });

  it("bookStatus is want, reading or read", () => {
    for (const s of ["want", "reading", "read"]) expect(validItem(row({ bookStatus: s }))).toBe(true);
    expect(validItem(row({ bookStatus: "finished" }))).toBe(false);
    expect(validItem(row({ bookStatus: 1 }))).toBe(false);
  });

  it("author is a non-empty string of at most 200 characters", () => {
    expect(validItem(row({ bookStatus: "want", author: "Pretend Author" }))).toBe(true);
    expect(validItem(row({ author: "a".repeat(BOOK_LIMITS.author) }))).toBe(true);
    expect(validItem(row({ author: "a".repeat(BOOK_LIMITS.author + 1) }))).toBe(false);
    expect(validItem(row({ author: "" }))).toBe(false);
    expect(validItem(row({ author: 7 }))).toBe(false);
  });

  it("pages and pageAt are whole numbers in range; pageAt never past pages", () => {
    expect(validItem(row({ pages: 300, pageAt: 120 }))).toBe(true);
    expect(validItem(row({ pages: 300 }))).toBe(true);
    expect(validItem(row({ pageAt: 12 }))).toBe(true);
    expect(validItem(row({ pages: 300, pageAt: 0 }))).toBe(true);
    expect(validItem(row({ pages: 300, pageAt: 300 }))).toBe(true);
    expect(validItem(row({ pages: 300, pageAt: 301 }))).toBe(false);
    expect(validItem(row({ pages: 0 }))).toBe(false);
    expect(validItem(row({ pages: 12.5 }))).toBe(false);
    expect(validItem(row({ pages: BOOK_LIMITS.pages + 1 }))).toBe(false);
    expect(validItem(row({ pageAt: -1 }))).toBe(false);
    expect(validItem(row({ pages: "300" }))).toBe(false);
  });

  it("finishedOn is a real date", () => {
    expect(validItem(row({ bookStatus: "read", finishedOn: "2026-10-18" }))).toBe(true);
    expect(validItem(row({ finishedOn: "2026-02-30" }))).toBe(false);
  });

  it("link is an http(s) address of at most 2000 characters", () => {
    expect(validItem(row({ link: "https://library.example.test/pretend-novel" }))).toBe(true);
    expect(validItem(row({ link: "http://example.test" }))).toBe(true);
    expect(validItem(row({ link: "javascript:alert(1)" }))).toBe(false);
    expect(validItem(row({ link: "" }))).toBe(false);
    expect(validItem(row({ link: `https://example.test/${"a".repeat(BOOK_LIMITS.link)}` }))).toBe(false);
  });

  it("a to-do keeping its book fields is still valid (an older device may change a book to a to-do)", () => {
    expect(validItem(row({ kind: "task", bookStatus: "reading", author: "Pretend Author", areaId: "writing" }))).toBe(true);
  });

  it("a purged tombstone from an older device that kept book fields is still accepted", () => {
    expect(validItem(row({ status: "purged", title: "", bookStatus: "want", author: "Pretend Author" }))).toBe(true);
  });
});

describe("isBook and the strip line", () => {
  it("a book is an idea with a status", () => {
    expect(isBook(row({ bookStatus: "want" }) as never)).toBe(true);
    expect(isBook(row() as never)).toBe(false);
    expect(isBook(row({ kind: "task", bookStatus: "want" }) as never)).toBe(false);
  });

  it("reading with pages: page N of M", () => {
    expect(bookLine(row({ bookStatus: "reading", pages: 300, pageAt: 120 }) as never)).toEqual({ pageLine: "page 120 of 300", ratio: 0.4 });
    expect(bookLine(row({ bookStatus: "reading", pages: 300 }) as never)).toEqual({ pageLine: "page 0 of 300", ratio: 0 });
    expect(bookLine(row({ bookStatus: "reading" }) as never)).toEqual({ pageLine: null, ratio: null });
    expect(bookLine(row({ bookStatus: "want", pages: 300, pageAt: 20 }) as never)).toEqual({ pageLine: null, ratio: null });
  });
});

describe("making and changing books (repo)", () => {
  beforeEach(async () => {
    await db.items.clear();
  });

  it("createBook: an idea in Mind with its status and author; Read sets finishedOn", async () => {
    const b = await createBook({ title: " Pretend novel ", author: " Pretend Author ", bookStatus: "want" }, TODAY);
    expect(b).toMatchObject({ kind: "idea", areaId: "mind", title: "Pretend novel", author: "Pretend Author", bookStatus: "want", status: "open" });
    expect(b.finishedOn).toBeUndefined();
    const r = await createBook({ title: "Pretend memoir", bookStatus: "read" }, TODAY);
    expect(r).toMatchObject({ bookStatus: "read", finishedOn: TODAY });
    expect(r.author).toBeUndefined();
  });

  it("makeBook: a to-do in Art becomes a Want to read book under Mind; its to-do fields are put away, not lost", async () => {
    const t = await createItem(
      {
        kind: "task", title: "Pretend graphic novel", areaId: "art", priority: 1, due: "2026-11-20", recur: ["mon"], pinnedDate: TODAY,
        hiddenOn: "2026-11-03", milestone: true, goalId: "g-pretend", notes: "Pretend notes",
      },
      "2026-10-01",
    );
    const was = await makeBook(t.id, TODAY);
    expect(was?.areaId).toBe("art");
    const b = (await db.items.get(t.id))!;
    expect(b).toMatchObject({ kind: "idea", areaId: "mind", bookStatus: "want", notes: "Pretend notes", touchedAt: TODAY });
    for (const k of ["due", "recur", "pinnedDate", "hiddenOn", "milestone"] as const) expect(b[k]).toBeUndefined();
    expect(b.stash?.task).toEqual({ due: "2026-11-20", recur: ["mon"], pinnedDate: TODAY, hiddenOn: "2026-11-03", milestone: true });
    expect(validItem(b)).toBe(true);

    // Back to a to-do: the due date, repeat, day, hide and flag come back; the book's fields are put away.
    await unBook(t.id, "task", TODAY);
    const back = (await db.items.get(t.id))!;
    expect(back).toMatchObject({ kind: "task", due: "2026-11-20", recur: ["mon"], pinnedDate: TODAY, hiddenOn: "2026-11-03", milestone: true });
    expect(back.bookStatus).toBeUndefined();
    expect(back.stash?.task).toBeUndefined();
    expect(back.stash?.book).toEqual({ bookStatus: "want" });
    expect(validItem(back)).toBe(true);
  });

  it("a done to-do changed to a Book is a Read book (finished the day it was done), shown, and comes back done", async () => {
    const t = await createItem({ kind: "task", title: "Pretend finished novel", areaId: "mind", priority: 2 }, "2026-10-01");
    await db.items.update(t.id, { status: "done", completedAt: "2026-10-20" });
    await makeBook(t.id, TODAY);
    const b = (await db.items.get(t.id))!;
    expect(b).toMatchObject({ kind: "idea", status: "open", bookStatus: "read", finishedOn: "2026-10-20" });
    expect(b.completedAt).toBeUndefined();
    expect(isBook(b)).toBe(true);
    expect(validItem(b)).toBe(true);
    await unBook(t.id, "task", TODAY);
    expect((await db.items.get(t.id))!).toMatchObject({ kind: "task", status: "done", completedAt: "2026-10-20" });
  });

  it("the stash is checked like the fields themselves", () => {
    expect(validItem(row({ stash: { task: { due: "2026-11-20", recur: ["mon"], milestone: true } } }))).toBe(true);
    expect(validItem(row({ stash: { book: { bookStatus: "read", author: "A", pages: 10, pageAt: 10, finishedOn: "2026-10-01", link: "https://x.test" } } }))).toBe(true);
    expect(validItem(row({ stash: { task: { due: "2026-02-30" } } }))).toBe(false);
    expect(validItem(row({ stash: { task: { title: "x" } } }))).toBe(false);
    expect(validItem(row({ stash: { book: { author: "" } } }))).toBe(false);
    expect(validItem(row({ stash: { other: {} } }))).toBe(false);
    expect(validItem(row({ stash: "no" }))).toBe(false);
  });

  it("makeBook keeps an existing status (a book stays as it is) and drops a project's sessions (Undo covers them)", async () => {
    const p = await createItem(
      { kind: "task", title: "Pretend reading project", areaId: "mind", priority: 2, due: "2026-12-01", sessions: [{ id: "s1" }] },
      "2026-10-01",
    );
    await makeBook(p.id, TODAY);
    expect((await db.items.get(p.id))!.sessions).toBeUndefined();
    await setBookStatus(p.id, "reading", TODAY);
    await makeBook(p.id, TODAY);
    expect((await db.items.get(p.id))!.bookStatus).toBe("reading");
  });

  it("setBookStatus: Read sets finishedOn to today; leaving Read clears it", async () => {
    const b = await createBook({ title: "Pretend novel", bookStatus: "reading" }, "2026-10-01");
    await setBookStatus(b.id, "read", TODAY);
    expect((await db.items.get(b.id))!).toMatchObject({ bookStatus: "read", finishedOn: TODAY });
    await setBookStatus(b.id, "read", "2026-11-09"); // already read: the date stays
    expect((await db.items.get(b.id))!.finishedOn).toBe(TODAY);
    await setBookStatus(b.id, "want", TODAY);
    const back = (await db.items.get(b.id))!;
    expect(back.bookStatus).toBe("want");
    expect(back.finishedOn).toBeUndefined();
  });

  it("updateBook: trims, blank removes, pages clamp the page reached, bad values are refused", async () => {
    const b = await createBook({ title: "Pretend novel", bookStatus: "reading" }, "2026-10-01");
    await updateBook(b.id, { author: "  Pretend Author ", pages: 300, pageAt: 120, link: " https://library.example.test/x " }, TODAY);
    expect((await db.items.get(b.id))!).toMatchObject({ author: "Pretend Author", pages: 300, pageAt: 120, link: "https://library.example.test/x" });
    await updateBook(b.id, { pages: 100 }, TODAY);
    expect((await db.items.get(b.id))!).toMatchObject({ pages: 100, pageAt: 100 });
    await updateBook(b.id, { author: " ", link: "", pages: undefined, pageAt: undefined }, TODAY);
    const cleared = (await db.items.get(b.id))!;
    expect(cleared.author).toBeUndefined();
    expect(cleared.link).toBeUndefined();
    expect(cleared.pages).toBeUndefined();
    expect(cleared.pageAt).toBeUndefined();
    await expect(updateBook(b.id, { link: "notaurl" }, TODAY)).rejects.toThrow();
    await expect(updateBook(b.id, { pages: 0 }, TODAY)).rejects.toThrow();
    await expect(updateBook(b.id, { author: "a".repeat(BOOK_LIMITS.author + 1) }, TODAY)).rejects.toThrow();
  });

  it("writes that don't know about books keep the book fields (rows are spread, as an older app version writes them)", async () => {
    const b = await createBook({ title: "Pretend novel", author: "Pretend Author", bookStatus: "reading" }, TODAY);
    await updateBook(b.id, { pages: 300, pageAt: 12, link: "https://example.test/pretend" }, TODAY);
    await updateItem(b.id, { title: "Pretend novel (renamed)" }, TODAY);
    await archiveItem(b.id, TODAY);
    await restoreItem(b.id, TODAY);
    expect((await db.items.get(b.id))!).toMatchObject({
      title: "Pretend novel (renamed)", bookStatus: "reading", author: "Pretend Author", pages: 300, pageAt: 12, link: "https://example.test/pretend",
    });
  });

  it("emptying the Bin leaves a content-free tombstone (no author, link, pages or stash)", async () => {
    const b = await createBook({ title: "Pretend novel", author: "Pretend Author", bookStatus: "read" }, TODAY);
    await updateBook(b.id, { link: "https://example.test/pretend", pages: 10 }, TODAY);
    await unBook(b.id, "idea", TODAY);
    await deleteItem(b.id, TODAY);
    await emptyBin(TODAY);
    const t = (await db.items.get(b.id))!;
    expect(t.status).toBe("purged");
    for (const k of ["bookStatus", "author", "pages", "pageAt", "finishedOn", "link", "stash"] as const) expect(t[k]).toBeUndefined();
  });

  it("unBook keeps the book's fields put away; Change to → Book brings every one back (idea round trip)", async () => {
    const b = await createBook({ title: "Pretend novel", author: "Pretend Author", bookStatus: "read" }, "2026-10-25");
    await updateBook(b.id, { pages: 200, pageAt: 200, link: "https://example.test" }, TODAY);
    await unBook(b.id, "idea", TODAY);
    const idea = (await db.items.get(b.id))!;
    expect(idea.kind).toBe("idea");
    expect(isBook(idea)).toBe(false);
    for (const k of ["bookStatus", "author", "pages", "pageAt", "finishedOn", "link"] as const) expect(idea[k]).toBeUndefined();
    expect(idea.stash?.book).toEqual({
      bookStatus: "read", author: "Pretend Author", pages: 200, pageAt: 200, finishedOn: "2026-10-25", link: "https://example.test",
    });
    expect(validItem(idea)).toBe(true);
    await makeBook(b.id, TODAY);
    const again = (await db.items.get(b.id))!;
    expect(again).toMatchObject({
      kind: "idea", bookStatus: "read", author: "Pretend Author", pages: 200, pageAt: 200, finishedOn: "2026-10-25", link: "https://example.test",
    });
    expect(again.stash).toBeUndefined();
  });

  it("unBook to a project: sessions, no repeat, the book put away, in one write", async () => {
    const b = await createBook({ title: "Pretend novel", author: "Pretend Author", bookStatus: "reading" }, TODAY);
    await unBook(b.id, "project", TODAY);
    const p = (await db.items.get(b.id))!;
    expect(p.kind).toBe("task");
    expect(p.sessions?.length).toBe(4);
    expect(p.stash?.book).toMatchObject({ bookStatus: "reading", author: "Pretend Author" });
    expect(validItem(p)).toBe(true);
  });

  it("a book an older device moved to another area comes home to Mind on Change to → Book", async () => {
    const b = await createBook({ title: "Pretend novel", bookStatus: "want" }, TODAY);
    await db.items.update(b.id, { areaId: "art" });
    await makeBook(b.id, TODAY);
    expect((await db.items.get(b.id))!.areaId).toBe("mind");
  });
});
