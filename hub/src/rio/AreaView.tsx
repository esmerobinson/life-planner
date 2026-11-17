// Esme's Rio: one area, outside first; its doors, stairs and exits lead in, between rooms and back
// to the map (rio/doors.ts; Esme, 2026-11-17: "hover and click on doors"). The scene's base is drawn
// for its state (it fills in as stickers are placed there) and the look (Rio's weather and
// clock); placed stickers stand on their slots (foot point = bottom-centre), back to front by
// foot y; in the rain the pack's falling rain plays over everything (not with reduced motion).

import { useEffect, useMemo, useRef, useState } from "react";
import { STICKER_BY_KEY, hintFor } from "../farm/catalogue";
import { useReducedMotion, useTicker } from "../farm/hooks";
import { ctx2d, drawFrame, drawSticker, useSheets } from "../farm/sprites";
import { AREA_SCENES, sceneOpen } from "./areas";
import { SCENE_AREA, clearOfHotbar, doorsFor, type Door, type DoorMenu } from "./doors";
import { AREA_HOTBAR_SLOTS, hotbarBox } from "./Hotbar";
import { BOTECO_NIGHTS, SCENES, sceneBase, type BotecoNight, type Look, type SceneId } from "./assets";
import { useCover, useRioImages } from "./canvas";
import { doorKeep, sceneKeep, stickerBox } from "./mapMath";
import { freeSlotsFor, layout } from "./placement";
import { NO_COUNTS, scenePlan, type RioCounts } from "./progress";
import { drawTinted, tintFor } from "./tint";
import { BitmapText } from "./ui/BitmapText";
import { TextButton } from "./menu/pieces";
import { useUi } from "./ui/fit";
import { Tip } from "./ui/Tip";

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

export function AreaView({ area, look, day, placed, counts = NO_COUNTS, night = null, goal = false, onBack, canEnter, onOpenMenu, onVisit,
  spots, hidden, editing = false, onHide, onMove, onEditDone }: {
  area: string;
  look: Look;
  /** The farm day: a scene that opens later (the sea, day 30) has no door before then. */
  day: number;
  /** She can go into this scene now (its area is open, and the scene itself): default, by `day` alone. */
  canEnter?: (scene: SceneId) => boolean;
  /** A hotspot that opens a menu tab (the beach noticeboard, the fitting room). */
  onOpenMenu?: (tab: DoorMenu) => void;
  /** She stepped into another area's scene (the barraca from the beach): it counts as a visit. */
  onVisit?: (area: string) => void;
  /** Placed stickers she hid: laid out and counted like the rest (the scene keeps its stage), not drawn. */
  hidden?: ReadonlySet<string>;
  /** Stickers she moved: their slots (farm `spot` rows). */
  spots?: ReadonlyMap<string, string>;
  /** Edit mode (the hotbar's Arrange): pick a placed sticker, then a free slot for it, or Hide. */
  editing?: boolean;
  onHide?: (sticker: string) => void;
  onMove?: (sticker: string, slot: string) => void;
  /** Esc with nothing picked leaves edit mode. */
  onEditDone?: () => void;
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
  const [scene, setScene] = useState<SceneId>(scenes.outside);
  const enter = canEnter ?? ((s: SceneId) => sceneOpen(s, day));
  const doors = doorsFor(scene).filter((d) => d.to === null || d.to === "map" || enter(d.to));
  const [hoverDoor, setHoverDoor] = useState<string | null>(null);
  const [hoverSticker, setHoverSticker] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const data = SCENES[scene];
  const reduced = useReducedMotion();

  const plan = useMemo(() => scenePlan(scene, placed, counts), [scene, placed, counts]);
  const state = plan.state;
  const { bySlot, overflow } = useMemo(() => layout(scene, placed, plan.milestones, spots), [scene, placed, plan.milestones, spots]);
  // Edit mode: where the picked sticker can go (the kit's place targets), and Esc to step back out.
  const pick = editing && picked && [...bySlot.values()].includes(picked) && !hidden?.has(picked) ? picked : null;
  const targets = useMemo(() => (pick ? freeSlotsFor(scene, pick, placed, plan.milestones, spots, hidden) : []), [pick, scene, placed, plan.milestones, spots, hidden]);
  useEffect(() => {
    if (!editing) {
      setPicked(null);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      if (pick) setPicked(null);
      else onEditDone?.();
    };
    // Capture: before the game's own Esc (which opens the menu).
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [editing, pick, onEditDone]);
  const moveHere = (slot: string) => {
    if (!pick) return;
    onMove?.(pick, slot);
    setPicked(null);
  };
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
  const canvas = useRef<HTMLCanvasElement>(null);

  const drawn = useMemo(() => {
    const at = new Map(data.slots.map((s) => [s.id, s]));
    return [...bySlot]
      .filter(([, key]) => !hidden?.has(key))
      .map(([slot, key]) => ({ slot: at.get(slot)!, key }))
      .sort((a, b) => a.slot.y - b.slot.y || a.slot.x - b.slot.x);
  }, [bySlot, data, hidden]);

  // The scene covers the view (an even plank border), never trimming what's drawn there.
  const [kx, ky, kw, kh] = sceneKeep([...drawn.map((d) => stickerBox(d.slot)), ...doors.map((d) => doorKeep(d.rect))], data.scene);
  const keep = useMemo((): [number, number, number, number] => [kx, ky, kw, kh], [kx, ky, kw, kh]);
  const fit = useCover(wrap, data.scene, keep, uiLayout === "wide");
  const scale = fit.scale;

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
    const tintKey = tintPair ? `${tintPair.day}|${tintPair.look}` : "";
    const tint = tintPair && dayImg && lookImg ? tintFor(tintKey, dayImg, lookImg) : null;
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
        if (tint) drawTinted(ctx, `${tintKey}|${key}`, tint, { x: left, y: top, w: STICKER, h: STICKER }, (c, x, y) => drawSticker(c, sheets, st, "sticker", x, y));
        else drawSticker(ctx, sheets, st, "sticker", left, top);
      }
    }
    // The museum's case glass over its finds (in the look's colours too).
    const glass = data.glass ? images[data.glass.file] : undefined;
    if (data.glass && glass) {
      for (const [gx, gy] of data.glass.at) {
        if (tint) drawTinted(ctx, `${tintKey}|glass`, tint, { x: gx, y: gy, w: glass.width, h: glass.height }, (c, x, y) => c.drawImage(glass, x, y));
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

  const go = (d: Door) => {
    setHoverDoor(null);
    if (d.to === "map") onBack();
    else if (d.to === null) { if (d.opens) onOpenMenu?.(d.opens); }
    else {
      if (SCENE_AREA[d.to] !== SCENE_AREA[scene]) onVisit?.(SCENE_AREA[d.to]);
      setScene(d.to);
    }
  };

  // Where each door stands over the scene (CSS px in the layer); one the hotbar would hide reaches up above it.
  const bar = hotbarBox(AREA_HOTBAR_SLOTS);
  const barBox = { left: (fit.view.w - bar.w * u) / 2, right: (fit.view.w + bar.w * u) / 2, top: fit.view.h - (bar.h + bar.below) * u };
  const doorBoxes = doors.map((d) => {
    const [x, y, w, h] = d.rect;
    const r = clearOfHotbar({ x: fit.x + x * scale, y: fit.y + y * scale, w: w * scale, h: h * scale }, barBox, 12 * u);
    return { door: d, x: r.x - fit.x, y: r.y - fit.y, w: r.w, h: r.h };
  });
  const tipDoor = doorBoxes.find((b) => b.door.id === hoverDoor);
  const tipSticker = drawn.find((d) => d.key === hoverSticker);
  const room = fit.y + (tipDoor?.y ?? 0) > 30 * u; // room above the door for its label

  return (
    <div className="rio-area" ref={wrap} data-scene={scene} data-state={state} data-look={shownLook} data-fit={fit.mode}
      data-celebrations={plan.celebrations} data-milestones={plan.milestones.join(" ")} data-books={plan.books}
      data-night={nightSide ? night! : undefined} data-player={playerStrip ? "esme" : undefined}
      data-goal={goalFrames.length > 0 ? "true" : undefined}>
      <h2 className="visually-hidden">{SCENE_NAMES[scene]}</h2>
      <div className="rio-area-layer" style={{ left: fit.x, top: fit.y, width: data.scene[0] * scale, height: data.scene[1] * scale, ["--art-px" as string]: `${Math.max(1, scale)}px` }}>
        <canvas ref={canvas} width={data.scene[0]} height={data.scene[1]} className="farm-px"
          style={{ width: data.scene[0] * scale, height: data.scene[1] * scale }} aria-hidden="true" />
        {/* The doors, stairs and exits: hover or focus shows them (a solid kit outline) and their name. */}
        <nav aria-label="Ways in and out">
          {doorBoxes.map(({ door: d, x, y, w, h }) => (
            <button key={d.id} type="button" className="rio-door" aria-label={d.label} data-door={d.id} data-to={d.to ?? d.opens}
              style={{ left: x, top: y, width: w, height: h }} onClick={() => go(d)}
              onMouseEnter={() => setHoverDoor(d.id)} onMouseLeave={() => setHoverDoor((h) => (h === d.id ? null : h))}
              onFocus={() => setHoverDoor(d.id)} onBlur={() => setHoverDoor((h) => (h === d.id ? null : h))} />
          ))}
        </nav>
        {/* Each placed sticker: hovering names it and says what it's for, beside it (Esme, 2026-11-17). */}
        {drawn.map(({ slot, key }) => {
          const [bx, by] = stickerBox(slot);
          const box = { left: bx * scale, top: by * scale, width: STICKER * scale, height: STICKER * scale };
          const hover = { onMouseEnter: () => setHoverSticker(key), onMouseLeave: () => setHoverSticker((h) => (h === key ? null : h)) };
          if (!editing) return <span key={key} className="rio-sticker" data-sticker={key} aria-hidden="true" style={box} {...hover} />;
          // PLACEHOLDER WORDING
          return (
            <button key={key} type="button" className={pick === key ? "rio-sticker on" : "rio-sticker"} data-sticker={key}
              aria-label={`${STICKER_BY_KEY.get(key)?.name ?? key}: move or hide`} aria-pressed={pick === key} style={box} {...hover}
              onPointerDown={() => setPicked(key)} onClick={() => setPicked(key)} />
          );
        })}
        {/* The free slots it can go to: the kit's place target (its own pulse; still with reduced motion). */}
        {targets.map((t) => {
          const [bx, by] = stickerBox(t);
          return (
            // PLACEHOLDER WORDING
            <button key={t.id} type="button" className="rio-target pulse" data-slot={t.id} aria-label={`Move ${STICKER_BY_KEY.get(pick!)?.name ?? pick} here`}
              style={{ left: (bx - 1) * scale, top: (by - 1) * scale, width: 18 * scale, height: 18 * scale }}
              onPointerUp={() => moveHere(t.id)} onClick={() => moveHere(t.id)} />
          );
        })}
        {pick && (() => {
          const d = drawn.find((x) => x.key === pick)!;
          const [bx, by] = stickerBox(d.slot);
          return (
            <div className="rio-edit-actions" style={{ left: (bx + STICKER) * scale + 2 * u, top: by * scale, fontSize: `${u}px` }}>
              {/* PLACEHOLDER WORDING */}
              <TextButton label="Hide" onClick={() => { onHide?.(pick); setPicked(null); }} />
            </div>
          );
        })()}
        {tipSticker && tipSticker.key !== pick && (() => {
          const [bx, by] = stickerBox(tipSticker.slot);
          const st = STICKER_BY_KEY.get(tipSticker.key)!;
          // Right of the sticker, or left of it near the view's right edge.
          const right = fit.x + (bx + STICKER) * scale + 140 * u < fit.view.w;
          const at = { x: right ? (bx + STICKER) * scale + 2 * u : bx * scale - 2 * u, y: (by + STICKER / 2) * scale };
          return <Tip lines={[st.name, hintFor(st)]} side={right ? "right" : "left"} at={at} />;
        })()}
        {tipDoor && (
          <Tip lines={[tipDoor.door.label]} side={room ? "above" : "below"}
            at={{ x: tipDoor.x + tipDoor.w / 2, y: room ? tipDoor.y - 2 * u : tipDoor.y + tipDoor.h + 2 * u }} />
        )}
      </div>
      {editing && (
        <div className="rio-edit-note" style={{ fontSize: `${u}px` }}>
          {/* PLACEHOLDER WORDING */}
          <div className="thin flow" role="status"><BitmapText text={pick ? "Pick where it goes, or Hide it" : "Arranging: pick a sticker to move or hide"} /></div>
        </div>
      )}
      {/* PLACEHOLDER WORDING */}
      {overflow > 0 && (
        <div className="rio-area-note" style={{ fontSize: `${u}px` }}>
          <div className="thin flow"><BitmapText text={`${overflow} more in your collection`} /></div>
        </div>
      )}
      {/* PLACEHOLDER WORDING (book order) */}
      <ul className="visually-hidden" aria-label="Stickers here">
        {[...bySlot.values()].filter((key) => !hidden?.has(key)).map((key) => <li key={key}>{STICKER_BY_KEY.get(key)?.name ?? key}</li>)}
      </ul>
    </div>
  );
}
