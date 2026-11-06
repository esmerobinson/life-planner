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
  createHighlight, listHighlights, removeHighlight, saveHighlightNote, type Highlight, type HighlightCard, type NoteSession,
} from "../../data/repo";
import type { ISODate } from "../../domain/types";
import type { JournalKey } from "../../journal/crypto";
import type { ExerciseCard } from "../../journal/exercise";
import {
  cardFieldTexts, describeAnchor, locateAnchor, markRuns, MAX_HIGHLIGHT_NOTE, type HighlightField, type Located,
} from "../../journal/highlights";
import { AUTOSAVE_MS, useDraft } from "../useDraft";
import { JournalSheet } from "./JournalSheet";
import { useDbChanges } from "./useJournalKey";
import "./highlights.css";

/** The button over selected words (placeholder wording). */
export const HIGHLIGHT_ACTION = "Highlight";
/** The note pop-up's title (placeholder wording). */
export const HIGHLIGHT_SHEET = "Highlight";
export const NOTE_LABEL = "Note (optional)";
export const REMOVE_HIGHLIGHT = "Remove highlight";
export const REMOVE_QUESTION = "Remove this highlight?";
export const REMOVE_YES = "Remove";
export const REMOVE_NO = "Keep it";
/** Over another note on the same highlight written without seeing this one (another device's). */
export const OTHER_NOTE = "Also noted";
const SAVE_PROBLEM = "That didn't save. Try again.";

/** The card a highlight keeps (so it reads back even after the card set changes). */
export const highlightCard = (c: ExerciseCard, book: string): HighlightCard => ({
  id: c.id, track: c.track, book, day: c.day, chapter: c.chapter, chapterTitle: c.chapterTitle, theme: c.theme,
});

interface Ctx {
  /** The located marks on one card's field. */
  marks: (cardId: string, field: HighlightField) => { start: number; end: number; key: string }[];
  open: (key: string) => void;
}
const HighlightContext = createContext<Ctx | null>(null);

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
  const [list, setList] = useState<Highlight[]>([]);
  const [problem, setProblem] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
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
    const out = new Map<string, (Located & { key: string })[]>();
    for (const h of list) {
      const card = byId.get(h.card.id);
      const at = card ? locateAnchor(h.anchor, cardFieldTexts(card)) : null;
      if (!at) continue;
      out.set(h.card.id, [...(out.get(h.card.id) ?? []), { ...at, key: h.key }]);
    }
    return out;
  }, [list, byId]);

  const ctx = useMemo<Ctx>(
    () => ({
      marks: (cardId, field) => (located.get(cardId) ?? []).filter((m) => m.field === field),
      open: (key) => setEditing(key),
    }),
    [located],
  );

  // From Read back: once the mark is on screen, open its fold (Read more) and bring it into view.
  useEffect(() => {
    if (!focus) return;
    const all = [...document.querySelectorAll<HTMLElement>(`mark[data-hl-key="${focus}"]`)];
    const el = all.find((m) => m.closest('[role="dialog"]')) ?? all[0];
    if (!el) return;
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

  const shown = editing ? list.find((h) => h.key === editing) : undefined;
  return (
    <HighlightContext.Provider value={ctx}>
      {children}
      {problem && <p role="alert">{problem}</p>}
      <SelectionAction cards={byId} onHighlight={(p) => void create(p)} />
      {editing && (
        <NoteSheet key={editing} jk={jk} deviceId={deviceId} highlight={shown} onClose={() => setEditing(null)} />
      )}
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
  return (
    <>
      {runs.map((r) => {
        let node: ReactNode = r.em ? <em key={r.at}>{r.text}</em> : r.text;
        const key = r.keys[r.keys.length - 1];
        if (key && ctx) {
          node = (
            <mark
              key={r.at}
              className="hl-mark"
              data-hl-key={key}
              role="button"
              tabIndex={0}
              onClick={() => {
                // Selecting words inside a mark isn't a tap on it.
                if (!(document.getSelection()?.isCollapsed ?? true)) return;
                ctx.open(key);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  ctx.open(key);
                }
              }}
            >
              {node}
            </mark>
          );
        }
        return node;
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
 * is what is highlighted.
 */
function SelectionAction({ cards, onHighlight }: { cards: ReadonlyMap<string, ExerciseCard>; onHighlight: (p: Picked) => void }) {
  const [state, setState] = useState<{ pick: Picked; top: number; left: number } | null>(null);
  const pressing = useRef(false);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
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
      setState({ pick, top: box.bottom + 8, left: Math.max(8, Math.min(box.left, window.innerWidth - 140)) });
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
      onPointerCancel={() => {
        pressing.current = false;
      }}
      onClick={() => {
        pressing.current = false;
        const pick = state.pick;
        setState(null);
        document.getSelection()?.removeAllRanges();
        onHighlight(pick);
      }}
    >
      {HIGHLIGHT_ACTION}
    </button>,
    document.body,
  );
}

// ---- a highlight's note and Remove -------------------------------------------------------------

/**
 * The note pop-up (the Journal's pop-up, JournalSheet): the highlighted words, any other note on
 * it, the note box (saved as she types, and when the pop-up closes), and Remove, which asks first.
 */
function NoteSheet({ jk, deviceId, highlight, onClose }: { jk: JournalKey; deviceId: string; highlight: Highlight | undefined; onClose: () => void }) {
  // The highlight as she opened it, kept if it changes or goes elsewhere meanwhile.
  const [h, setH] = useState(highlight);
  useEffect(() => {
    if (highlight) setH(highlight);
  }, [highlight]);
  const [problem, setProblem] = useState("");
  const [asking, setAsking] = useState(false);
  const session = useRef<NoteSession>(new Map());
  const gone = useRef(false);
  const current = useRef(h);
  current.current = h;
  const draft = useDraft(h?.note ?? "", async (note) => {
    const at = current.current;
    if (gone.current || !at) return;
    try {
      session.current = await saveHighlightNote(jk, deviceId, at, note, session.current);
      setProblem("");
    } catch (e) {
      setProblem(SAVE_PROBLEM);
      throw e;
    }
  }, AUTOSAVE_MS);
  if (!h) return null;

  async function remove() {
    if (!h) return;
    gone.current = true;
    try {
      await removeHighlight(jk, deviceId, h);
      onClose();
    } catch {
      gone.current = false;
      setProblem(SAVE_PROBLEM);
    }
  }

  return (
    <JournalSheet title={HIGHLIGHT_SHEET} onClose={onClose} className="hl-sheet">
      <blockquote className="hl-quote">{h.anchor.exact}</blockquote>
      {h.others.length > 0 && (
        <div className="hl-others">
          {h.others.map((o) => (
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
          value={draft.value}
          maxLength={MAX_HIGHLIGHT_NOTE}
          onChange={(e) => draft.set(e.target.value)}
          onBlur={draft.flush}
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
