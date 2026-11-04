// Esme's Farm: the one page for the whole game (/farm). The sticker book on top, the farm
// beneath it; the farm part matching the open page is highlighted. Opening it the first time
// starts the farm (a fresh start: nothing from before counts).

import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { usePhone } from "../ui/usePhone";
import { MANIFEST } from "./catalogue";
import { useFarm, type FarmView } from "./FarmContext";
import { FarmScene } from "./FarmScene";
import { useTicker } from "./hooks";
import { HAPPY_FRAME_MS } from "./motion";
import { StickerPopIn } from "./PopIn";
import { ctx2d, drawCharacter, poseFrames, useSheets } from "./sprites";
import { StickerBook } from "./StickerBook";
import { CHARACTERS, type CharacterId } from "./state";
import { ACCESSORIES, NAMES, SPREADS, spreadOf } from "./world";
import "./farm.css";

export function FarmPage() {
  const view = useFarm();
  const phone = usePhone();
  const [spread, setSpread] = useState<number | null>(null);
  const [half, setHalf] = useState<0 | 1>(1);
  const [request, setRequest] = useState<number | null>(null);
  const [popKey, setPopKey] = useState<string | null>(null);
  const [who, setWho] = useState<CharacterId | null>(null);
  const [arrivals, setArrivals] = useState<CharacterId[]>([]);
  const farmRef = useRef<HTMLDivElement>(null);

  // The first open starts the farm.
  useEffect(() => {
    if (view?.loaded && view.state.start === null) void view.ensureStart();
  }, [view]);

  // Visiting the book clears the nook's glint.
  useEffect(() => {
    if (view?.glint) view.clearGlint();
  }, [view]);

  // "<name> has moved in!" the first time (kept on screen while she's here).
  useEffect(() => {
    if (!view?.loaded || !view.state.start) return;
    const fresh = CHARACTERS.filter((c) => c !== "domino" && view.arrived.has(c) && !view.state.arrived.has(c));
    if (fresh.length === 0) return;
    setArrivals((a) => [...a, ...fresh.filter((c) => !a.includes(c))]);
    for (const c of fresh) void view.markArrived(c);
  }, [view]);

  const zones = spread === null ? [] : phone && spread > 0
    ? [SPREADS[spread]!.pages[half]!.group]
    : SPREADS[spread]!.zones;
  const zoneKey = zones.join();
  useEffect(() => {
    view?.setFarmZones(zoneKey ? zoneKey.split(",") : []);
    return () => view?.setFarmZones([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneKey, view?.setFarmZones]);

  const onShow = useCallback((s: number | null, h: 0 | 1) => {
    setSpread(s);
    setHalf(h);
  }, []);
  const onRequestDone = useCallback(() => setRequest(null), []);

  if (!view) return null;
  return (
    <div className="farm-page">
      <h1>Esme's Farm</h1>
      <p className="visually-hidden" role="status" data-earned={view.earned.length}>
        {view.earned.length} of 170 stickers
      </p>
      {arrivals.length > 0 && (
        <div className="farm-arrival" role="status">
          {arrivals.map((c) => (
            <p key={c} className="farm-arrival-line">
              <CharacterPic view={view} c={c} pose="happy" />
              <span>{NAMES[c]} has moved in!</span>
            </p>
          ))}
          <button type="button" className="btn-secondary" onClick={() => setArrivals([])}>OK</button>
        </div>
      )}
      <StickerBook
        view={view}
        phone={phone}
        request={request}
        onRequestDone={onRequestDone}
        onShow={onShow}
        onPlaced={(k) => {
          setPopKey(null);
          setTimeout(() => setPopKey(k), 0);
          farmRef.current?.scrollIntoView?.({ block: "nearest" });
        }}
      />
      <div ref={farmRef}>
        <FarmScene
          view={view}
          phone={phone}
          highlight={zones}
          popKey={popKey}
          onZone={(z) => setRequest(spreadOf(z))}
          onCharacter={setWho}
        />
      </div>
      <div className="farm-cast" aria-label="Who lives here">
        {CHARACTERS.filter((c) => view.arrived.has(c)).map((c) => (
          <button key={c} type="button" className="btn-secondary" aria-pressed={who === c} onClick={() => setWho(who === c ? null : c)}>
            {NAMES[c]}
          </button>
        ))}
      </div>
      {who && <CharacterPanel view={view} c={who} onClose={() => setWho(null)} />}
    </div>
  );
}

const CHAR_SHEETS = [...CHARACTERS.map((c) => `char-${c}`), ...CHARACTERS.map((c) => `acc-${c}`)];

/** A character at 2x, looping a pose, wearing its chosen accessory. */
function CharacterPic({ view, c, pose = "idle" }: { view: FarmView; c: CharacterId; pose?: "idle" | "happy" }) {
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
  return <canvas ref={canvas} width={32} height={32} className="farm-px" style={{ width: 64, height: 64 }} aria-hidden="true" />;
}

function CharacterPanel({ view, c, onClose }: { view: FarmView; c: CharacterId; onClose: () => void }) {
  const home = MANIFEST.arrivals.find((a) => a.character.toLowerCase() === c)?.home ?? "";
  const current = view.state.outfits.get(c) ?? null;
  const items = ACCESSORIES.filter((a) => view.unlocked.includes(a.code));
  return (
    <section className="farm-character" aria-label={NAMES[c]}>
      <div className="farm-character-top">
        <CharacterPic view={view} c={c} />
        <div>
          <h2>{NAMES[c]}</h2>
          <p className="farm-muted">{home}</p>
        </div>
        <button type="button" className="farm-pop-close" aria-label="Close" onClick={onClose}>×</button>
      </div>
      <h3>Wardrobe</h3>
      <div className="farm-wardrobe" role="group" aria-label="Wardrobe">
        <button type="button" className="btn-secondary" aria-pressed={current === null || !items.some((a) => a.code === current)}
          onClick={() => void view.setOutfit(c, null)}>Nothing</button>
        {items.map((a) => (
          <button key={a.code} type="button" className="btn-secondary" aria-pressed={current === a.code} onClick={() => void view.setOutfit(c, a.code)}>
            {a.name}
          </button>
        ))}
      </div>
      {/* PLACEHOLDER WORDING */}
      {items.length < ACCESSORIES.length && <p className="farm-muted">More things to wear come with more stickers.</p>}
    </section>
  );
}

/** /farm/popin-demo: the monthly pop-in with her earned stickers (or a fictional handful). */
export function PopInDemo() {
  const view = useFarm();
  const [run, setRun] = useState(0);
  const keys = view && view.earned.length > 0 ? view.earned.slice(0, 15) : ["seeds-mind", "hen", "daisy", "lilypad", "lantern", "conker"];
  return (
    <div className="farm-page">
      <h1>Sticker pop-in (demo)</h1>
      <p className="farm-muted">The monthly review will show the month's stickers like this, one by one.</p>
      <StickerPopIn key={run} stickers={keys} />
      <p>
        <button type="button" className="btn-secondary" onClick={() => setRun((r) => r + 1)}>Again</button>{" "}
        <Link to="/farm">Back to the farm</Link>
      </p>
    </div>
  );
}
