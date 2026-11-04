import { describe, expect, it, beforeEach } from "vitest";
import { db } from "./db";
import { createBook, createItem, makeBook, setBookStatus, unBook, updateBook } from "./repo";
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

  it("makeBook: a to-do in Art becomes a Want to read book under Mind; returns the row as it was", async () => {
    const t = await createItem(
      { kind: "task", title: "Pretend graphic novel", areaId: "art", priority: 1, due: "2026-11-20", recur: undefined, pinnedDate: TODAY, notes: "Pretend notes" },
      "2026-10-01",
    );
    const was = await makeBook(t.id, TODAY);
    expect(was?.areaId).toBe("art");
    const b = (await db.items.get(t.id))!;
    expect(b).toMatchObject({ kind: "idea", areaId: "mind", bookStatus: "want", notes: "Pretend notes", touchedAt: TODAY });
    expect(b.due).toBeUndefined();
    expect(b.pinnedDate).toBeUndefined();
    expect(validItem(b)).toBe(true);
  });

  it("makeBook keeps an existing status (a book stays as it is) and drops a project's sessions", async () => {
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

  it("unBook: back to a plain idea (or a to-do), every book field gone", async () => {
    const b = await createBook({ title: "Pretend novel", author: "Pretend Author", bookStatus: "read" }, TODAY);
    await updateBook(b.id, { pages: 200, pageAt: 200, link: "https://example.test" }, TODAY);
    await unBook(b.id, "task", TODAY);
    const t = (await db.items.get(b.id))!;
    expect(t.kind).toBe("task");
    for (const k of ["bookStatus", "author", "pages", "pageAt", "finishedOn", "link"] as const) expect(t[k]).toBeUndefined();
  });
});
