// Esme's Rio: one area, outside first, with its insides a button away. The scene's base is drawn
// for its state (it fills in as stickers are placed there) and the look (Rio's weather and
// clock); placed stickers stand on their slots (foot point = bottom-centre), back to front by
// foot y; in the rain the pack's falling rain plays over everything (not with reduced motion).

import { useEffect, useMemo, useRef, useState } from "react";
import { STICKER_BY_KEY } from "../farm/catalogue";
import { useReducedMotion, useTicker } from "../farm/hooks";
import { ctx2d, drawFrame, drawSticker, useSheets } from "../farm/sprites";
import { AREA_SCENES, sceneOpen } from "./areas";
import { BOTECO_NIGHTS, SCENES, sceneBase, type BotecoNight, type Look, type SceneId } from "./assets";
import { useCover, useRioImages } from "./canvas";
import { sceneKeep } from "./mapMath";
import { TextButton } from "./menu/pieces";
import { layout } from "./placement";
import { NO_COUNTS, scenePlan, type RioCounts } from "./progress";
import { drawTinted, tintFor } from "./tint";
import { BitmapText } from "./ui/BitmapText";
import { useUi } from "./ui/fit";

// PLACEHOLDER WORDING (every scene name)
export const SCENE_NAMES: Record<SceneId, string> = {
  "lagoa-house/outside": "Lagoa house",
  "lagoa-house/living": "Living room",
  "lagoa-house/bedroom": "Bedroom",
  "lagoa-house/kitchen": "Kitchen",
  "fazenda/outside": "Fazenda",
  "ipanema-beach/outside": "Ipanema beach",
  "barraca/inside": "Under the tent",
  "ipanema-beach/sea": "The sea off Arpoador",
  "clothing-store/outside": "Clothing store",
  "clothing-store/inside": "Inside the store",
  "tijuca-park/outside": "Tijuca park",
  "tijuca-park/inside": "The hidden glade",
  "boteco/outside": "Boteco",
  "boteco/inside": "Inside the boteco",
  "zona-sul/outside": "Zona Sul",
  "zona-sul/inside": "The aisles",
  "jardim-botanico/outside": "Jardim Botânico",
  "jardim-botanico/inside": "The orchid house",
  "quilo/outside": "Quilo",
  "quilo/inside": "The buffet",
  "sult/outside": "Sult",
  "sult/inside": "The dining room",
  "os-esquilos/outside": "Os Esquilos",
  "os-esquilos/inside": "The dining room",
  "santa-teresa/outside": "Santa Teresa",
  "santa-teresa/inside": "The studio",
  "museum/outside": "Museum",
  "museum/inside": "The rotunda hall",
  "flamengo-match/outside": "Flamengo match",
  "flamengo-match/inside": "The stands",
};

const STICKER = 16;
const STICKER_SHEETS = ["stickers"];

/** A tick for the themed nights' strips (each strip keeps its own speed from the elapsed time). */
const NIGHT_TICK_MS = 40;

export function AreaView({ area, look, day, placed, counts = NO_COUNTS, night = null, goal = false, onBack }: {
  area: string;
  look: Look;
  /** The farm day: an inside that opens later (the sea, day 30) has no button before then. */
  day: number;
  /** Every placed sticker (book order); the scene picks its own. */
  placed: readonly string[];
  /** Her counters the new areas grow from (progress.ts). */
  counts?: RioCounts;
  /** A boteco themed night (dev preview only until bundles trigger them, phase 2b). */
  night?: BotecoNight | null;
  /** Play the match's goal moment (dev preview until weekly reviews trigger it). */
  goal?: boolean;
  onBack: () => void;
}) {
  const scenes = AREA_SCENES[area]!;
  const insides = scenes.inside.filter((s) => sceneOpen(s, day));
  const [scene, setScene] = useState<SceneId>(scenes.outside);
  const data = SCENES[scene];
  const reduced = useReducedMotion();

  const plan = useMemo(() => scenePlan(scene, placed, counts), [scene, placed, counts]);
  const state = plan.state;
  const { bySlot, overflow } = useMemo(() => layout(scene, placed, plan.milestones), [scene, placed, plan.milestones]);
  const base = sceneBase(scene, state, look);
  const shownLook: Look = base === data.base[state]?.[look] ? look : "day";
  const inLook = (files: Partial<Record<Look, string>>) => files[shownLook] ?? files.day ?? "";

  // Layers over the base, in the pack's draw order: Os Esquilos' celebrations; Santa Teresa's
  // milestones, then its spines and covers.
  const celebrationFiles = (data.celebrations ?? []).slice(0, plan.celebrations).map((c) => inLook(c.layers));
  const milestoneFiles = (data.milestones ?? []).filter((m) => plan.milestones.includes(m.id)).map((m) => inLook(m.overlay));
  const spineSheet = data.books && plan.books > 0 ? inLook(data.books.spines.sheets) : "";
  const coverSheet = data.books && plan.covers > 0 ? inLook(data.books.covers.sheets) : "";
  // A themed night dresses the boteco at night only.
  const nightSide = night && area === "boteco" && shownLook === "night"
    ? BOTECO_NIGHTS[night][scene === "boteco/inside" ? "inside" : "outside"]
    : null;
  const nightFiles = nightSide ? [nightSide.overlay, ...nightSide.anims.map((a) => a.strip)] : [];

  const rain = shownLook === "rain" ? data.rainOverlay : undefined;
  const rainFrames = rain?.frames ?? (rain?.strip ? [rain.strip.file] : []);
  const rainCount = rain?.frames?.length ?? rain?.strip?.count ?? 0;
  const tvFrames = nightSide && !nightSide.baseTv ? [] : data.tv?.frames[shownLook] ?? [];
  const rainTick = useTicker(rain?.ms ?? 1000, !!rain && rainCount > 0 && !reduced);
  const tvTick = useTicker(data.tv?.ms ?? 1000, tvFrames.length > 0 && !reduced);
  // The sea's caustics: the strip for this state and look, over the base and under the stickers.
  const underlay = data.underlay;
  const underlayStrip = underlay ? underlay.strips[state]?.[shownLook] ?? underlay.strips[state]?.day ?? "" : "";
  const underlayTick = useTicker(underlay?.ms ?? 1000, !!underlayStrip && !reduced);
  // Esme herself where the scene draws her (the sea: snorkelling by the board).
  const player = data.player;
  const playerStrip = player ? player.files[shownLook] ?? player.files.day ?? "" : "";
  const playerTick = useTicker(player?.ms ?? 1000, !!playerStrip && !reduced);
  const nightTick = useTicker(NIGHT_TICK_MS, !!nightSide && !reduced);

  // The museum: its open doors by day, the case glass over its finds, and finds in the look's colours.
  const stampList = data.stamps?.[shownLook] ?? [];
  const tintPair = data.tint && shownLook !== "day" ? { day: data.base[state]?.day ?? "", look: base } : null;
  // The goal moment: whole frames over the full base (frame 0 is the base itself).
  const goalFrames = goal && state === "full" && data.goal ? data.goal.frames[shownLook] ?? data.goal.frames.day ?? [] : [];
  const goalTick = useTicker(data.goal?.ms ?? 1000, goalFrames.length > 0 && !reduced);
  const layerFiles = [...goalFrames, playerStrip, ...stampList.map((st) => st.file), data.glass?.file ?? "", tintPair?.day ?? "", underlayStrip, ...celebrationFiles, ...milestoneFiles, spineSheet, coverSheet, ...nightFiles].filter(Boolean);
  const files = useMemo(() => [base, ...layerFiles, ...rainFrames, ...tvFrames], [base, layerFiles.join(), rainFrames.join(), tvFrames.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const images = useRioImages(files);
  const sheets = useSheets(STICKER_SHEETS);

  const wrap = useRef<HTMLDivElement>(null);
  const { u, layout: uiLayout } = useUi();
  // The buttons sit on top of the game; the scene covers the view, never trimming a sticker slot.
  const keep = useMemo(() => sceneKeep(data.slots, data.scene), [data]);
  const fit = useCover(wrap, data.scene, keep, uiLayout === "wide");
  const scale = fit.scale;
  const canvas = useRef<HTMLCanvasElement>(null);

  const drawn = useMemo(() => {
    const at = new Map(data.slots.map((s) => [s.id, s]));
    return [...bySlot]
      .map(([slot, key]) => ({ slot: at.get(slot)!, key }))
      .sort((a, b) => a.slot.y - b.slot.y || a.slot.x - b.slot.x);
  }, [bySlot, data]);

  useEffect(() => {
    const ctx = ctx2d(canvas.current);
    if (!ctx || !images) return;
    const [w, h] = data.scene;
    ctx.clearRect(0, 0, w, h);
    const b = images[goalFrames.length > 0 && !reduced ? goalFrames[goalTick % goalFrames.length]! : base] ?? images[base];
    if (b) ctx.drawImage(b, 0, 0);
    const put = (f: string, x = 0, y = 0) => {
      const i = images[f];
      if (i) ctx.drawImage(i, x, y);
    };
    for (const st of stampList) put(st.file, st.at[0], st.at[1]);
    const dayImg = tintPair ? images[tintPair.day] : undefined;
    const lookImg = tintPair ? images[tintPair.look] : undefined;
    const tint = tintPair && dayImg && lookImg ? tintFor(`${tintPair.day}|${tintPair.look}`, dayImg, lookImg) : null;
    if (underlay && underlayStrip) {
      const img = images[underlayStrip];
      if (img) drawFrame(ctx, img, underlay.size[0], underlay.size[1], reduced ? 0 : underlayTick % underlay.count, 0, 0);
    }
    for (const f of celebrationFiles) put(f);
    for (const f of milestoneFiles) put(f);
    // Book n draws spine n at shelf slot n (one that needs a milestone only once it's earned); every fifth hangs a cover.
    if (data.books) {
      const copy = (sheet: string, slots: NonNullable<typeof data.books>["spines"]["slots"], n: number) => {
        const img = images[sheet];
        if (!img) return;
        for (const sl of slots.slice(0, n)) {
          if (sl.requires && !plan.milestones.includes(sl.requires)) continue;
          ctx.drawImage(img, sl.sx, sl.sy, sl.w, sl.h, sl.x, sl.y, sl.w, sl.h);
        }
      };
      if (spineSheet) copy(spineSheet, data.books.spines.slots, plan.books);
      if (coverSheet) copy(coverSheet, data.books.covers.slots, plan.covers);
    }
    if (sheets) {
      for (const { slot, key } of drawn) {
        const st = STICKER_BY_KEY.get(key);
        if (!st) continue;
        const left = slot.x - STICKER / 2;
        const top = slot.anchor === "top" ? slot.y : slot.y - STICKER + 1;
        if (tint) drawTinted(ctx, tint, { x: left, y: top, w: STICKER, h: STICKER }, (c, x, y) => drawSticker(c, sheets, st, "sticker", x, y));
        else drawSticker(ctx, sheets, st, "sticker", left, top);
      }
    }
    // The museum's case glass over its finds (in the look's colours too).
    const glass = data.glass ? images[data.glass.file] : undefined;
    if (data.glass && glass) {
      for (const [gx, gy] of data.glass.at) {
        if (tint) drawTinted(ctx, tint, { x: gx, y: gy, w: glass.width, h: glass.height }, (c, x, y) => c.drawImage(glass, x, y));
        else ctx.drawImage(glass, gx, gy);
      }
    }
    if (player && playerStrip) {
      const img = images[playerStrip];
      if (img) drawFrame(ctx, img, player.size[0], player.size[1], reduced ? 0 : playerTick % player.count, player.at[0] - player.offset[0], player.at[1] - player.offset[1]);
    }
    // The bar TV (the base already shows its first frame, so with reduced motion nothing is drawn).
    if (data.tv && tvFrames.length > 0 && !reduced) {
      const f = images[tvFrames[tvTick % tvFrames.length]!];
      if (f) ctx.drawImage(f, data.tv.at[0], data.tv.at[1]);
    }
    // A themed night: its overlay (frame 0 of every strip), then the strips playing.
    if (nightSide) {
      put(nightSide.overlay);
      if (!reduced) {
        const elapsed = nightTick * NIGHT_TICK_MS;
        for (const a of nightSide.anims) {
          const img = images[a.strip];
          if (!img) continue;
          const step = Math.floor(elapsed / a.ms);
          if (a.once && step >= a.frames - 1) continue; // its last frame is the overlay's own state
          drawFrame(ctx, img, a.size[0], a.size[1], a.once ? step : step % a.frames, a.at[0], a.at[1]);
        }
      }
    }
    // The falling rain, over everything (stickers too).
    if (rain && rainCount > 0 && !reduced) {
      const i = rainTick % rainCount;
      if (rain.strip) {
        const img = images[rain.strip.file];
        if (img) drawFrame(ctx, img, rain.strip.size[0], rain.strip.size[1], i, 0, 0);
      } else {
        const img = images[rain.frames![i]!];
        if (img) ctx.drawImage(img, 0, 0);
      }
    }
  }, [images, sheets, base, drawn, data, rain, rainCount, rainTick, tvFrames, tvTick, reduced, layerFiles.join(), plan, nightSide, nightTick, underlayTick, playerTick, goalTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const inside = scene !== scenes.outside;
  return (
    <div className="rio-area" ref={wrap} data-scene={scene} data-state={state} data-look={shownLook} data-fit={fit.mode}
      data-celebrations={plan.celebrations} data-milestones={plan.milestones.join(" ")} data-books={plan.books}
      data-night={nightSide ? night! : undefined} data-player={playerStrip ? "esme" : undefined}
      data-goal={goalFrames.length > 0 ? "true" : undefined}>
      <h2 className="visually-hidden">{SCENE_NAMES[scene]}</h2>
      {/* On top of the game, in the kit's word buttons. */}
      <div className="rio-area-controls" style={{ fontSize: `${u}px` }}>
        {/* PLACEHOLDER WORDING */}
        <TextButton label="Back to the map" onClick={onBack} />
        {/* PLACEHOLDER WORDING */}
        {inside && <TextButton label="Outside" onClick={() => setScene(scenes.outside)} />}
        {!inside && insides.length > 0 && (
          // PLACEHOLDER WORDING
          <div role="group" aria-label="Go inside">
            {insides.map((s) => <TextButton key={s} label={SCENE_NAMES[s]} onClick={() => setScene(s)} />)}
          </div>
        )}
      </div>
      <div className="rio-area-layer" style={{ left: fit.x, top: fit.y, width: data.scene[0] * scale, height: data.scene[1] * scale }}>
        <canvas ref={canvas} width={data.scene[0]} height={data.scene[1]} className="farm-px"
          style={{ width: data.scene[0] * scale, height: data.scene[1] * scale }} aria-hidden="true" />
      </div>
      {/* PLACEHOLDER WORDING */}
      {overflow > 0 && (
        <div className="rio-area-note" style={{ fontSize: `${u}px` }}>
          <div className="thin flow"><BitmapText text={`${overflow} more in your collection`} /></div>
        </div>
      )}
      {/* PLACEHOLDER WORDING (book order) */}
      <ul className="visually-hidden" aria-label="Stickers here">
        {[...bySlot.values()].map((key) => <li key={key}>{STICKER_BY_KEY.get(key)?.name ?? key}</li>)}
      </ul>
    </div>
  );
}
