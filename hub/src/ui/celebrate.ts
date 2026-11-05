/**
 * Celebrations (VISUAL-LANGUAGE.md "Celebrations (2026-11-05)", mockup
 * docs/design/celebrations.html, option C "mixed", speed "quick"): a star pop from the tick
 * box on every tick, confetti from the heading for a big moment. Ported from the mockup's
 * script; every number below is the mockup's.
 *
 * Drawn in a fixed layer on <body>, at screen coordinates taken when the box was clicked, so
 * the row may re-render or leave its list straight away. The layer never takes the pointer,
 * nothing waits for it, and each burst removes itself when its animations end. With "reduce
 * motion" on, or without the Web Animations API (jsdom), nothing is drawn.
 */

/** The "quick" speed, in ms. */
export const CELEBRATION_MS = 650;

const STAR_EASING = "cubic-bezier(.2,.8,.3,1)";
const CONFETTI_EASING = "cubic-bezier(.2,.7,.3,1)";

/** The NookPhone colours, in the mockup's order. */
export const CONFETTI_COLOURS = [
  "#e6aeaf", "#a3d5c2", "#ecca7d", "#9eb4e6", "#b693ec", "#e39876", "#e8dd6e", "#a6ced6", "#98c293",
];

const STAR_COUNT = 5;
const STAR_RADIUS = 30;
const CONFETTI_COUNT = 40;
const CONFETTI_SPREAD = 110;

const STAR_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2.5l2.7 6 6.5.6-4.9 4.3 1.5 6.4L12 16.5l-5.8 3.3 1.5-6.4L2.8 9.1l6.5-.6z" fill="#ecca7d" stroke="#3a412f" stroke-width="1.4" stroke-linejoin="round"/></svg>';

export type Point = { x: number; y: number };

/** The centre of an element on screen (viewport coordinates). */
export function centreOf(el: Element): Point {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * The centre of a heading's words rather than its whole (often full-width) box, as the
 * mockup bursts from the "All sorted" text itself. Falls back to the box.
 */
export function textCentreOf(el: Element): Point {
  try {
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
    if (r && r.width > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  } catch {
    // fall through to the element's box
  }
  return centreOf(el);
}

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Whether a celebration can be drawn here at all. */
export function canCelebrate(): boolean {
  return typeof document !== "undefined" && typeof document.body.animate === "function" && !reducedMotion();
}

/**
 * One burst's layer: a fixed, pointer-less sheet over the page. Each piece removes itself
 * when its animation ends (or is cancelled), and the layer goes with the last one.
 */
function burst(draw: (layer: HTMLElement, done: (piece: Element, a: Animation) => void) => void) {
  const layer = document.createElement("div");
  layer.className = "celebration-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.appendChild(layer);
  let left = 0;
  const done = (piece: Element, a: Animation) => {
    left++;
    a.onfinish = a.oncancel = () => {
      piece.remove();
      if (--left === 0) layer.remove();
    };
  };
  try {
    draw(layer, done);
  } catch {
    // A celebration must never break a tick: whatever was drawn still cleans itself up.
  }
  if (left === 0) layer.remove();
}

/** Every tick: 5 stars pop out from the tick box, evenly around it, 30px out. */
export function starPop(at: Point): void {
  if (!canCelebrate()) return;
  burst((layer, done) => {
    for (let i = 0; i < STAR_COUNT; i++) {
      const s = document.createElement("span");
      s.className = "celebration-star";
      s.innerHTML = STAR_SVG;
      s.style.left = at.x + "px";
      s.style.top = at.y + "px";
      layer.appendChild(s);
      const a = (i / STAR_COUNT) * Math.PI * 2 - Math.PI / 2 + (Math.random() - 0.5) * 0.4;
      const dx = Math.cos(a) * STAR_RADIUS, dy = Math.sin(a) * STAR_RADIUS;
      done(
        s,
        s.animate(
          [
            { transform: "translate(-50%,-50%) scale(.2)", opacity: 0 },
            { transform: `translate(calc(-50% + ${dx * 0.8}px), calc(-50% + ${dy * 0.8}px)) scale(1.1)`, opacity: 1, offset: 0.4 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(.9)`, opacity: 0 },
          ],
          { duration: CELEBRATION_MS, easing: STAR_EASING },
        ),
      );
    }
  });
}

/** A big moment: 40 confetti pieces burst from the heading up to 110px out, then fall and fade. */
export function confettiBurst(at: Point): void {
  if (!canCelebrate()) return;
  burst((layer, done) => {
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      const b = document.createElement("i");
      b.className = "celebration-bit";
      b.style.left = at.x + "px";
      b.style.top = at.y + "px";
      b.style.background = CONFETTI_COLOURS[i % CONFETTI_COLOURS.length];
      layer.appendChild(b);
      const a = Math.random() * Math.PI * 2;
      const r = CONFETTI_SPREAD * (0.5 + Math.random() * 0.6);
      const dx = Math.cos(a) * r, dy = Math.sin(a) * r * 0.7 - CONFETTI_SPREAD * 0.4;
      const rot = (Math.random() - 0.5) * 720;
      done(
        b,
        b.animate(
          [
            { transform: "translate(-50%,-50%) rotate(0)", opacity: 1 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.55 },
            { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + CONFETTI_SPREAD * 0.9}px)) rotate(${rot}deg)`, opacity: 0 },
          ],
          { duration: CELEBRATION_MS * (1 + Math.random() * 0.3), easing: CONFETTI_EASING },
        ),
      );
    }
  });
}
