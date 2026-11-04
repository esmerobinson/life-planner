// Esme's Farm: the sticker book ("Esme's Farm", T2 cover). One canvas at a whole-number scale:
// the cover opens and pages turn by swapping the art pack's book-turn overlays (click, arrow
// keys, buttons). Each page's sets show their slots: collected, ready to place (the peel), or
// not yet earned (the ghost; tap it for a gentle hint). Counts use the pixel font.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { COLLECTION, STICKERS, STICKER_BY_KEY, asset, hintFor, stickersIn } from "./catalogue";
import type { FarmView } from "./FarmContext";
import { isTypingTarget, useTicker } from "./hooks";
import { PEEL_FRAME_MS, POP_FRAME_MS, TURN_FRAME_MS, reducedMotion } from "./motion";
import { ctx2d, drawBadge, drawFrame, drawSticker, drawText, recolour, textWidth, useSheets, type Sheets } from "./sprites";
import { SPREADS, repeatCount, type Spread } from "./world";

export const BOOK_W = 232;
export const BOOK_H = 152;
const PAGE_W = 116;
const COVER_X = 112;
const SLOT = 19;
/** The phone shows one page at a time through a window this wide (a page plus the spine). */
const PHONE_WINDOW = 120;

const CONTENTS = (asset("book-pages") as unknown as { contents_rows: { group: string; y: number; count_right_x: number }[] }).contents_rows;
const SHEETS = ["book-cover", "book-pages", "book-turn", "book-slot", "font-small", "stickers", "stickers-ghost", "fx-sparkle", "badge-count"];
const TURN = { open: [0, 1, 2], forward: [3, 4, 5], back: [6, 7, 8] };

/** What the canvas shows. */
type Show =
  | { kind: "closed" }
  | { kind: "spread"; i: number }
  | { kind: "turn"; overlay: number; left: number | null; right: number | null };

export type SlotState = "placed" | "ready" | "ghost";

export function slotState(key: string, view: Pick<FarmView, "earnedSet" | "state">): SlotState {
  if (view.state.placed.has(key)) return "placed";
  return view.earnedSet.has(key) ? "ready" : "ghost";
}

/** "MIND BED 4/7"-style counts: earned stickers of a set / of a group. */
const countIn = (keys: { key: string }[], earned: ReadonlySet<string>) => keys.filter((s) => earned.has(s.key)).length;

/** The contents page's total plate (manifest contents_total_plate): "{n} OF 175", centred, in its colour. */
const PLATE = (asset("book-pages") as unknown as {
  contents_total_plate: { text_centre_x: number; text_y: number; colour: string; format: string };
}).contents_total_plate;
const tinted = new WeakMap<object, HTMLCanvasElement>();
function plateFont(font: HTMLImageElement): HTMLImageElement {
  let t = tinted.get(font);
  if (!t) {
    t = recolour(font, () => PLATE.colour);
    tinted.set(font, t);
  }
  return t as unknown as HTMLImageElement;
}

function drawPages(ctx: CanvasRenderingContext2D, s: Sheets, spread: Spread | null, i: number, view: FarmView, peel: number, sparkle: { key: string; frame: number } | null) {
  const pages = s["book-pages"]!;
  drawFrame(ctx, pages, PAGE_W, BOOK_H, 2 * i, 0, 0);
  drawFrame(ctx, pages, PAGE_W, BOOK_H, 2 * i + 1, PAGE_W, 0);
  const font = s["font-small"]!;
  if (i === 0) {
    // The contents page: each group's count, right-aligned at the end of its row.
    for (const row of CONTENTS) {
      // The BONUS row: how many bonus stickers she has (count_format "{n}": not in the total).
      const bonus = STICKERS.filter((x) => x.bonus && x.group === row.group);
      const t = row.group === "bonus"
        ? String(countIn(bonus, view.earnedSet))
        : `${countIn(stickersIn(row.group), view.earnedSet)}/${stickersIn(row.group).length}`;
      drawText(ctx, font, t, PAGE_W + row.count_right_x - textWidth(t), row.y);
    }
    // The whole collection on its plate (bonus stickers and ×N counts never count).
    const total = PLATE.format.replace("{n}", String(view.collected)).replace(/\d+$/, String(COLLECTION.length));
    drawText(ctx, plateFont(font), total, PAGE_W + PLATE.text_centre_x - Math.floor(textWidth(total) / 2), PLATE.text_y);
    return;
  }
  spread!.pages.forEach((page, side) => {
    if (!page) return;
    const ox = side * PAGE_W;
    for (const label of page.labels) {
      const inSet = STICKERS.filter((x) => x.set === label.set && x.group === page.group);
      drawText(ctx, font, `${countIn(inSet, view.earnedSet)}/${inSet.length}`, ox + label.count_x, label.y);
    }
    for (const slot of page.slots) {
      const st = STICKER_BY_KEY.get(slot.sticker)!;
      const x = ox + slot.x;
      const state = slotState(slot.sticker, view);
      if (state === "ghost") {
        drawFrame(ctx, s["book-slot"]!, SLOT, SLOT, 0, x, slot.y);
        drawSticker(ctx, s, st, "ghost", x + 1, slot.y + 1);
      } else {
        drawFrame(ctx, s["book-slot"]!, SLOT, SLOT, 1, x, slot.y);
        drawSticker(ctx, s, st, "sticker", x + 1, slot.y + 1);
        drawBadge(ctx, s, repeatCount(slot.sticker, view.counters), x + 1, slot.y + 1); // always in the book
        if (state === "ready") drawFrame(ctx, s["book-slot"]!, SLOT, SLOT, 2 + peel, x, slot.y);
      }
      if (sparkle?.key === slot.sticker) drawFrame(ctx, s["fx-sparkle"]!, 30, 30, sparkle.frame, x + 9 - 15, slot.y + 9 - 15);
    }
  });
}
/** The largest whole-number scale (1–3) at which `w` fits `avail`. */
export const fitScale = (w: number, avail: number): number => Math.max(1, Math.min(3, Math.floor(avail / w)));

export interface BookProps {
  view: FarmView;
  phone: boolean;
  /** Spread to open (from a tap on the farm); null keeps the current one. */
  request: number | null;
  onRequestDone: () => void;
  /** The spread on show (null: closed) and, on the phone, which page. */
  onShow: (spread: number | null, half: 0 | 1) => void;
  onPlaced: (key: string) => void;
}

export function StickerBook({ view, phone, request, onRequestDone, onShow, onPlaced }: BookProps) {
  const sheets = useSheets(SHEETS);
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(BOOK_W * 3);
  const [show, setShow] = useState<Show>({ kind: "closed" });
  const [half, setHalf] = useState<0 | 1>(1);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [sparkle, setSparkle] = useState<{ key: string; frame: number } | null>(null);
  const peelTick = useTicker(PEEL_FRAME_MS, show.kind === "spread");
  const peel = peelTick % 2;

  const scale = phone ? fitScale(PHONE_WINDOW, avail) : fitScale(BOOK_W, avail);
  const settled = show.kind === "closed" ? null : show.kind === "spread" ? show.i : null;

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setAvail(el.parentElement?.clientWidth ?? el.clientWidth));
    ro.observe(el.parentElement ?? el);
    setAvail(el.parentElement?.clientWidth ?? el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (show.kind !== "turn") onShow(settled, half);
  }, [show, half, settled, onShow]);

  /** Plays overlay frames, then settles on `end`. */
  const play = useCallback((frames: { overlay: number; left: number | null; right: number | null }[], end: Show, endHalf: 0 | 1) => {
    setPicked(null);
    if (reducedMotion() || frames.length === 0) {
      setShow(end);
      setHalf(endHalf);
      return;
    }
    setBusy(true);
    let k = 0;
    const stepOn = () => {
      if (k < frames.length) {
        setShow({ kind: "turn", ...frames[k++]! });
        setTimeout(stepOn, TURN_FRAME_MS);
      } else {
        setShow(end);
        setHalf(endHalf);
        setBusy(false);
      }
    };
    stepOn();
  }, []);

  const turnTo = useCallback((target: number | null, targetHalf: 0 | 1 = 0) => {
    if (busy) return;
    const from = show.kind === "spread" ? show.i : null;
    if (from === target) {
      setHalf(targetHalf);
      return;
    }
    if (from === null && target !== null) {
      // Open the cover onto the contents, then on to the target page if it isn't the contents.
      const open = TURN.open.map((o) => ({ overlay: o, left: null, right: 1 }));
      const on = target === 0 ? [] : TURN.forward.map((o) => ({ overlay: o, left: 0, right: 2 * target + 1 }));
      play([...open, ...on], { kind: "spread", i: target }, targetHalf);
    } else if (from !== null && target === null) {
      const back = from === 0 ? [] : TURN.back.map((o) => ({ overlay: o, left: 0, right: 2 * from + 1 }));
      const close = [...TURN.open].reverse().map((o) => ({ overlay: o, left: null, right: 1 }));
      play([...back, ...close], { kind: "closed" }, 1);
    } else if (from !== null && target !== null) {
      const frames = target > from
        ? TURN.forward.map((o) => ({ overlay: o, left: 2 * from, right: 2 * target + 1 }))
        : TURN.back.map((o) => ({ overlay: o, left: 2 * target, right: 2 * from + 1 }));
      play(frames, { kind: "spread", i: target }, targetHalf);
    }
  }, [busy, show, play]);

  const next = useCallback(() => {
    if (show.kind === "closed") return turnTo(0, phone ? 1 : 0); // the contents page is on the right
    if (show.kind !== "spread") return;
    if (phone && half === 0) return setHalf(1);
    if (show.i < SPREADS.length - 1) turnTo(show.i + 1, 0);
  }, [show, phone, half, turnTo]);
  const prev = useCallback(() => {
    if (show.kind !== "spread") return;
    if (phone && half === 1 && show.i > 0) return setHalf(0);
    turnTo(show.i === 0 ? null : show.i - 1, 1);
  }, [show, phone, half, turnTo]);

  // A tap on the farm opens the book at that zone's page.
  useEffect(() => {
    if (request === null || busy) return;
    turnTo(request, 0);
    onRequestDone();
  }, [request, busy, turnTo, onRequestDone]);

  // Arrow keys turn the pages (never while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(document.activeElement) || e.altKey || e.metaKey || e.ctrlKey) return;
      if (e.key === "ArrowRight") { next(); e.preventDefault(); }
      if (e.key === "ArrowLeft") { prev(); e.preventDefault(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [next, prev]);

  // A sticker that goes into the book while its page is open settles with a sparkle (moment-into-book).
  const seenBefore = useRef<ReadonlySet<string>>(view.state.seen);
  useEffect(() => {
    const before = seenBefore.current;
    seenBefore.current = view.state.seen;
    if (show.kind !== "spread" || reducedMotion()) return;
    const onPage = SPREADS[show.i]!.pages.flatMap((p) => p?.slots.map((s) => s.sticker) ?? []);
    const fresh = onPage.find((k) => view.state.seen.has(k) && !before.has(k));
    if (!fresh) return;
    let f = 0;
    setSparkle({ key: fresh, frame: 0 });
    const t = setInterval(() => {
      f++;
      if (f >= 3) {
        clearInterval(t);
        setSparkle(null);
      } else setSparkle({ key: fresh, frame: f });
    }, POP_FRAME_MS);
    return () => clearInterval(t);
  }, [view.state.seen, show]);

  useEffect(() => {
    const ctx = ctx2d(canvas.current);
    if (!ctx || !sheets) return;
    ctx.clearRect(0, 0, BOOK_W, BOOK_H);
    if (show.kind === "closed") {
      drawFrame(ctx, sheets["book-cover"]!, 120, BOOK_H, 0, COVER_X, 0);
    } else if (show.kind === "spread") {
      drawPages(ctx, sheets, SPREADS[show.i]!, show.i, view, peel, sparkle);
    } else {
      if (show.left !== null) drawFrame(ctx, sheets["book-pages"]!, PAGE_W, BOOK_H, show.left, 0, 0);
      if (show.right !== null) drawFrame(ctx, sheets["book-pages"]!, PAGE_W, BOOK_H, show.right, PAGE_W, 0);
      drawFrame(ctx, sheets["book-turn"]!, BOOK_W, BOOK_H, show.overlay, 0, 0);
    }
  }, [sheets, show, view, peel, sparkle]);

  // The phone's window onto one page (or the cover).
  const offset = !phone ? 0 : show.kind === "closed" ? COVER_X : show.kind === "spread" ? half * (BOOK_W - PHONE_WINDOW) : 0;
  const windowW = (phone ? PHONE_WINDOW : BOOK_W) * scale;
  const spread = show.kind === "spread" ? SPREADS[show.i]! : null;
  const slots = spread
    ? spread.pages.flatMap((p, side) => (p ? p.slots.map((s) => ({ ...s, x: s.x + side * PAGE_W, side })) : []))
        .filter((s) => !phone || s.side === half)
    : [];
  const pickedSlot = slots.find((s) => s.sticker === picked);
  const where = show.kind === "closed" ? "Closed" : spread && spread.index > 0 ? spread.pages.map((p) => p?.group && pageName(p.group)).filter((x) => !!x).filter(uniq).join(" · ") : "Contents";

  const onCanvasClick = (e: React.MouseEvent) => {
    if (busy) return;
    setPicked(null);
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (show.kind === "closed" || e.clientX - r.left > r.width / 2) next();
    else prev();
  };

  return (
    <div className="farm-book" ref={wrap} data-show={show.kind} data-spread={settled ?? ""} data-half={half}>
      <div className="farm-book-window" style={{ width: windowW, height: BOOK_H * scale }}>
        <div className="farm-book-clip">
        <div className="farm-book-layer" style={{ transform: `translateX(${-offset * scale}px)`, width: BOOK_W * scale }}>
          <canvas
            ref={canvas}
            width={BOOK_W}
            height={BOOK_H}
            className="farm-px"
            style={{ width: BOOK_W * scale, height: BOOK_H * scale }}
            onClick={onCanvasClick}
            aria-label={show.kind === "closed" ? "Open the sticker book" : "Turn the page"}
            role="button"
          />
          {slots.map((s) => {
            const st = STICKER_BY_KEY.get(s.sticker)!;
            const state = slotState(s.sticker, view);
            return (
              <button
                key={s.sticker}
                type="button"
                className="farm-slot"
                data-sticker={s.sticker}
                data-state={state}
                style={{ left: s.x * scale, top: s.y * scale, width: SLOT * scale, height: SLOT * scale }}
                aria-label={`${st.name}: ${state === "placed" ? "on the farm" : state === "ready" ? "ready to place" : "not yet"}`}
                aria-expanded={picked === s.sticker}
                onClick={(e) => {
                  e.stopPropagation();
                  setPicked(picked === s.sticker ? null : s.sticker);
                }}
              />
            );
          })}
        </div>
        </div>
        {pickedSlot && (
          <SlotCard
            stickerKey={pickedSlot.sticker}
            state={slotState(pickedSlot.sticker, view)}
            left={Math.min(Math.max(0, (pickedSlot.x - offset) * scale - 40), windowW - 220)}
            top={(pickedSlot.y + SLOT) * scale + 4}
            onPlace={async () => {
              try {
                await view.place(pickedSlot.sticker);
              } catch {
                return; // not placed (kept ready); the card stays so she can try again (review M6)
              }
              setPicked(null);
              onPlaced(pickedSlot.sticker);
            }}
            onClose={() => setPicked(null)}
          />
        )}
      </div>
      <div className="farm-book-controls">
        <button type="button" className="btn-secondary" onClick={prev} disabled={show.kind === "closed"} aria-label="Previous page">‹</button>
        <span className="farm-book-where" aria-live="polite">{where}</span>
        <button type="button" className="btn-secondary" onClick={next} aria-label={show.kind === "closed" ? "Open the book" : "Next page"}
          disabled={show.kind === "spread" && show.i === SPREADS.length - 1 && (!phone || half === 1)}>›</button>
      </div>
    </div>
  );
}

const uniq = (v: unknown, i: number, a: unknown[]) => a.indexOf(v) === i;

const PAGE_NAMES: Record<string, string> = {
  beds: "Vegetable beds", meadow: "Meadow", barnyard: "Barnyard", orchard: "Orchard", glasshouse: "Glasshouse", pond: "Pond",
  aquarium: "Aquarium", farmhouse: "Farmhouse", museum: "Museum", lane: "Lane and gate",
};
export const pageName = (group: string): string => PAGE_NAMES[group] ?? group;

function SlotCard({ stickerKey, state, left, top, onPlace, onClose }: {
  stickerKey: string; state: SlotState; left: number; top: number; onPlace: () => void; onClose: () => void;
}) {
  const st = STICKER_BY_KEY.get(stickerKey)!;
  return (
    <div className="farm-pop" style={{ left, top }} role="dialog" aria-label={st.name}>
      <p className="farm-pop-title">{st.name}</p>
      {state === "ghost" && <p className="farm-pop-hint">{hintFor(st)}</p>}
      {state === "placed" && <p className="farm-pop-hint">On the farm</p>}
      {state === "ready" && (
        <button type="button" className="btn-secondary" onClick={onPlace}>
          Place on the farm
        </button>
      )}
      <button type="button" className="farm-pop-close" aria-label="Close" onClick={onClose}>×</button>
    </div>
  );
}
