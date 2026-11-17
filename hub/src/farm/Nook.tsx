// Esme's Farm: the companion nook. Domino is always there (the page's host takes the nook on
// host pages, once arrived); the earned moment plays here, one sticker at a time, and never
// while she is typing. Built from char-*, acc-*, stickers-diecut and fx-sparkle at the positions
// of the art pack's moment-earned-nook reference (80x40, shown at 2x). The book is gone (Esme,
// 2026-11-17): in its place the UI kit's collection icon (icon-book, centred in the old 16x16
// spot), its glint the kit's sparkle; it opens the game menu's Collection.

import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { STICKER_BY_KEY } from "./catalogue";
import { useFarm } from "./FarmContext";
import { useHour, useTicker, useTyping } from "./hooks";
import { IDLE_FRAME_MS, MOMENT_FRAME_MS, reducedMotion } from "./motion";
import { ctx2d, drawCharacter, drawFrame, drawSticker, poseFrames, useSheets } from "./sprites";
import { useKitImages } from "../rio/ui/kit";
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
  ...CHARACTERS.map((c) => `char-${c}`), ...CHARACTERS.map((c) => `acc-${c}`), "stickers-diecut", "fx-sparkle",
];
const KIT_PIECES = ["icon-book", "fx-sparkle"];
/** The kit's collection icon (12x12) sits dead centre in the old book's 16x16 spot. */
const ICON_AT: [number, number] = [BOOK_AT[0] + 2, BOOK_AT[1] + 2];

export function Nook({ phone = false }: { phone?: boolean }) {
  const farm = useFarm();
  const location = useLocation();
  const typing = useTyping();
  const hour = useHour();
  const sheets = useSheets(SHEETS);
  const kit = useKitImages(KIT_PIECES);
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
        // A failed write leaves it unseen: it plays again later (review M6).
        void farm.markSeen(moment.key).catch(() => undefined).finally(() => setMoment(null));
      } else setMoment({ ...moment, step: moment.step + 1 });
    }, MOMENT_FRAME_MS);
    return () => clearTimeout(t);
  }, [moment, farm]);

  const outfit = farm?.state.outfits.get(host) ?? null;
  const accFrame = outfit && farm?.unlocked.includes(outfit) ? ACCESSORIES.find((a) => a.code === outfit)?.frame ?? null : null;

  useEffect(() => {
    const ctx = ctx2d(canvas.current);
    if (!ctx || !sheets || !kit) return;
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
    const bump = step === 4 ? 1 : 0;
    ctx.drawImage(kit["icon-book"]!, ICON_AT[0], ICON_AT[1] - bump);
    // The glint: the kit's sparkle (its first frame) at the icon's top-right corner.
    if (glinting) drawFrame(ctx, kit["fx-sparkle"]!, 7, 7, 0, ICON_AT[0] + 8, ICON_AT[1] - 4 - bump);
    const at = STICKER_AT[step];
    const sticker = moment ? STICKER_BY_KEY.get(moment.key) : undefined;
    if (at && sticker) {
      drawSticker(ctx, sheets, sticker, "diecut", at[0], at[1]);
      if (step === 2) drawFrame(ctx, sheets["fx-sparkle"]!, 30, 30, 0, at[0] + 9 - 15, at[1] + 9 - 15);
    }
  }, [sheets, kit, host, asleep, tick, moment, accFrame, farm?.glint]);

  const sticker = moment ? STICKER_BY_KEY.get(moment.key) : undefined;
  return (
    <div className={phone ? (typing ? "farm-nook is-phone is-typing" : "farm-nook is-phone") : "farm-nook"} data-host={host} data-pose={moment ? "happy" : asleep ? "sleep" : "idle"}>
      <div className="farm-nook-link">
        <span className="farm-nook-art" style={{ width: W * SCALE, height: H * SCALE }}>
          <Link to="/farm" className="farm-nook-main" aria-label={`Esme's Rio (${NAMES[host]} is here)`}>
            <canvas ref={canvas} width={W} height={H} className="farm-px" style={{ width: W * SCALE, height: H * SCALE }} />
          </Link>
          {/* PLACEHOLDER WORDING */}
          {/* Already in the game, it replaces the page rather than stacking another (so Back still leaves). */}
          <Link to="/farm?menu=collection" replace={location.pathname === "/farm" || location.pathname === "/farm/"}
            className="farm-nook-book" aria-label="Your sticker collection"
            style={{ left: BOOK_AT[0] * SCALE, top: BOOK_AT[1] * SCALE, width: 16 * SCALE, height: 16 * SCALE }} />
        </span>
      </div>
      <p className="visually-hidden farm-nook-news" aria-live="polite" data-moment={moment?.key ?? ""}>
        {sticker ? `New sticker: ${sticker.name}` : ""}
      </p>
    </div>
  );
}
