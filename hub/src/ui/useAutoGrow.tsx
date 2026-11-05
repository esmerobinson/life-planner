import { forwardRef, useCallback, useLayoutEffect, useRef, type ForwardedRef, type RefObject, type TextareaHTMLAttributes } from "react";

/** How tall a box may grow before it scrolls inside: a share of the window (Esme: "bigger downwards"). */
export const AUTO_GROW_MAX = 0.7;
/** Room kept under the caret when the growing box is scrolled into view. */
const CARET_ROOM = 16;

/**
 * The height for a box whose content is `content` px tall (its scrollHeight) with `borders` px
 * of border, never past `max`; past it the box scrolls inside.
 */
export function growTo(content: number, borders: number, max: number): { height: number; scroll: boolean } {
  const want = content + borders;
  return want > max ? { height: max, scroll: true } : { height: want, scroll: false };
}

/**
 * Grows a textarea downwards to fit what is in it (journal v3, Esme 2026-11-04: "text boxes
 * should get bigger downwards … so I can see my entire answer"). Its starting height (rows and
 * CSS min-height) stays the minimum; at 70% of the window it stops and scrolls inside. The page
 * doesn't jump while it is measured, and when she types at the end the caret stays in view.
 * Only the height (and the inner scroll past the maximum) changes.
 */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: unknown): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const x = window.scrollX;
    const y = window.scrollY;
    el.style.height = "auto";
    const content = el.scrollHeight;
    if (content <= 0) {
      el.style.height = ""; // nothing laid out (hidden): leave it as it was
      return;
    }
    const { height, scroll } = growTo(content, el.offsetHeight - el.clientHeight, window.innerHeight * AUTO_GROW_MAX);
    el.style.height = `${height}px`;
    el.style.overflowY = scroll ? "auto" : "hidden";
    if (window.scrollY !== y) window.scrollTo(x, y);
    // Typing at the end of a growing box: keep its bottom (where the caret is) on screen.
    if (document.activeElement === el && el.selectionEnd === el.value.length) {
      const view = window.visualViewport?.height ?? window.innerHeight;
      const bottom = el.getBoundingClientRect().bottom;
      if (bottom > view) window.scrollBy(0, bottom - view + CARET_ROOM);
    }
  }, [ref, value]);
}

/** A textarea that grows with its text (useAutoGrow); every other prop is passed on. */
export const AutoGrowTextarea = forwardRef(function AutoGrowTextarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement>,
  outer: ForwardedRef<HTMLTextAreaElement>,
) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useAutoGrow(inner, props.value);
  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      inner.current = el;
      if (typeof outer === "function") outer(el);
      else if (outer) outer.current = el;
    },
    [outer],
  );
  return <textarea {...props} ref={setRef} />;
});
