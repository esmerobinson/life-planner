import { BOOK_AREA, BOOK_STATUS_LABEL, bookLine, sortBooks } from "../domain/books";
import type { ISODate, Item } from "../domain/types";
import { useOpenAdd } from "./addContext";
import { BookIcon } from "./BookIcon";
import { ProgressBar } from "./ProgressBar";
import { TaskRow } from "./TaskRow";

/** A book's small lines under its title: the author, and "page 120 of 300" over a thin bar while Reading. */
export function BookMeta({ item }: { item: Item }) {
  const { pageLine, ratio } = bookLine(item);
  const words = [item.author, pageLine].filter(Boolean).join(" · ");
  if (!words) return null;
  return (
    <>
      <div className="strip-meta">{words}</div>
      {ratio !== null && (
        <div className="book-bar">
          <ProgressBar ratio={ratio} label={`${item.title}: ${pageLine}`} />
        </div>
      )}
    </>
  );
}

/** The status as a small pill on the strip (not a control: the panel changes it). */
export function BookPill({ item }: { item: Item }) {
  return <span className="book-pill">{BOOK_STATUS_LABEL[item.bookStatus ?? "want"]}</span>;
}

/**
 * The reading list inside Mind's Ideas (Esme, 2026-11-04: "within ideas as a sub category …
 * with a book icon"): a heading with the pixel book and the count, then each book as a normal
 * idea strip (title; author and, while Reading, the page under it; the status pill on the
 * right), Reading first, then Want to read, then Read. "+ Add a book" opens Add set to Book.
 */
export function ReadingList({ books, today, onMoved }: { books: Item[]; today: ISODate; onMoved: () => Promise<void> }) {
  const openAdd = useOpenAdd();
  const heading = `Reading list (${books.length})`;
  return (
    <section className="reading-list" aria-labelledby="reading-list-heading">
      <h3 className="reading-head" id="reading-list-heading">
        <BookIcon />
        {heading}
      </h3>
      {books.length > 0 && (
        <ul aria-label="Books" className="strip-list">
          {sortBooks(books).map((b) => (
            <TaskRow key={b.id} item={b} today={today} onMoved={onMoved} meta={<BookMeta item={b} />} extra={<BookPill item={b} />} />
          ))}
        </ul>
      )}
      {openAdd && (
        <button type="button" className="quiet-link reading-add" onClick={() => openAdd({ type: "book", areaId: BOOK_AREA })}>
          + Add a book
        </button>
      )}
    </section>
  );
}
