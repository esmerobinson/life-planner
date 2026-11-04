import { useCallback, useLayoutEffect, useState, type RefObject } from "react";

/** Whether tabs of these natural widths, `gap` apart, fit in `room` without scrolling. */
export function tabsFit(widths: readonly number[], gap: number, room: number): boolean {
  const needed = widths.reduce((a, w) => a + w, 0) + gap * Math.max(0, widths.length - 1);
  return needed <= room;
}

const px = (v: string) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * One tab's natural width, whatever its layout now: its children's widths (the tick, the
 * label, the streak; not the screen-reader-only text), the gaps between them and its padding.
 * Measured the same way in a row and stacked, so the choice never flips back and forth.
 */
function naturalWidth(tab: HTMLElement): number {
  const style = getComputedStyle(tab);
  const kids = [...tab.children].filter((k) => getComputedStyle(k).position !== "absolute") as HTMLElement[];
  const inner = kids.reduce((a, k) => a + k.getBoundingClientRect().width, 0);
  return inner + px(style.columnGap) * Math.max(0, kids.length - 1) + px(style.paddingLeft) + px(style.paddingRight);
}

/**
 * The Journal's tabs never scroll sideways (journal v3): stacked on the phone, and on a wider
 * screen whenever their natural widths don't fit the row. Re-measured after every render (the
 * ticks and streaks arrive later) and whenever the row changes size.
 */
export function useTabsStacked(nav: RefObject<HTMLElement | null>, phone: boolean): boolean {
  const [stacked, setStacked] = useState(phone);
  const measure = useCallback(() => {
    const el = nav.current;
    if (!el) return;
    if (phone) return setStacked(true);
    const tabs = [...el.children].filter((c) => c instanceof HTMLElement && c.classList.contains("journal-tab")) as HTMLElement[];
    setStacked(!tabsFit(tabs.map(naturalWidth), px(getComputedStyle(el).columnGap), el.clientWidth));
  }, [nav, phone]);
  // After every render (the ticks and streaks arrive later): measured only.
  useLayoutEffect(measure);
  // One observer for the row's size (review M11: not made again on every render).
  useLayoutEffect(() => {
    const el = nav.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [nav, measure]);
  return stacked;
}
