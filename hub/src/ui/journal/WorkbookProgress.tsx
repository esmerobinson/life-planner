import { useState, type ReactNode } from "react";
import type { ExerciseCard } from "../../journal/exercise";
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
 * The chapter map pop-up (2C, in the Choose goals pop-up), and the one place every card lives
 * (Esme, 2026-11-04: "See all chapters", not a long list on the tab): a pill per book, the
 * book's summary box, its optional reading, then one row per chapter ("1 · Title", "done /
 * total") with a dot per card (filled = done, the violet outline = up next). A chapter opens to
 * its cards. Tapping a dot or a card opens it here (`renderCard`: the card and what she wrote),
 * with a way back to the chapters.
 */
export function ChapterMap({
  books, optional = [], start, startCard = null, renderCard, onClose,
}: {
  books: Workbook[];
  optional?: ExerciseCard[];
  start: string;
  startCard?: string | null;
  renderCard: (card: ExerciseCard) => ReactNode;
  onClose: () => void;
}) {
  const byId = new Map<string, ExerciseCard>([
    ...books.flatMap((x) => x.map.flatMap((ch) => ch.cards.map((d) => [d.card.id, d.card] as const))),
    ...optional.map((c) => [c.id, c] as const),
  ]);
  const startBook = startCard ? books.find((x) => x.id === byId.get(startCard)?.track)?.id : undefined;
  const [id, setId] = useState(startBook ?? start);
  const [cardId, setCardId] = useState<string | null>(startCard && byId.has(startCard) ? startCard : null);
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const b = books.find((x) => x.id === id) ?? books[0];
  if (!b) return null;
  const card = cardId ? byId.get(cardId) : undefined;
  const toggle = (key: string) =>
    setOpened((s) => {
      const next = new Set(s);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const label = (c: ExerciseCard) => (c.optional || c.day === null ? `${c.theme} (optional reading)` : `${b.word} ${c.day} · ${c.theme}`);
  const mine = optional.filter((c) => c.track === b.id || (books.length === 1 && !books.some((x) => x.id === c.track)));

  if (card) {
    return (
      <JournalSheet title="Your workbooks" onClose={onClose}>
        <div className="wb-map">
          <div className="btn-group">
            <button type="button" className="btn-secondary" onClick={() => setCardId(null)}>
              ← All chapters
            </button>
          </div>
          {renderCard(card)}
        </div>
      </JournalSheet>
    );
  }
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
        {mine.length > 0 && (
          <ul className="wb-chapters" aria-label="Optional reading">
            <li className="wb-ch">
              <div className="wb-ch-top">
                <span className="wb-ch-title">Optional reading</span>
              </div>
              <ul className="wb-ch-cards">
                {mine.map((c) => (
                  <li key={c.id}>
                    <button type="button" className="quiet-link wb-card-link" onClick={() => setCardId(c.id)}>
                      {label(c)}
                    </button>
                  </li>
                ))}
              </ul>
            </li>
          </ul>
        )}
        <ul className="wb-chapters" aria-label={`${b.name} chapters`}>
          {b.map.map((ch) => {
            const key = `${b.id}|${ch.n}|${ch.title}`;
            const open = opened.has(key);
            return (
              <li key={key} className="wb-ch">
                <div className="wb-ch-top">
                  <button type="button" className="wb-ch-title wb-ch-toggle" aria-expanded={open} onClick={() => toggle(key)}>
                    {ch.title ? `${ch.n} · ${ch.title}` : b.chapters === 0 ? "All cards" : `${ch.n}`}
                  </button>
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
                      onClick={() => setCardId(d.card.id)}
                    />
                  ))}
                </div>
                {open && (
                  <ul className="wb-ch-cards" aria-label={`Chapter ${ch.n} cards`}>
                    {ch.cards.map((d) => (
                      <li key={d.card.id}>
                        <button type="button" className="quiet-link wb-card-link" onClick={() => setCardId(d.card.id)}>
                          {label(d.card)}
                          {d.done ? " ✓" : ""}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </JournalSheet>
  );
}
