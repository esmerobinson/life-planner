import { useState } from "react";
import type { Workbook } from "../../journal/workbooks";
import { ProgressBar } from "../ProgressBar";
import { JournalSheet } from "./JournalSheet";

/** "Day 3 of 151" and "Chapter 1 of 22" (the second only when the book has chapters). */
const position = (b: Workbook) => `${b.word} ${b.n} of ${b.total}`;
const chapterOf = (b: Workbook) => (b.chapter !== null ? `Chapter ${b.chapter} of ${b.chapters}` : "");
const barName = (b: Workbook) => [b.name, position(b), chapterOf(b)].filter(Boolean).join(" · ");

/**
 * The workbook bars (journal v3, Esme's pick 2A; mockup cards-progress-reading.html): one slim
 * bar per book at the top of the Mental health exercise tab, "BPD workbook · Day N of 151" with
 * "Chapter C of 22" on the right, over the normal progress bar. Each bar is a button opening
 * the chapter map on that book; "Chapter map" beside them opens it too.
 */
export function WorkbookBars({ books, onOpen }: { books: Workbook[]; onOpen: (id: string) => void }) {
  if (books.length === 0) return null;
  return (
    <div className="wb-bars">
      {books.map((b) => (
        <button key={b.id} type="button" className="wb-bar" aria-label={barName(b)} onClick={() => onOpen(b.id)}>
          <span className="bar-label">
            <span>
              <b className="wb-name">{b.name}</b> · <span className="nowrap">{position(b)}</span>
            </span>
            {b.chapter !== null && <span className="nowrap">{chapterOf(b)}</span>}
          </span>
          <ProgressBar ratio={b.total ? b.done / b.total : 0} label={`${b.name}: ${b.done} of ${b.total} done`} />
        </button>
      ))}
      <button type="button" className="quiet-link wb-map-link" onClick={() => onOpen(books[0]!.id)}>
        Chapter map
      </button>
    </div>
  );
}

/**
 * The chapter map pop-up (2C, in the Choose goals pop-up): a pill per book, the book's summary
 * box, then one row per chapter ("1 · Title", "done / total") with a dot per card: filled =
 * done, the violet outline = up next. Tapping a dot opens that card (and what she wrote).
 */
export function ChapterMap({
  books, start, onPick, onClose,
}: { books: Workbook[]; start: string; onPick: (cardId: string) => void; onClose: () => void }) {
  const [id, setId] = useState(start);
  const b = books.find((x) => x.id === id) ?? books[0];
  if (!b) return null;
  return (
    <JournalSheet title="Your workbooks" line="Tap a dot to open that card and your answers." onClose={onClose}>
      <div className="wb-map">
        {books.length > 1 && (
          <div className="btn-group">
            {books.map((x) => (
              <button key={x.id} type="button" aria-pressed={x.id === b.id} onClick={() => setId(x.id)}>
                {x.tab}
              </button>
            ))}
          </div>
        )}
        <div className="goal-peek-box">
          <div className="bar-label wb-summary-label">
            <b>{position(b)}</b>
            {b.chapter !== null && <span>{chapterOf(b)}</span>}
          </div>
          <ProgressBar ratio={b.total ? b.done / b.total : 0} label={`${b.name}: ${b.done} of ${b.total} done`} />
        </div>
        <ul className="wb-chapters" aria-label={`${b.name} chapters`}>
          {b.map.map((ch) => (
            <li key={`${ch.n}|${ch.title}`} className="wb-ch">
              <div className="wb-ch-top">
                <span className="wb-ch-title">{ch.title ? `${ch.n} · ${ch.title}` : `${ch.n}`}</span>
                <span className="wb-ch-n">{`${ch.done} / ${ch.cards.length}`}</span>
              </div>
              <div className="wb-dots">
                {ch.cards.map((d) => (
                  <button
                    key={d.card.id}
                    type="button"
                    className={["wb-dot", d.done ? "on" : "", d.now ? "now" : ""].filter(Boolean).join(" ")}
                    aria-label={[`${b.word} ${d.card.day}`, d.card.theme, d.done ? "done" : d.now ? "up next" : ""].filter(Boolean).join(" · ")}
                    title={`${b.word} ${d.card.day} · ${d.card.theme}`}
                    onClick={() => onPick(d.card.id)}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </JournalSheet>
  );
}
