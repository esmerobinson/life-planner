// A friend, looping a pose, wearing the accessory she chose (the whole 32x32 frame: faces are never
// cropped). Shown at a whole-number scale: `size` is its CSS size (64px, or 32em in the game's UI).

import { useEffect, useRef } from "react";
import type { FarmView } from "./FarmContext";
import { useTicker } from "./hooks";
import { HAPPY_FRAME_MS } from "./motion";
import { ctx2d, drawCharacter, poseFrames, useSheets } from "./sprites";
import { CHARACTERS, type CharacterId } from "./state";
import { ACCESSORIES } from "./world";

const CHAR_SHEETS = [...CHARACTERS.map((c) => `char-${c}`), ...CHARACTERS.map((c) => `acc-${c}`)];

export function CharacterPic({ view, c, pose = "idle", size = "64px", className }: {
  view: FarmView; c: CharacterId; pose?: "idle" | "happy"; size?: string; className?: string;
}) {
  const sheets = useSheets(CHAR_SHEETS);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tick = useTicker(HAPPY_FRAME_MS);
  const outfit = view.state.outfits.get(c) ?? null;
  const acc = outfit && view.unlocked.includes(outfit) ? ACCESSORIES.find((a) => a.code === outfit)?.frame ?? null : null;
  useEffect(() => {
    const ctx = ctx2d(canvas.current);
    if (!ctx || !sheets) return;
    ctx.clearRect(0, 0, 32, 32);
    const frames = poseFrames(c, pose);
    drawCharacter(ctx, sheets, c, frames[tick % frames.length]!, 0, 0, acc);
  }, [sheets, c, pose, tick, acc]);
  return (
    <canvas ref={canvas} width={32} height={32} className={className ? `farm-px ${className}` : "farm-px"}
      style={{ width: size, height: size }} aria-hidden="true" />
  );
}
