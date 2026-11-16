// Esme's Rio: one area, outside first, with its insides a button away. The scene's base is drawn
// for its state (it fills in as stickers are placed there) and the look (Rio's weather and
// clock); placed stickers stand on their slots (foot point = bottom-centre), back to front by
// foot y; in the rain the pack's falling rain plays over everything (not with reduced motion).

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { STICKER_BY_KEY } from "../farm/catalogue";
import { useReducedMotion, useTicker } from "../farm/hooks";
import { ctx2d, drawFrame, drawSticker, useSheets } from "../farm/sprites";
import { AREA_SCENES } from "./areas";
import { SCENES, sceneBase, type Look, type SceneId } from "./assets";
import { useFit, useRioImages } from "./canvas";
import { layout, sceneState } from "./placement";

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
};

const STICKER = 16;
const STICKER_SHEETS = ["stickers"];

export function AreaView({ area, look, placed, onBack }: {
  area: string;
  look: Look;
  /** Every placed sticker (book order); the scene picks its own. */
  placed: readonly string[];
  onBack: () => void;
}) {
  const scenes = AREA_SCENES[area]!;
  const [scene, setScene] = useState<SceneId>(scenes.outside);
  const data = SCENES[scene];
  const reduced = useReducedMotion();

  const { bySlot, overflow } = useMemo(() => layout(scene, placed), [scene, placed]);
  const state = sceneState(scene, bySlot.size + overflow);
  const base = sceneBase(scene, state, look);
  const shownLook: Look = base === data.base[state]?.[look] ? look : "day";

  const rain = shownLook === "rain" ? data.rainOverlay : undefined;
  const rainFrames = rain?.frames ?? (rain?.strip ? [rain.strip.file] : []);
  const rainCount = rain?.frames?.length ?? rain?.strip?.count ?? 0;
  const tvFrames = data.tv?.frames[shownLook] ?? [];
  const rainTick = useTicker(rain?.ms ?? 1000, !!rain && rainCount > 0 && !reduced);
  const tvTick = useTicker(data.tv?.ms ?? 1000, tvFrames.length > 0 && !reduced);

  const files = useMemo(() => [base, ...rainFrames, ...tvFrames], [base, rainFrames.join(), tvFrames.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const images = useRioImages(files);
  const sheets = useSheets(STICKER_SHEETS);

  const wrap = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const [reserve, setReserve] = useState(0);
  useLayoutEffect(() => setReserve(controls.current?.offsetHeight ?? 0), [scene]);
  const scale = useFit(wrap, data.scene, reserve);
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
    const b = images[base];
    if (b) ctx.drawImage(b, 0, 0);
    if (sheets) {
      for (const { slot, key } of drawn) {
        const st = STICKER_BY_KEY.get(key);
        if (!st) continue;
        const left = slot.x - STICKER / 2;
        const top = slot.anchor === "top" ? slot.y : slot.y - STICKER + 1;
        drawSticker(ctx, sheets, st, "sticker", left, top);
      }
    }
    // The bar TV (the base already shows its first frame, so with reduced motion nothing is drawn).
    if (data.tv && tvFrames.length > 0 && !reduced) {
      const f = images[tvFrames[tvTick % tvFrames.length]!];
      if (f) ctx.drawImage(f, data.tv.at[0], data.tv.at[1]);
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
  }, [images, sheets, base, drawn, data, rain, rainCount, rainTick, tvFrames, tvTick, reduced]);

  const inside = scene !== scenes.outside;
  return (
    <div className="rio-area" ref={wrap} data-scene={scene} data-state={state} data-look={shownLook}>
      <h2 className="visually-hidden">{SCENE_NAMES[scene]}</h2>
      <div className="rio-area-controls farm-cast" ref={controls}>
        {/* PLACEHOLDER WORDING */}
        <button type="button" className="btn-secondary" onClick={onBack}>Back to the map</button>
        {/* PLACEHOLDER WORDING */}
        {inside && <button type="button" className="btn-secondary" onClick={() => setScene(scenes.outside)}>Outside</button>}
        {!inside && scenes.inside.length > 0 && (
          // PLACEHOLDER WORDING
          <div className="farm-cast" role="group" aria-label="Go inside">
            {scenes.inside.map((s) => (
              <button key={s} type="button" className="btn-secondary" onClick={() => setScene(s)}>{SCENE_NAMES[s]}</button>
            ))}
          </div>
        )}
      </div>
      <div className="rio-area-layer" style={{ width: data.scene[0] * scale, height: data.scene[1] * scale }}>
        <canvas ref={canvas} width={data.scene[0]} height={data.scene[1]} className="farm-px"
          style={{ width: data.scene[0] * scale, height: data.scene[1] * scale }} aria-hidden="true" />
      </div>
      {/* PLACEHOLDER WORDING */}
      {overflow > 0 && <p className="farm-muted">{overflow} more in your sticker book</p>}
      {/* PLACEHOLDER WORDING (book order) */}
      <ul className="visually-hidden" aria-label="Stickers here">
        {[...bySlot.values()].map((key) => <li key={key}>{STICKER_BY_KEY.get(key)?.name ?? key}</li>)}
      </ul>
    </div>
  );
}
