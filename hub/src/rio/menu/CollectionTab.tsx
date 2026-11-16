// Esme's Rio: the Collection tab (replaces the sticker book; Esme, 2026-11-17). Laid out as the
// kit's Collections screen (esme-ui src/screens_a_book.js bookHTML and tipHTML): a grid of slots,
// earned stickers in colour and the rest as silhouettes, a "!" bobbing over one ready to place,
// ×N on repeats, the caption with page arrows, and the card on a tap (or hover, or focus). One
// change from the kit's screen: its places sat in the top tabs, which here belong to the menu (as
// on the kit's own menu screen), so the places are the kit's side tabs (the phone: a row inside
// the panel, as the phone screen's set tabs) and an area's pages turn with the caption's arrows.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { COLLECTION, STICKER_BY_KEY, hintFor } from "../../farm/catalogue";
import type { FarmView } from "../../farm/FarmContext";
import { repeatCount } from "../../farm/world";
import { COLLECTION_AREAS, cellState, type CellState } from "../collection";
import { BitmapText } from "../ui/BitmapText";
import { useUi } from "../ui/fit";
import { INK } from "../ui/kit";
import type { TabProps } from "./GameMenu";
import { ArrowButton, KitIcon, StickerArt, TextButton, pos } from "./pieces";

const CARD_W = 96;

// PLACEHOLDER WORDING (the cells' names)
const SAYS: Record<CellState, string> = { placed: "placed in Rio", ready: "ready to place", ghost: "not yet" };

function firstArea(view: FarmView, startArea?: string | null): number {
  const start = COLLECTION_AREAS.findIndex((a) => a.key === startArea);
  if (start >= 0) return start;
  const ready = COLLECTION_AREAS.findIndex((a) => a.pages.some((p) => p.stickers.some((k) => cellState(k, view) === "ready")));
  return Math.max(0, ready);
}

export function CollectionTab({ view, stage, inner, narrow, canPlace, startArea, onArea }: TabProps & {
  canPlace: (key: string) => boolean;
  startArea?: string | null;
  onArea?: (area: string | null) => void;
}) {
  const [areaIdx, setAreaIdx] = useState(() => firstArea(view, startArea));
  const [pageIdx, setPageIdx] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const area = COLLECTION_AREAS[areaIdx]!;
  const page = area.pages[pageIdx] ?? area.pages[0]!;
  const sideRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    onArea?.(area.key);
  }, [area.key, onArea]);

  const chooseArea = (i: number) => {
    setAreaIdx(i);
    setPageIdx(0);
    setPicked(null);
  };
  const turn = (d: number) => {
    setPageIdx((p) => (p + d + area.pages.length) % area.pages.length);
    setPicked(null);
  };

  const onSideKey = (e: ReactKeyboardEvent, i: number) => {
    const n = COLLECTION_AREAS.length;
    const fwd = narrow ? "ArrowRight" : "ArrowDown";
    const back = narrow ? "ArrowLeft" : "ArrowUp";
    const to = e.key === fwd ? (i + 1) % n : e.key === back ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    sideRefs.current[to]?.focus();
  };

  // Cells, in the panel's inside: the kit's 20px slots, 10 across (the phone: 17 apart, no slot box).
  const pitch = narrow ? 17 : 20;
  const gx = narrow ? 5 : Math.floor((inner.w - 10 * 20) / 2);
  const gy = narrow ? 16 : 8;
  const cells = page.stickers.map((key, i) => ({ key, x: gx + (i % 10) * pitch, y: gy + Math.floor(i / 10) * pitch }));
  const earnedHere = page.stickers.filter((k) => view.earnedSet.has(k)).length;

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape" && picked) {
      e.stopPropagation();
      e.preventDefault();
      setPicked(null);
    }
  };

  // PLACEHOLDER WORDING (caption lines)
  const title = `${area.name} · ${page.title}`;
  const count = `${earnedHere} of ${page.stickers.length} stickers`;
  const total = `${view.collected} of ${COLLECTION.length} in all`;

  return (
    <div className="a fill" style={pos(0, 0, stage.w, stage.h)} onKeyDown={onKeyDown}>
      {/* The places: side tabs (the phone: a row of small tabs inside the panel). */}
      <div role="tablist" aria-label="Places in your collection" aria-orientation={narrow ? "horizontal" : "vertical"}>
        {COLLECTION_AREAS.map((a, i) => {
          const on = i === areaIdx;
          const style = narrow
            ? { ...pos(inner.x + 4 + i * 17, inner.y + (on ? 0 : -2), 16, 14), zIndex: 6 }
            : pos(inner.x - 21 + (on ? 3 : 0), inner.y + 4 + i * 20);
          return (
            <button key={a.key} ref={(el) => { sideRefs.current[i] = el; }} type="button" role="tab" aria-selected={on}
              tabIndex={on ? 0 : -1} aria-label={a.name} title={a.name} className={narrow ? `tab small${on ? " on" : ""}` : `stab${on ? " on" : ""}`}
              style={style} onClick={() => chooseArea(i)} onKeyDown={(e) => onSideKey(e, i)}>
              <KitIcon name={a.icon} x={narrow ? 2 : 3} y={narrow ? 1 : 2} w={12} h={12} />
            </button>
          );
        })}
      </div>

      <div className="pnl-inner" style={pos(inner.x, inner.y, inner.w, inner.h)} data-area={area.key} data-page={page.title}>
        <div role="group" aria-label={title}>
          {cells.map(({ key, x, y }) => {
            const st = STICKER_BY_KEY.get(key)!;
            const state = cellState(key, view);
            const times = repeatCount(key, view.counters);
            return (
              <Cell key={key} name={st.name} stickerKey={key} index={st.index} state={state} times={times} x={x} y={y} lg={!narrow}
                on={picked === key} onPick={() => setPicked(key)}>
                {picked === key && (
                  <Card view={view} stickerKey={key} state={state} times={times} placeable={canPlace(key)} narrow={narrow}
                    cell={{ x: inner.x + x, y: inner.y + y }} inner={inner} stage={stage} />
                )}
              </Cell>
            );
          })}
        </div>
        {narrow && <BitmapText text={total} colour={INK.brown} w={inner.w} align="center" style={{ position: "absolute", ...pos(0, inner.h - 44) }} />}
        <BitmapText text={title} heading w={inner.w} align="center" style={{ position: "absolute", ...pos(0, inner.h - 30) }} />
        <BitmapText text={narrow ? count : `${count} · ${total}`} colour={INK.brown} w={inner.w} align="center"
          style={{ position: "absolute", ...pos(0, inner.h - 14) }} />
        {area.pages.length > 1 && (
          <>
            <ArrowButton dir="left" label="Previous page" x={6} y={inner.h - 28} onClick={() => turn(-1)} />
            <ArrowButton dir="right" label="Next page" x={inner.w - 17} y={inner.h - 28} onClick={() => turn(1)} />
          </>
        )}
      </div>
    </div>
  );
}

function Cell({ name, stickerKey, index, state, times, x, y, lg, on, onPick, children }: {
  name: string; stickerKey: string; index: number; state: CellState; times: number; x: number; y: number; lg: boolean; on: boolean;
  onPick: () => void; children?: React.ReactNode;
}) {
  const { layout } = useUi();
  const o = lg ? 2 : 0;
  return (
    <>
      <button type="button" className={`cell${lg ? " lg" : ""}${on ? " on" : ""}`} data-sticker={stickerKey} data-state={state}
        aria-label={`${name}: ${SAYS[state]}`} aria-expanded={on} style={pos(x, y)}
        onClick={onPick} onFocus={onPick} onMouseEnter={layout === "wide" ? onPick : undefined}>
        <StickerArt index={index} ghost={state === "ghost"} x={o} y={o} />
        {times >= 2 && <BitmapText text={`×${times}`} colour={INK.cream} shadow={INK.ink} style={pos(9, 10)} />}
        {state === "ready" && <i className="bang" aria-hidden="true" style={pos(4, -13)} />}
      </button>
      {children}
    </>
  );
}

/** The sticker's card (tipHTML): beside the cell, or docked under the panel on the phone. */
function Card({ view, stickerKey, state, times, placeable, narrow, cell, inner, stage }: {
  view: FarmView; stickerKey: string; state: CellState; times: number; placeable: boolean; narrow: boolean;
  cell: { x: number; y: number }; inner: TabProps["inner"]; stage: TabProps["stage"];
}) {
  const { u } = useUi();
  const st = STICKER_BY_KEY.get(stickerKey)!;
  const el = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => setH((el.current?.offsetHeight ?? 0) / u), [u, state, stickerKey]);

  const at = useMemo(() => {
    if (narrow && stage.dock) return { x: stage.dock.x, y: stage.dock.y, w: stage.dock.w };
    let x = cell.x + 20;
    let y = cell.y + 14;
    if (x + CARD_W > stage.w - 4) x = cell.x - CARD_W - 6;
    if (y + h > stage.h - 4) y = Math.max(2, stage.h - 4 - h);
    return { x, y, w: CARD_W };
  }, [narrow, stage, cell, h]);

  const place = async () => {
    try {
      await view.place(stickerKey);
    } catch {
      // Not placed (kept ready): the card stays so she can try again (review M6).
    }
  };

  const textW = at.w - 14;
  return (
    <div ref={el} className={narrow ? "tip docked" : "tip"} role="dialog" aria-label={st.name}
      style={pos(at.x - inner.x, at.y - inner.y, at.w)} onClick={(e) => e.stopPropagation()}>
      <BitmapText text={st.name} colour={INK.dark} w={textW} />
      {!narrow && <BitmapText text={st.set} colour={INK.purple} w={textW} />}
      <i className="tipdiv" aria-hidden="true" />
      <BitmapText text={hintFor(st)} w={textW} />
      {/* PLACEHOLDER WORDING (the card's status lines) */}
      {state === "placed" && <BitmapText text="Placed in Rio" colour={INK.green} w={textW} />}
      {times >= 2 && <BitmapText text={`Earned ×${times}`} colour={INK.green} w={textW} />}
      {state === "ghost" && <BitmapText text="Not yet" colour={INK.brown} w={textW} />}
      {state === "ready" && placeable && (
        <div className="tip-row">
          <TextButton label="Place in Rio" onClick={() => void place()} />
          <BitmapText text="Ready!" colour={INK.green} />
        </div>
      )}
      {state === "ready" && !placeable && <BitmapText text="Its place in Rio opens later" colour={INK.brown} w={textW} />}
    </div>
  );
}
