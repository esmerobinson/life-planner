// Esme's Rio: the one page for the whole game (/farm), a fixed game screen (Esme, 2026-11-17): the
// map, or the area she opened from it, with the kit's hotbar on top to open the game menu (Esc
// opens and closes it too). The menu's Collection replaced the sticker book ("idk if i want the
// book at all", 2026-11-17). Opening the page the first time starts the game (a fresh start:
// nothing from before counts).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { AreaView } from "../rio/AreaView";
import { areaStatuses, sceneOpen } from "../rio/areas";
import { groupsOf } from "../rio/collection";
import { GameScreen } from "../rio/GameScreen";
import { Hotbar } from "../rio/Hotbar";
import { devLook, useRioLook } from "../rio/look";
import { GameMenu, MENU_TABS, type MenuTab } from "../rio/menu/GameMenu";
import { PhoneCollection } from "../rio/menu/PhoneCollection";
import { usePhone } from "../ui/usePhone";
import { TextButton, em } from "../rio/menu/pieces";
import { homeOf } from "../rio/placement";
import { RioMap } from "../rio/RioMap";
import { BitmapText } from "../rio/ui/BitmapText";
import { useUi } from "../rio/ui/fit";
import { COLLECTION, STICKERS } from "./catalogue";
import { CharacterPic } from "./CharacterPic";
import { useFarm } from "./FarmContext";
import { isTypingTarget } from "./hooks";
import { StickerPopIn } from "./PopIn";
import { CHARACTERS, type CharacterId } from "./state";
import { NAMES, farmDay } from "./world";
import "./farm.css";

const isTab = (t: string | null): t is MenuTab => MENU_TABS.some((m) => m.key === t);

export function FarmPage() {
  const view = useFarm();
  // The phone has no game, only her collection (Esme, 2026-11-17).
  const phone = usePhone();
  const [arrivals, setArrivals] = useState<CharacterId[]>([]);
  const [area, setArea] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuTab | null>(null);
  const [lastTab, setLastTab] = useState<MenuTab>("collection");
  const [shownArea, setShownArea] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const weather = useRioLook();
  const location = useLocation();
  const navigate = useNavigate();
  const look = devLook(location.search) ?? weather;

  const day = view?.state.start ? farmDay(view.state.start, view.today) : 1;
  const visited = view?.state.visited;
  const statuses = useMemo(() => areaStatuses(day, visited ?? new Set()), [day, visited]);
  const placed = view?.state.placed;
  const placedKeys = useMemo(() => STICKERS.filter((s) => placed?.has(s.key)).map((s) => s.key), [placed]);
  const canPlace = useCallback((key: string) => {
    const home = homeOf(key);
    const s = home ? statuses.get(home.area) : undefined;
    return (s === "open" || s === "new") && sceneOpen(home!.scene, day);
  }, [statuses, day]);
  const openArea = useCallback((a: string) => {
    setArea(a);
    void view?.markVisited(a).catch(() => undefined);
  }, [view]);

  const openMenu = useCallback((t: MenuTab) => {
    if (t === "map") {
      setMenu(null);
      setArea(null);
      return;
    }
    if (!menu) opener.current = document.activeElement as HTMLElement | null;
    setMenu(t);
    setLastTab(t);
  }, [menu]);
  const returnTo = useRef<HTMLElement | null>(null);
  const closeMenu = useCallback(() => {
    returnTo.current = opener.current;
    opener.current = null;
    setMenu(null);
  }, []);
  // Focus goes back where it was as soon as the menu has gone (not on a timer that could land
  // after her next key and take focus from where she has moved it).
  useEffect(() => {
    if (menu) return;
    const back = returnTo.current;
    returnTo.current = null;
    if (back?.isConnected) back.focus();
  }, [menu]);

  // /farm?menu=<tab> (the nook's collection icon, for one) opens the menu there.
  useEffect(() => {
    const t = new URLSearchParams(location.search).get("menu");
    if (!isTab(t)) return;
    if (!phone) openMenu(t);
    navigate("/farm", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // Esc opens the menu (never while she types, or while another pop-up has it); the menu closes itself.
  useEffect(() => {
    if (menu || phone) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      if (isTypingTarget(document.activeElement) || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      openMenu(lastTab);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menu, lastTab, openMenu, phone]);

  // The first open starts the game.
  useEffect(() => {
    if (view?.loaded && view.state.start === null) void view.ensureStart();
  }, [view]);

  // Opening the Collection clears the nook's glint (a sticker went in since she last looked); on the
  // phone the page is the collection.
  useEffect(() => {
    if ((phone || menu === "collection") && view?.glint) view.clearGlint();
  }, [menu, view, phone]);

  // The nook's host follows the Collection's area, as it followed the book's page.
  const zoneKey = menu === "collection" && shownArea ? groupsOf(shownArea).join() : "";
  useEffect(() => {
    view?.setFarmZones(zoneKey ? zoneKey.split(",") : []);
    return () => view?.setFarmZones([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoneKey, view?.setFarmZones]);

  // "<name> has moved in!" the first time (kept on screen while she's here).
  useEffect(() => {
    if (!view?.loaded || !view.state.start) return;
    const fresh = CHARACTERS.filter((c) => c !== "domino" && view.arrived.has(c) && !view.state.arrived.has(c));
    if (fresh.length === 0) return;
    setArrivals((a) => [...a, ...fresh.filter((c) => !a.includes(c))]);
    for (const c of fresh) void view.markArrived(c);
  }, [view]);

  if (!view) return null;
  if (phone) {
    return (
      <GameScreen>
        <h1 className="visually-hidden">Esme's Rio</h1>
        <p className="visually-hidden" role="status" data-earned={view.collected}>
          {view.collected} of {COLLECTION.length} stickers
        </p>
        {view.loaded && view.state.start && <PhoneCollection view={view} canPlace={canPlace} />}
        {arrivals.length > 0 && <Arrivals view={view} who={arrivals} onDone={() => setArrivals([])} />}
      </GameScreen>
    );
  }
  return (
    <GameScreen back={!area}>
      <h1 className="visually-hidden">Esme's Rio</h1>
      <p className="visually-hidden" role="status" data-earned={view.collected}>
        {view.collected} of {COLLECTION.length} stickers
      </p>
      <div className="rio-wrap">
        {area
          ? <AreaView key={area} area={area} look={look} day={day} placed={placedKeys} onBack={() => setArea(null)} />
          : <RioMap statuses={statuses} look={look} onOpen={openArea} />}
      </div>
      {arrivals.length > 0 && <Arrivals view={view} who={arrivals} onDone={() => setArrivals([])} />}
      <Hotbar current={menu ?? (area ? null : "map")} onPick={openMenu} />
      {/* Only once the game has started and its rows are read: the notes and counts are then true. */}
      {menu && view.loaded && view.state.start && (
        <GameMenu view={view} tab={menu} onTab={openMenu} onClose={closeMenu} canPlace={canPlace} day={day} statuses={statuses}
          startArea={area} onArea={setShownArea} />
      )}
    </GameScreen>
  );
}

/** "<name> has moved in!" in a thin kit frame, top centre, until she presses OK. */
function Arrivals({ view, who, onDone }: { view: NonNullable<ReturnType<typeof useFarm>>; who: CharacterId[]; onDone: () => void }) {
  const { u } = useUi();
  return (
    <div className="rio-arrival" style={{ fontSize: `${u}px` }}>
      <div className="thin flow" role="status">
        {who.map((c) => (
          <p key={c}>
            <CharacterPic view={view} c={c} pose="happy" size={em(32)} />
            <BitmapText text={`${NAMES[c]} has moved in!`} heading />
          </p>
        ))}
        <TextButton label="OK" w={24} onClick={onDone} />
      </div>
    </div>
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
