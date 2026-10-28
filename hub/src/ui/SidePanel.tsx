import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { getItem, listGoals } from "../data/repo";
import type { Goal, ISODate, Item } from "../domain/types";
import { GoalPanel } from "./GoalPanel";
import { ItemPanel } from "./ItemPanel";
import { usePanel } from "./panelContext";
import { usePhone } from "./usePhone";

/** Default panel width (round-3 brief: 460px, at most 92vw). */
export const PANEL_DEFAULT_WIDTH = 460;
/** The narrowest a drag can make it (round-3 brief). */
export const PANEL_MIN_WIDTH = 360;
/** The widest, as a share of the window (round-3 brief: 90vw). */
export const PANEL_MAX_SHARE = 0.9;
/** Where this device remembers the width. */
export const PANEL_WIDTH_KEY = "esmeworld:panel-width";
/** Arrow-key resize step on the handle (a keyboard step, not a look). */
const KEY_STEP = 16;

/** Clamps a width to [360px, 90% of the window]. */
export function clampPanelWidth(w: number, windowWidth: number): number {
  const max = Math.max(PANEL_MIN_WIDTH, Math.floor(windowWidth * PANEL_MAX_SHARE));
  if (!Number.isFinite(w)) return PANEL_DEFAULT_WIDTH;
  return Math.min(max, Math.max(PANEL_MIN_WIDTH, Math.round(w)));
}

function readWidth(): number {
  try {
    const raw = window.localStorage.getItem(PANEL_WIDTH_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? clampPanelWidth(n, window.innerWidth) : PANEL_DEFAULT_WIDTH;
  } catch {
    return PANEL_DEFAULT_WIDTH;
  }
}

function storeWidth(w: number) {
  try {
    window.localStorage.setItem(PANEL_WIDTH_KEY, String(w));
  } catch {
    // Private mode or blocked storage: the width is just not remembered.
  }
}

/** Set by the open content while it has something Escape should undo first (Edit mode). */
export type EscapeHandler = { current: (() => boolean) | null };

/**
 * The side panel ("peek", round 3 option A): over the page on the right, the list still
 * visible and usable behind it. Opens from `?open=<id>` (an item or a live goal), Close or
 * Escape closes, opening another item swaps the content. Drag the left edge to widen it
 * (remembered on this device). On a phone it fills the screen with a round back arrow.
 */
export function SidePanel({
  items,
  goals,
  today,
  onChanged,
}: {
  items: Item[];
  goals: Goal[];
  today: ISODate;
  onChanged: () => Promise<void>;
}) {
  const panel = usePanel();
  const phone = usePhone();
  const [width, setWidth] = useState(readWidth);
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<Element | null>(null);
  const escape = useRef<(() => boolean) | null>(null);
  const openId = panel?.openId ?? null;
  const item = openId ? items.find((i) => i.id === openId) : undefined;
  const goal = openId && !item ? goals.find((g) => g.id === openId) : undefined;
  const shown = Boolean(item || goal);

  // Focus moves into the panel when it opens, and back to what opened it when it closes.
  useEffect(() => {
    if (!shown) return;
    opener.current = document.activeElement;
    ref.current?.focus();
    return () => {
      const back = opener.current as HTMLElement | null;
      if (back && back.isConnected && typeof back.focus === "function") back.focus();
    };
  }, [shown]);

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      // An open icon menu closes first (it hears the same key).
      if (document.querySelector(".pop-menu")) return;
      if (escape.current?.()) return;
      panel?.close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [shown, panel]);

  // `?open=` for something that is not (or no longer) there: drop it from the URL, once a
  // fresh read confirms it (the shell's lists can lag a moment behind a page's).
  const close = panel?.close;
  useEffect(() => {
    if (!openId || shown || !close) return;
    let live = true;
    Promise.all([getItem(openId), listGoals()]).then(
      ([it, gs]) => {
        const there = (it && (it.status === "open" || it.status === "done")) || gs.some((g) => g.id === openId);
        if (live && !there) close();
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [openId, shown, close]);

  if (!panel || !shown) return null;

  function onDrag(e: ReactPointerEvent<HTMLDivElement>) {
    const startX = e.clientX;
    const startW = width;
    const handle = e.currentTarget;
    handle.setPointerCapture?.(e.pointerId);
    let w = startW;
    const move = (ev: PointerEvent) => {
      w = clampPanelWidth(startW + (startX - ev.clientX), window.innerWidth);
      setWidth(w);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      storeWidth(w);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
    e.preventDefault();
  }

  function onHandleKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    const step = e.key === "ArrowLeft" ? KEY_STEP : e.key === "ArrowRight" ? -KEY_STEP : 0;
    if (!step) return;
    e.preventDefault();
    const w = clampPanelWidth(width + step, window.innerWidth);
    setWidth(w);
    storeWidth(w);
  }

  const label = item?.title || goal?.title || "";
  return (
    <aside
      ref={ref}
      tabIndex={-1}
      className={phone ? "peek is-full" : "peek"}
      aria-label={label}
      style={phone ? undefined : { width: `min(${width}px, 92vw)` }}
    >
      {!phone && (
        <div
          className="peek-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          aria-valuemin={PANEL_MIN_WIDTH}
          aria-valuemax={clampPanelWidth(Number.MAX_SAFE_INTEGER, window.innerWidth)}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={onDrag}
          onKeyDown={onHandleKey}
        />
      )}
      <div className="peek-scroll">
        {item && (
          <ItemPanel key={item.id} item={item} goals={goals} today={today} phone={phone} onChanged={onChanged} escape={escape} />
        )}
        {goal && (
          <GoalPanel key={goal.id} goal={goal} items={items} today={today} phone={phone} onChanged={onChanged} escape={escape} />
        )}
      </div>
    </aside>
  );
}
