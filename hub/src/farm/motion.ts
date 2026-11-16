// Esme's Farm: EVERY duration in one place.
//
// PLACEHOLDERS. Easing and timing are Esme's decisions (VISUAL-LANGUAGE.md: "Easing and timing:
// linear, with default durations, until Esme chooses"). Until she sets them, every animation is
// a plain frame swap (no easing, no tweening, no smooth scaling) at the art pack's frame
// duration: Aseprite's 100 ms default, which the manifest says is a placeholder, not a choice.
// Esme sets these.

/** One frame of any sprite animation (the manifest's placeholder). */
export const FRAME_MS = 100;

/** Character idle and sleep loops (char-*: idle 4 frames, sleep 4, Bap's sit 2). */
export const IDLE_FRAME_MS = FRAME_MS;
/** The happy pose (3 frames, plays once). */
export const HAPPY_FRAME_MS = FRAME_MS;
/** The sticker-earned moment in the nook: one frame per step (arrive, present, shine, fly, book-bump, glint). */
export const MOMENT_FRAME_MS = FRAME_MS;
/** The book: cover opening and page turns (book-turn overlays, 3 frames each). */
export const TURN_FRAME_MS = FRAME_MS;
/** The "ready to place" peel (2-frame loop on a slot). */
export const PEEL_FRAME_MS = FRAME_MS;
/** A placed sticker's pop on the farm, and a sticker settling into the book (fx-sparkle, 3 frames). */
export const POP_FRAME_MS = FRAME_MS;
/** The monthly pop-in: each sticker's arrival (fx-sparkle, 3 frames)… */
export const POPIN_FRAME_MS = FRAME_MS;
/** …and the wait before the next sticker pops in (one frame, as nothing longer is chosen). */
export const POPIN_STEP_MS = FRAME_MS;

/** prefers-reduced-motion: every animation shows its end frame instead. */
export function reducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
