// Read back's Highlights part (Esme, 2026-11-06: "view 'highlights' somewhere … in the read back
// section for now"): every highlight, grouped by workbook and chapter, newest first. Each shows
// its words, its note and its card; tapping it opens the card at the words. One whose words
// aren't in the card any more is never lost: it shows with its words and says so.
//
// PLACEMENT AND LOOK ARE PROVISIONAL (Design session): a fifth tile after the four, the same
// tile and part components; the entries' insides are placeholders (highlights.css).

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CANT_OPEN, listHighlights, readExerciseCards, type Highlight } from "../../data/repo";
import type { ISODate } from "../../domain/types";
import type { JournalKey } from "../../journal/crypto";
import type { CardSet } from "../../journal/exercise";
import { cardFieldTexts, locateAnchor } from "../../journal/highlights";
import { LoadLine, LOADING_LINE, longDate, useLoadGuard } from "./bits";
import { cardTitle } from "./ResponseView";
import { tabPath } from "./tabs";
import { useDbChanges } from "./useJournalKey";
import "./highlights.css";

/** The part's name, on its tile and over its list (provisional wording). */
export const HIGHLIGHTS = "Highlights";
/** On a highlight whose words aren't in its card any more (provisional wording). */
export const NOT_FOUND = "Couldn't find this in the card any more";
/** A book group for a card set without book titles (the workbook bars' own words). */
export const YOUR_CARDS = "Your cards";
/** A chapter group for cards without a chapter (provisional wording). */
export const NO_CHAPTER = "Other cards";
export const ALSO_NOTED = "Also noted";
const BACK = "← Read back";
const NOTHING_YET = "Nothing to read back yet.";
const TILE_EMPTY = "Nothing yet";

interface Loaded {
  highlights: Highlight[];
  set: CardSet | null;
  unreadable: number;
}

function useHighlights(jk: JournalKey) {
  const [data, setData] = useState<Loaded | null>(null);
  const latest = useRef(0);
  const failed = useRef<() => void>(() => undefined);
  const load = useCallback(async () => {
    const id = ++latest.current;
    try {
      const [list, cards] = await Promise.all([listHighlights(jk), readExerciseCards(jk)]);
      if (id === latest.current) setData({ ...list, set: cards.state === "ok" ? cards.set : null });
    } catch {
      if (id === latest.current) failed.current();
    }
  }, [jk]);
  useEffect(() => void load(), [load]);
  useDbChanges(() => void load());
  return { data, load, failed };
}

/** The Highlights tile's count and small line (as the other tiles: "Last: <day>"). */
export function useHighlightsTile(jk: JournalKey): { count: number; line: string } {
  const { data } = useHighlights(jk);
  if (!data) return { count: 0, line: LOADING_LINE };
  const first = data.highlights[0];
  return { count: data.highlights.length, line: first ? `Last: ${longDate(dayOf(first.createdAt))}` : TILE_EMPTY };
}

/** A time as the app's calendar day (local date, as `longDate` reads it). */
function dayOf(at: number): ISODate {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Entry = { h: Highlight; book: string; chapter: string; title: string; inSet: boolean; found: boolean };

/** Entries in runs by a key, each run in the order its first (newest) entry comes. */
function runsBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const out = new Map<string, T[]>();
  for (const it of items) out.set(key(it), [...(out.get(key(it)) ?? []), it]);
  return [...out.entries()];
}

/** The whole Highlights part: "← Read back", its name, then each workbook's chapters' highlights. */
export function HighlightsPart({ jk, focus }: { jk: JournalKey; focus: boolean }) {
  const { data, load, failed } = useHighlights(jk);
  const guard = useLoadGuard(data === null, load);
  failed.current = guard.fail;
  const id = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (focus && data) heading.current?.focus();
  }, [focus, data]);
  if (!data) return <LoadLine guard={guard} />;

  const titles = new Map((data.set?.tracks ?? []).map((t) => [t.id, t.title]));
  const entries: Entry[] = data.highlights.map((h) => {
    const card = data.set?.cards.find((c) => c.id === h.card.id) ?? null;
    const book = (card ? titles.get(card.track) : h.card.book) || YOUR_CARDS;
    const chapter = [h.card.chapter !== null ? `Chapter ${h.card.chapter}` : "", h.card.chapterTitle.trim()].filter(Boolean).join(" · ") || NO_CHAPTER;
    return {
      h, book, chapter, inSet: card !== null,
      title: cardTitle(h.card, card ? titles.get(card.track) : h.card.book || undefined, card !== null),
      found: card !== null && locateAnchor(h.anchor, cardFieldTexts(card)) !== null,
    };
  });
  const open = (h: Highlight) => navigate(tabPath("exercise"), { state: { highlight: { card: h.card.id, key: h.key } } });

  return (
    <section className="journal-readback journal-readback-part" aria-labelledby={id}>
      <Link to={tabPath("read-back")} className="quiet-link">
        {BACK}
      </Link>
      <h3 id={id} ref={heading} tabIndex={-1} className="journal-readback-title">
        {HIGHLIGHTS}
      </h3>
      {data.unreadable > 0 && <p className="journal-muted">{CANT_OPEN}</p>}
      {entries.length === 0 && <p>{NOTHING_YET}</p>}
      {runsBy(entries, (e) => e.book).map(([book, inBook]) => (
        <div key={book} className="journal-readback-month">
          <h4 className="journal-readback-month-name">{book}</h4>
          {runsBy(inBook, (e) => e.chapter).map(([chapter, inChapter]) => (
            <div key={chapter}>
              <h5 className="hl-group-name">{chapter}</h5>
              <ul className="journal-readback-list" aria-label={`${book} · ${chapter}`}>
                {inChapter.map((e) => (
                  <li key={e.h.key}>
                    {e.inSet ? (
                      <button type="button" className="hl-entry" onClick={() => open(e.h)}>
                        <EntryBody e={e} />
                      </button>
                    ) : (
                      <div className="hl-lost">
                        <EntryBody e={e} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

function EntryBody({ e }: { e: Entry }) {
  return (
    <>
      <span className="hl-quote">{e.h.anchor.exact}</span>
      {e.h.note.trim() !== "" && <span className="hl-note">{e.h.note}</span>}
      {e.h.others.map((o) => (
        <span key={o} className="hl-note">
          <span className="journal-muted">{`${ALSO_NOTED}: `}</span>
          {o}
        </span>
      ))}
      <span className="journal-muted">{e.title}</span>
      {!e.found && <span className="journal-muted hl-not-found">{NOT_FOUND}</span>}
    </>
  );
}
