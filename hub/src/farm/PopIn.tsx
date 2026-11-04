// Esme's Farm: the monthly pop-in (every sticker one by one, Esme's choice). A reusable piece:
// the monthly review will call it with the month's stickers. Each slot goes from the empty
// dashed slot to the filled slot with its sticker and an fx-sparkle burst, drawn frames only
// (no smooth scaling), then the next. Reduced motion shows them all at once.

import { useEffect, useRef, useState } from "react";
import { STICKER_BY_KEY } from "./catalogue";
import { POPIN_FRAME_MS, POPIN_STEP_MS, reducedMotion } from "./motion";
import { ctx2d, drawFrame, useSheets } from "./sprites";

const COLS = 5;
const PITCH = 20;
const PAD = 6;
const SLOT = 19;
/** Whole-number scale (the book's scale on the Mac). */
const SCALE = 2;
const SHEETS = ["book-slot", "stickers", "fx-sparkle"];

export function StickerPopIn({ stickers, onDone }: { stickers: readonly string[]; onDone?: () => void }) {
  const keys = stickers.filter((k) => STICKER_BY_KEY.has(k));
  const sheets = useSheets(SHEETS);
  const canvas = useRef<HTMLCanvasElement>(null);
  // How many are in, and the sparkle frame on the newest (3 frames, then the next one).
  const [step, setStep] = useState(() => (reducedMotion() ? { shown: keys.length, frame: 3 } : { shown: 0, frame: 3 }));

  useEffect(() => {
    if (step.shown >= keys.length && step.frame >= 3) {
      onDone?.();
      return;
    }
    const t = setTimeout(
      () => setStep((s) => (s.frame < 3 ? { ...s, frame: s.frame + 1 } : { shown: s.shown + 1, frame: 0 })),
      step.frame < 3 ? POPIN_FRAME_MS : POPIN_STEP_MS,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, keys.length]);

  const rows = Math.max(1, Math.ceil(keys.length / COLS));
  const w = PAD * 2 + (COLS - 1) * PITCH + SLOT;
  const h = PAD * 2 + (rows - 1) * PITCH + SLOT;

  useEffect(() => {
    const ctx = ctx2d(canvas.current);
    if (!ctx || !sheets) return;
    ctx.clearRect(0, 0, w, h);
    keys.forEach((k, i) => {
      const x = PAD + (i % COLS) * PITCH;
      const y = PAD + Math.floor(i / COLS) * PITCH;
      if (i < step.shown) {
        drawFrame(ctx, sheets["book-slot"]!, SLOT, SLOT, 1, x, y);
        drawFrame(ctx, sheets["stickers"]!, 16, 16, STICKER_BY_KEY.get(k)!.index, x + 1, y + 1);
        if (i === step.shown - 1 && step.frame < 3) drawFrame(ctx, sheets["fx-sparkle"]!, 30, 30, step.frame, x + 9 - 15, y + 9 - 15);
      } else drawFrame(ctx, sheets["book-slot"]!, SLOT, SLOT, 0, x, y);
    });
  }, [sheets, step, keys, w, h]);

  const shown = keys.slice(0, step.shown).map((k) => STICKER_BY_KEY.get(k)!.name);
  return (
    <div className="farm-popin" data-shown={step.shown} data-total={keys.length}>
      <canvas ref={canvas} width={w} height={h} className="farm-px" style={{ width: w * SCALE, height: h * SCALE }} role="img"
        aria-label={shown.length ? `Stickers: ${shown.join(", ")}` : "Stickers"} />
    </div>
  );
}
