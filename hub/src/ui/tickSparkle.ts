import { reducedMotion } from "../farm/motion";

/*
 * The celebration when a to-do or habit is ticked done: Esme's pick, 2026-11-17, option C
 * "Pixel sparkles" (esmeworld-notes/design/celebration-2026-11-17, VISUAL-LANGUAGE.md). The
 * farm's own fx-sparkle sheet (3 frames of 30x30, drawn at 2x, pixelated; the sprite and its
 * size are in strips.css) flashes three times round the tick box. Stepped frames, no easing.
 * Reduced motion: one still frame. It is a layer over the page, fixed on the box, so it never
 * moves the list, never takes a click, and plays on even when the ticked strip leaves the list.
 */

/** One frame of the sparkle (said, 2026-11-17). */
export const SPARKLE_FRAME_MS = 100;
/** The three bursts round the box's centre, in px, and when each starts (said, 2026-11-17). */
export const SPARKLE_BURSTS = [
  { x: -6, y: -4, at: 0 },
  { x: 4, y: -26, at: 100 },
  { x: -18, y: -20, at: 200 },
] as const;
/** Frames 0, 1, 2 of the sheet, each shown once. */
const FRAMES = [0, 1, 2] as const;
/** The whole celebration: the last burst's start plus its three frames (0.5 s). */
export const SPARKLE_TOTAL_MS = SPARKLE_BURSTS[SPARKLE_BURSTS.length - 1].at + FRAMES.length * SPARKLE_FRAME_MS;
/** Calm (reduced motion): one still frame 0 for 0.3 s (said, 2026-11-17). */
export const SPARKLE_CALM_MS = 300;
/** A frame's width as drawn: 30 px at 2x. */
const FRAME_DRAWN_PX = 60;

/** Plays the sparkle on a tick box (or where one was: its rectangle). */
export function playTickSparkle(at: Element | DOMRect): void {
  if (typeof document === "undefined") return;
  const r = at instanceof Element ? at.getBoundingClientRect() : at;
  const layer = document.createElement("div");
  layer.className = "tick-sparkle";
  layer.dataset.testid = "tick-sparkle";
  layer.setAttribute("aria-hidden", "true");
  // Inline, so it holds even before the stylesheet: on the box's centre, over everything, no clicks.
  Object.assign(layer.style, {
    position: "fixed",
    left: `${r.left + r.width / 2}px`,
    top: `${r.top + r.height / 2}px`,
    width: "0",
    height: "0",
    pointerEvents: "none",
  });
  const calm = reducedMotion();
  layer.dataset.calm = String(calm);
  const plan = calm ? [SPARKLE_BURSTS[0]] : SPARKLE_BURSTS;
  for (const b of plan) {
    const px = document.createElement("i");
    px.className = "tick-sparkle-px";
    px.style.transform = `translate(${b.x}px, ${b.y}px)`;
    px.style.visibility = "hidden";
    layer.append(px);
    if (calm) {
      show(px, 0);
      setTimeout(() => px.remove(), SPARKLE_CALM_MS);
      continue;
    }
    FRAMES.forEach((f, k) => {
      if (b.at + k * SPARKLE_FRAME_MS === 0) show(px, f);
      else setTimeout(() => show(px, f), b.at + k * SPARKLE_FRAME_MS);
    });
    setTimeout(() => px.remove(), b.at + FRAMES.length * SPARKLE_FRAME_MS);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), calm ? SPARKLE_CALM_MS : SPARKLE_TOTAL_MS);
}

function show(px: HTMLElement, frame: number) {
  px.style.visibility = "visible";
  px.style.backgroundPosition = `${-FRAME_DRAWN_PX * frame}px 0px`;
}
