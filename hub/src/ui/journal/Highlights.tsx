// Highlights on an exercise card (Esme, 2026-11-06: "like on Kindle"). Selecting words in a
// card's learning text (mouse, or the phone's own selection) shows a "Highlight" button; the
// words then stay marked wherever that card shows. Tapping a mark opens its note (optional,
// saved as she types) and Remove (which asks first). Read back lists them (HighlightsReadBack).
//
// LOOK: every visual here is a PLACEHOLDER (highlights.css): the magenta mark, the magenta
// button and where it sits, the note pop-up's insides. Not in VISUAL-LANGUAGE.md; Esme to choose.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  createHighlight, listHighlights, openNoteSession, removeHighlight, saveHighlightNote, type Highlight, type HighlightCard, type NoteSession,
} from "../../data/repo";
import type { ISODate } from "../../domain/types";
import type { JournalKey } from "../../journal/crypto";
import type { ExerciseCard } from "../../journal/exercise";
import {
  cardFieldTexts, describeAnchor, markRuns, MAX_HIGHLIGHT_NOTE, resolveCard, type HighlightField, type Located,
} from "../../journal/highlights";
import { AUTOSAVE_MS, useHiddenFlush } from "../useDraft";
import { JournalSheet } from "./JournalSheet";
import { useDbChanges } from "./useJournalKey";
import "./highlights.css";

/** The button over selected words (placeholder wording). */
export const HIGHLIGHT_ACTION = "Highlight";
/** The same button when the words are already inside a highlight: it opens that one (placeholder wording). */
export const OPEN_HIGHLIGHT = "Open highlight";
/** The note pop-up's title (placeholder wording). */
export const HIGHLIGHT_SHEET = "Highlight";
/** Tapping words where highlights overlap: choose which (placeholder wording). */
export const HIGHLIGHTS_HERE = "Highlights here";
export const NOTE_LABEL = "Note (optional)";
export const REMOVE_HIGHLIGHT = "Remove highlight";
export const REMOVE_QUESTION = "Remove this highlight?";
export const REMOVE_YES = "Remove";
export const REMOVE_NO = "Keep it";
/** Over another note on the same highlight written without seeing this one (another device's). */
export const OTHER_NOTE = "Also noted";
/** A mark's name for a screen reader (placeholder wording). */
export const markLabel = (words: string) => `Highlighted: ${words}. Open its note`;
const SAVE_PROBLEM = "That didn't save. Try again.";

/** The card a highlight keeps (so it reads back even after the card set changes). */
export const highlightCard = (c: ExerciseCard, book: string): HighlightCard => ({
  id: c.id, track: c.track, book, day: c.day, chapter: c.chapter, chapterTitle: c.chapterTitle, theme: c.theme,
});

/** One highlight where it is on its card now. */
type Placed = Located & { key: string; exact: string };

interface Ctx {
  /** The located marks on one card's field (newest highlight first). */
  marks: (cardId: string, field: HighlightField) => Placed[];
  /** Opens one highlight, or (several overlapping there) a choice of them. */
  open: (keys: string[]) => void;
}
const HighlightContext = createContext<Ctx | null>(null);

/** Of the highlights over some words, the innermost (shortest) first; then the newest. */
const innermostFirst = (marks: readonly Placed[]) =>
  marks.map((m, i) => ({ m, i })).sort((x, y) => x.m.end - x.m.start - (y.m.end - y.m.start) || x.i - y.i).map((x) => x.m);

/**
 * Highlights for the exercise tab: loads them (again on every change), marks them in every card
 * shown under it, offers "Highlight" for selected learning text, and opens a mark's note.
 * `focus`: a highlight to scroll to once its card is on screen (from Read back).
 */
export function HighlightsProvider({
  jk, today, deviceId, cards, books, focus, onFocused, children,
}: {
  jk: JournalKey;
  today: ISODate;
  deviceId: string;
  cards: readonly ExerciseCard[];
  books: ReadonlyMap<string, string>;
  focus?: string | null;
  onFocused?: () => void;
  children: ReactNode;
}) {
  const [list, setList] = useState<Highlight[] | null>(null);
  const [problem, setProblem] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [choosing, setChoosing] = useState<string[] | null>(null);
  const latest = useRef(0);
  const load = useCallback(async () => {
    const id = ++latest.current;
    try {
      const { highlights } = await listHighlights(jk);
      if (id === latest.current) setList(highlights);
    } catch {
      // The card still shows without its marks; Read back says what can't be opened.
    }
  }, [jk]);
  useEffect(() => void load(), [load]);
  useDbChanges(() => void load());

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  // Each highlight where it is in its card now (never guessed: one not found isn't marked).
  const located = useMemo(() => {
    const out = new Map<string, Placed[]>();
    for (const h of list ?? []) {
      const { card, at } = resolveCard(h.card, h.anchor, cards);
      if (!card || !at) continue;
      out.set(card.id, [...(out.get(card.id) ?? []), { ...at, key: h.key, exact: h.anchor.exact }]);
    }
    return out;
  }, [list, cards]);

  const ctx = useMemo<Ctx>(
    () => ({
      marks: (cardId, field) => (located.get(cardId) ?? []).filter((m) => m.field === field),
      open: (keys) => (keys.length === 1 ? setEditing(keys[0]!) : setChoosing(keys)),
    }),
    [located],
  );

  // The innermost highlight a selection lies wholly inside, if any: tapping its button opens it
  // instead of making a highlight inside it by accident (review I2).
  const inside = useCallback(
    (pick: Picked) =>
      innermostFirst((located.get(pick.cardId) ?? []).filter((m) => m.field === pick.anchor.field && m.start <= pick.anchor.start && m.end >= pick.anchor.end))[0]?.key ?? null,
    [located],
  );

  // From Read back: once the mark is on screen, open its fold (Read more) and bring it into view.
  // If the card is open but its words weren't found, there is nothing to wait for (review M13).
  useEffect(() => {
    if (!focus || list === null) return;
    const all = [...document.querySelectorAll<HTMLElement>(`mark[data-hl-keys~="${focus}"]`)];
    const el = all.find((m) => m.closest('[role="dialog"]')) ?? all[0];
    if (!el) {
      if (document.querySelector('[role="dialog"] [data-hl-card]')) onFocused?.();
      return;
    }
    for (let d = el.closest("details"); d; d = d.parentElement?.closest("details") ?? null) d.open = true;
    el.scrollIntoView?.({ block: "center" });
    onFocused?.();
  });

  const create = async (pick: Picked) => {
    const card = byId.get(pick.cardId);
    if (!card) return;
    try {
      await createHighlight(jk, today, deviceId, highlightCard(card, books.get(card.track) ?? ""), pick.anchor);
      setProblem("");
      await load();
    } catch {
      setProblem(SAVE_PROBLEM);
    }
  };

  const find = (key: string) => (list ?? []).find((h) => h.key === key);
  return (
    <HighlightContext.Provider value={ctx}>
      {children}
      {problem && <p role="alert">{problem}</p>}
      <SelectionAction cards={byId} inside={inside} onHighlight={(p) => void create(p)} onOpen={(key) => setEditing(key)} />
      {choosing && (
        <JournalSheet title={HIGHLIGHTS_HERE} onClose={() => setChoosing(null)} className="hl-sheet">
          <ul className="hl-choices" aria-label={HIGHLIGHTS_HERE}>
            {choosing.map((key) => (
              <li key={key}>
                <button
                  type="button"
                  className="hl-entry"
                  onClick={() => {
                    setChoosing(null);
                    setEditing(key);
                  }}
                >
                  <span className="hl-quote">{find(key)?.anchor.exact ?? ""}</span>
                </button>
              </li>
            ))}
          </ul>
        </JournalSheet>
      )}
      {editing && <HighlightNoteSheet key={editing} jk={jk} deviceId={deviceId} highlight={find(editing)} onClose={() => setEditing(null)} />}
    </HighlightContext.Provider>
  );
}

/**
 * Marks the element holding one part of a card's learning text (its `HlText`), so a selection
 * in it can be read as words of that part: `base` is where its text starts in the part's shown
 * text (a later Read more paragraph); `skip`, how many characters of a label come first in it
 * ("In your book: ").
 */
export const hlRoot = (card: ExerciseCard, field: HighlightField, base = 0, skip = 0) => ({
  "data-hl-field": field, "data-hl-card": card.id, "data-hl-base": base - skip,
});

/**
 * One part of a card's learning text, with its highlights marked: exactly what PromptText shows
 * (text, *emphasis* as emphasis) when nothing is highlighted. `raw`: shown as it is (no emphasis);
 * `base`: where it starts in its part's shown text. Its element carries `hlRoot`.
 */
export function HlText({
  card, field, text, base = 0, raw = false,
}: { card: ExerciseCard; field: HighlightField; text: string; base?: number; raw?: boolean }) {
  const ctx = useContext(HighlightContext);
  const marks = ctx ? ctx.marks(card.id, field) : [];
  const runs = markRuns(text, base, marks, !raw);
  const tabbed = new Set<string>();
  return (
    <>
      {runs.map((r) => {
        let node: ReactNode = r.em ? <em key={r.at}>{r.text}</em> : r.text;
        if (r.keys.length === 0 || !ctx) return node;
        // Every highlight keeps somewhere to tap (review I2): each run shows the innermost one over
        // it, and a tap where several overlap offers them all.
        const here = innermostFirst(marks.filter((m) => r.keys.includes(m.key)));
        const top = here[0]!;
        const keys = here.map((m) => m.key);
        // One tab stop per highlight, on its first piece (review M10).
        const first = !tabbed.has(top.key);
        tabbed.add(top.key);
        const open = () => ctx.open(keys);
        return (
          <mark
            key={r.at}
            className={keys.length > 1 ? "hl-mark hl-mark-overlap" : "hl-mark"}
            data-hl-key={top.key}
            data-hl-keys={keys.join(" ")}
            {...(first ? { role: "button", tabIndex: 0, "aria-label": markLabel(top.exact) } : {})}
            onClick={() => {
              // Selecting words inside a mark isn't a tap on it.
              if (!(document.getSelection()?.isCollapsed ?? true)) return;
              open();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                open();
              }
            }}
          >
            {node}
          </mark>
        );
      })}
    </>
  );
}

// ---- selecting words -------------------------------------------------------------------------

interface Picked {
  cardId: string;
  anchor: NonNullable<ReturnType<typeof describeAnchor>>;
}

/** Each text node in a part's element, with where it starts in the part's shown text. */
function textNodes(root: Element): { node: Text; at: number }[] {
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const out: { node: Text; at: number }[] = [];
  let at = Number((root as HTMLElement).dataset.hlBase ?? 0);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    out.push({ node: n as Text, at });
    at += (n as Text).data.length;
  }
  return out;
}

/** A selection's edge as an offset in its part's shown text (`root` is the part's element, hlRoot). */
export function edgeOffset(root: Element, node: Node, offset: number, edge: "start" | "end"): number {
  const texts = textNodes(root);
  const own = texts.find((t) => t.node === node);
  if (own) return own.at + offset;
  if (texts.length === 0) return 0;
  const point = document.createRange();
  point.setStart(node, offset);
  point.collapse(true);
  const end = (t: { node: Text; at: number }) => t.at + t.node.data.length;
  const next = texts.findIndex((t) => point.comparePoint(t.node, 0) >= 0);
  if (edge === "start") return next >= 0 ? texts[next]!.at : end(texts[texts.length - 1]!);
  const prev = next < 0 ? texts[texts.length - 1] : texts[next - 1];
  return prev ? end(prev) : texts[0]!.at;
}

/**
 * What a selection would highlight: within the first card part it touches (a selection running
 * on into the next part stops at the end of this one), as an anchor; null if it touches no
 * learning text or only spaces.
 */
export function pickedFrom(range: Range, cards: ReadonlyMap<string, ExerciseCard>): Picked | null {
  const roots = [...document.querySelectorAll("[data-hl-field]")].filter((r) => range.intersectsNode(r));
  const first = roots[0] as HTMLElement | undefined;
  if (!first) return null;
  const cardId = first.dataset.hlCard ?? "";
  const field = first.dataset.hlField as HighlightField;
  const card = cards.get(cardId);
  if (!card) return null;
  // Its other pieces (Read more's paragraphs), on the same card on screen.
  const same = roots.filter(
    (r) => (r as HTMLElement).dataset.hlCard === cardId && (r as HTMLElement).dataset.hlField === field && sameCardOnScreen(first, r),
  );
  const startRoot = same.find((r) => r.contains(range.startContainer));
  const endRoot = same.find((r) => r.contains(range.endContainer));
  const firstTexts = textNodes(first);
  const lastTexts = textNodes(same[same.length - 1]!);
  const lastEnd = lastTexts.length ? lastTexts[lastTexts.length - 1]!.at + lastTexts[lastTexts.length - 1]!.node.data.length : 0;
  const start = startRoot ? edgeOffset(startRoot, range.startContainer, range.startOffset, "start") : (firstTexts[0]?.at ?? 0);
  const end = endRoot ? edgeOffset(endRoot, range.endContainer, range.endOffset, "end") : lastEnd;
  const text = cardFieldTexts(card)[field];
  // A label before the part's words ("In your book: ") is never part of a highlight.
  const anchor = describeAnchor(field, text, Math.max(0, start), Math.min(text.length, Math.max(0, end)));
  return anchor && { cardId, anchor };
}

/** Two pieces of a card part belong to the same card on screen (not today's card and its copy in the chapter map). */
function sameCardOnScreen(a: Element, b: Element): boolean {
  const card = (el: Element) => el.closest("article, .exercise-card, [role='dialog']");
  return card(a) === card(b);
}

/**
 * The "Highlight" button, under the selected words while some learning text is selected. A tap
 * on it keeps the selection (a phone may clear it as the finger lands): what was selected then
 * is what is highlighted. Words already inside a highlight (a long-press on a mark selects a
 * word) get "Open highlight" instead, which opens that one (review I2).
 */
function SelectionAction({
  cards, inside, onHighlight, onOpen,
}: {
  cards: ReadonlyMap<string, ExerciseCard>;
  inside: (p: Picked) => string | null;
  onHighlight: (p: Picked) => void;
  onOpen: (key: string) => void;
}) {
  const [state, setState] = useState<{ pick: Picked; within: string | null; top: number; left: number } | null>(null);
  const pressing = useRef(false);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const insideRef = useRef(inside);
  insideRef.current = inside;
  useEffect(() => {
    const read = () => {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        if (!pressing.current) setState(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const pick = pickedFrom(range, cardsRef.current);
      if (!pick) return setState(null);
      // (A test browser without layout has no boxes: the button still shows.)
      const rects = typeof range.getClientRects === "function" ? range.getClientRects() : [];
      const box = rects.length ? rects[rects.length - 1]! : typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : { bottom: 0, left: 0 };
      // PLACEHOLDER placement: just under the end of the selection (a phone's own menu sits above it).
      setState({ pick, within: insideRef.current(pick), top: box.bottom + 8, left: Math.max(8, Math.min(box.left, window.innerWidth - 140)) });
    };
    document.addEventListener("selectionchange", read);
    window.addEventListener("scroll", read, true);
    window.addEventListener("resize", read);
    return () => {
      document.removeEventListener("selectionchange", read);
      window.removeEventListener("scroll", read, true);
      window.removeEventListener("resize", read);
    };
  }, []);
  if (!state) return null;
  const letGo = () => {
    pressing.current = false;
  };
  return createPortal(
    <button
      type="button"
      className="hl-action"
      style={{ top: state.top, left: state.left }}
      // Not prevented on a touch: WebKit then sends no click at all.
      onPointerDown={() => {
        pressing.current = true;
      }}
      onMouseDown={(e) => e.preventDefault() /* a mouse: keeps the selection (and the focus) where it is */}
      // A finger that slides off and lifts sends no click: the button goes with the selection (review M11).
      onPointerCancel={letGo}
      onPointerLeave={letGo}
      onClick={() => {
        letGo();
        const { pick, within } = state;
        setState(null);
        document.getSelection()?.removeAllRanges();
        if (within) onOpen(within);
        else onHighlight(pick);
      }}
    >
      {state.within ? OPEN_HIGHLIGHT : HIGHLIGHT_ACTION}
    </button>,
    document.body,
  );
}

// ---- a highlight's note and Remove -------------------------------------------------------------

/**
 * The note pop-up (the Journal's pop-up, JournalSheet): the highlighted words, the note box and
 * Remove, which asks first. The box saves as she types (after a pause), when it loses focus,
 * when the pop-up closes and when the app is put away; each save is a new version (NoteSession).
 * Review I3: the box keeps HER words. A note from another device that arrives while it is open
 * never replaces them; it shows above the box as "Also noted".
 */
export function HighlightNoteSheet({
  jk, deviceId, highlight, onClose,
}: { jk: JournalKey; deviceId: string; highlight: Highlight | undefined; onClose: () => void }) {
  // The highlight as it is now (kept if it goes elsewhere meanwhile), and as she opened it.
  const [h, setH] = useState(highlight);
  useEffect(() => {
    if (highlight) setH(highlight);
  }, [highlight]);
  const opened = useRef(highlight);
  const session = useRef<NoteSession | null>(highlight ? openNoteSession(highlight) : null);
  const [text, setText] = useState(highlight?.note ?? "");
  const latest = useRef(text);
  const saved = useRef(text);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gone = useRef(false);
  const [problem, setProblem] = useState("");
  const [asking, setAsking] = useState(false);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const note = latest.current;
    const before = saved.current;
    if (gone.current || !session.current || note === before) return;
    saved.current = note;
    saveHighlightNote(jk, deviceId, session.current, note).then(
      () => setProblem(""),
      () => {
        // Still unsaved: the next pause, blur or close tries again.
        if (saved.current === note) saved.current = before;
        setProblem(SAVE_PROBLEM);
      },
    );
  }, [jk, deviceId]);
  useEffect(() => () => flush(), [flush]);
  useHiddenFlush(flush);

  if (!h) return null;
  // Every other note on it now, but not her own words in the box nor the note she started from.
  const mine = new Set([text.trim(), (opened.current?.note ?? "").trim()]);
  const also = [h.note, ...h.others].filter((n, i, all) => n.trim() !== "" && !mine.has(n.trim()) && all.findIndex((x) => x.trim() === n.trim()) === i);

  async function remove() {
    if (!h) return;
    gone.current = true;
    if (timer.current) clearTimeout(timer.current);
    try {
      await removeHighlight(jk, deviceId, h, session.current ?? undefined);
      onClose();
    } catch {
      gone.current = false;
      setProblem(SAVE_PROBLEM);
    }
  }

  return (
    <JournalSheet title={HIGHLIGHT_SHEET} onClose={onClose} className="hl-sheet">
      <blockquote className="hl-quote">{h.anchor.exact}</blockquote>
      {also.length > 0 && (
        <div className="hl-others">
          {also.map((o) => (
            <div key={o}>
              <p className="journal-muted">{OTHER_NOTE}</p>
              <p className="hl-note">{o}</p>
            </div>
          ))}
        </div>
      )}
      <label className="hl-note-label">
        {NOTE_LABEL}
        <textarea
          className="hl-note-box"
          value={text}
          maxLength={MAX_HIGHLIGHT_NOTE}
          onChange={(e) => {
            latest.current = e.target.value;
            setText(e.target.value);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(flush, AUTOSAVE_MS);
          }}
          onBlur={flush}
        />
      </label>
      {asking ? (
        <div className="btn-group" role="group" aria-label={REMOVE_QUESTION}>
          <p>{REMOVE_QUESTION}</p>
          <button type="button" onClick={() => void remove()}>
            {REMOVE_YES}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setAsking(false)}>
            {REMOVE_NO}
          </button>
        </div>
      ) : (
        <div className="btn-group">
          <button type="button" className="btn-secondary" onClick={() => setAsking(true)}>
            {REMOVE_HIGHLIGHT}
          </button>
        </div>
      )}
      {problem && <p role="alert">{problem}</p>}
    </JournalSheet>
  );
}
