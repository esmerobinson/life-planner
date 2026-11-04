// The reading list (Esme, 2026-11-04: "reading list should be within ideas as a sub category
// … with a book icon"). A book is an idea with a `bookStatus`; books always live under Mind.

import { BOOK_STATUSES, type AreaId, type BookStatus, type Item } from "./types";

export { BOOK_STATUSES, type BookStatus };

/** Where every book lives. */
export const BOOK_AREA: AreaId = "mind";

/** The caps the validator and the forms share. */
export const BOOK_LIMITS = { author: 200, pages: 100_000, link: 2000 } as const;

/** The words for each status (her words in the brief). */
export const BOOK_STATUS_LABEL: Record<BookStatus, string> = {
  want: "Want to read",
  reading: "Reading",
  read: "Read",
};

/** The fields only a book has (removed together when it stops being one). */
export const BOOK_FIELDS = ["bookStatus", "author", "pages", "pageAt", "finishedOn", "link"] as const;

/** An idea on the reading list. A to-do that kept book fields (an older device) is not a book. */
export function isBook(item: Item): boolean {
  return item.kind === "idea" && item.bookStatus !== undefined;
}

/** "Reading" with pages set: "page 120 of 300" and how far (0–1). Otherwise nothing. */
export function bookLine(item: Item): { pageLine: string | null; ratio: number | null } {
  if (item.bookStatus !== "reading" || !item.pages) return { pageLine: null, ratio: null };
  const at = Math.min(item.pageAt ?? 0, item.pages);
  return { pageLine: `page ${at} of ${item.pages}`, ratio: at / item.pages };
}

/**
 * Reading first, then Want to read, then Read (the mockup's order); newest finished first among
 * Read; otherwise oldest added first, then by title (the stored order is by random id).
 */
export function sortBooks(books: Item[]): Item[] {
  const order: Record<BookStatus, number> = { reading: 0, want: 1, read: 2 };
  return [...books].sort(
    (x, y) =>
      order[x.bookStatus ?? "want"] - order[y.bookStatus ?? "want"] ||
      (x.bookStatus === "read" ? (y.finishedOn ?? "").localeCompare(x.finishedOn ?? "") : 0) ||
      x.createdAt.localeCompare(y.createdAt) ||
      x.title.localeCompare(y.title),
  );
}

/** An http(s) address (what a book's link may be). */
export function isWebLink(v: string): boolean {
  if (!/^https?:\/\//i.test(v)) return false;
  try {
    new URL(v);
    return true;
  } catch {
    return false;
  }
}
