// Esme's Farm: the companion nook. Domino is always there (the page's host takes the nook on
// host pages, once arrived); the earned moment plays here, one sticker at a time, and never
// while she is typing. Built from char-*, acc-*, stickers-diecut, fx-sparkle and ui-book-icon
// at the positions of the art pack's moment-earned-nook reference (80x40, shown at 2x).

import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { STICKER_BY_KEY } from "./catalogue";
import { useFarm } from "./FarmContext";
import { useHour, useTicker, useTyping } from "./hooks";
import { IDLE_FRAME_MS, MOMENT_FRAME_MS, reducedMotion } from "./motion";
import { ctx2d, drawCharacter, drawFrame, poseFrames, useSheets } from "./sprites";
import { CHARACTERS } from "./state";
import { ACCESSORIES, NAMES, nookHost, sleeping } from "./world";
import "./farm.css";

const W = 80;
const H = 40;
/** Whole-number scale only (the manifest: the nook at 2x). */
const SCALE = 2;
/** The moment's steps (moment-earned-nook's frames). */
export const MOMENT_STEPS = ["arrive", "present", "shine", "fly", "book-bump", "glint"] as const;
/** Where things sit in the 80x40 nook (from the reference composite). */
const CHAR_AT: [number, number] = [2, 7];
const BOOK_AT: [number, number] = [58, 20];
const STICKER_AT: Record<number, [number, number]> = { 1: [30, 8], 2: [30, 6], 3: [46, 4] };

const SHEETS = [
  ...CHARACTERS.map((c) => `char-${c}`), ...CHARACTERS.map((c) => `acc-${c}`), "ui-book-icon", "stickers-diecut", "fx-sparkle",
];

export function Nook({ phone = false }: { phone?: boolean }) {
  const farm = useFarm();
  const location = useLocation();
  const typing = useTyping();
  const hour = useHour();
  const sheets = useSheets(SHEETS);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [moment, setMoment] = useState<{ key: string; step: number } | null>(null);
  const played = useRef(new Set<string>());
  const tick = useTicker(IDLE_FRAME_MS);

  const arrived = farm?.arrived ?? new Set(["domino" as const]);
  const host = nookHost({ path: location.pathname, farmZones: farm?.farmZones }, arrived);
  const writingPages = typing && location.pathname.startsWith("/journal/morning");
  const asleep = !moment && sleeping(hour, writingPages);
  const next = farm?.queue.find((k) => !played.current.has(k));

  // Start the next earned moment: one at a time, never while a text field has focus.
  useEffect(() => {
    if (!farm || moment || !next || typing) return;
    played.current.add(next);
    if (reducedMotion()) {
      setMoment({ key: next, step: MOMENT_STEPS.length - 1 }); // the end frame
      return;
    }
    setMoment({ key: next, step: 0 });
  }, [farm, moment, next, typing]);

  // Step through it; at the end the sticker is in the book for good.
  useEffect(() => {
    if (!moment || !farm) return;
    const last = moment.step >= MOMENT_STEPS.length - 1;
    const t = setTimeout(() => {
      if (last) {
        void farm.markSeen(moment.key).finally(() => setMoment(null));
      } else setMoment({ ...moment, step: moment.step + 1 });
    }, MOMENT_FRAME_MS);
    return () => clearTimeout(t);
  }, [moment, farm]);

  const outfit = farm?.state.outfits.get(host) ?? null;
  const accFrame = outfit && farm?.unlocked.includes(outfit) ? ACCESSORIES.find((a) => a.code === outfit)?.frame ?? null : null;

  useEffect(() => {
    const ctx = ctx2d(canvas.current);
    if (!ctx || !sheets) return;
    ctx.clearRect(0, 0, W, H);
    const step = moment?.step ?? -1;
    let frame: number;
    if (step >= 1 && step <= 3) frame = poseFrames(host, "happy")[step - 1]!;
    else {
      const loop = poseFrames(host, asleep ? "sleep" : "idle");
      frame = loop[tick % loop.length]!;
    }
    drawCharacter(ctx, sheets, host, frame, CHAR_AT[0], CHAR_AT[1], accFrame);
    const glinting = step === 5 || (!moment && farm?.glint);
    drawFrame(ctx, sheets["ui-book-icon"]!, 16, 16, glinting ? 1 : 0, BOOK_AT[0], BOOK_AT[1] - (step === 4 ? 1 : 0));
    const at = STICKER_AT[step];
    const sticker = moment ? STICKER_BY_KEY.get(moment.key) : undefined;
    if (at && sticker) {
      drawFrame(ctx, sheets["stickers-diecut"]!, 18, 18, sticker.index, at[0], at[1]);
      if (step === 2) drawFrame(ctx, sheets["fx-sparkle"]!, 30, 30, 0, at[0] + 9 - 15, at[1] + 9 - 15);
    }
  }, [sheets, host, asleep, tick, moment, accFrame, farm?.glint]);

  const sticker = moment ? STICKER_BY_KEY.get(moment.key) : undefined;
  return (
    <div className={phone ? "farm-nook is-phone" : "farm-nook"} data-host={host} data-pose={moment ? "happy" : asleep ? "sleep" : "idle"}>
      <Link to="/farm" className="farm-nook-link" aria-label={`Esme's Farm (${NAMES[host]} is here)`}>
        <canvas ref={canvas} width={W} height={H} className="farm-px" style={{ width: W * SCALE, height: H * SCALE }} />
      </Link>
      <p className="visually-hidden farm-nook-news" aria-live="polite" data-moment={moment?.key ?? ""}>
        {sticker ? `New sticker: ${sticker.name}` : ""}
      </p>
    </div>
  );
}
