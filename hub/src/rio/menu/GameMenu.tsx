// Esme's Rio: the game menu (Esme, 2026-11-17: "the sticker book should be a tab i can open on the
// main map, and menu with settings etc, where i can see missions/important stuff"). One wooden kit
// panel with tabs along the top, laid out as the kit's own menu-with-tabs screen (esme-ui
// src/screens_c_more.js skillsHTML): the tabs 12 in and 15 above the panel, the close button at
// its top-right corner. It never scrolls: the whole stage fits the game screen (ui/fit.ts).
// Keyboard: arrow keys, Home and End move along the tabs (Enter or Space opens one), Esc closes,
// Tab stays inside while it's open.

import { useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { FarmView } from "../../farm/FarmContext";
import { useReducedMotion } from "../../farm/hooks";
import type { AreaStatus } from "../areas";
import { UiContext, stageOf, useUi, type Box } from "../ui/fit";
import { CollectionTab } from "./CollectionTab";
import { FriendsTab } from "./FriendsTab";
import { LaterTab } from "./LaterTab";
import { NoticeboardTab } from "./NoticeboardTab";
import { KitIcon, em, kitVars, pos } from "./pieces";
import { SettingsTab } from "./SettingsTab";
import "./menu.css";

export type MenuTab = "map" | "collection" | "noticeboard" | "wardrobe" | "recipes" | "friends" | "settings";

/** The tabs, in order, with the kit's icon for each (Recipes and Settings: drawn for Rio, 2026-11-17). */
export const MENU_TABS: readonly { key: MenuTab; label: string; icon: string | null }[] = [
  { key: "map", label: "Map", icon: "icon-map" },
  { key: "collection", label: "Collection", icon: "icon-book" },
  { key: "noticeboard", label: "Noticeboard", icon: "icon-noticeboard" },
  { key: "wardrobe", label: "Wardrobe", icon: "icon-wardrobe" },
  { key: "recipes", label: "Recipes", icon: "ic-tab-recipes" },
  { key: "friends", label: "Friends", icon: "icon-friends" },
  { key: "settings", label: "Settings", icon: "ic-tab-settings" },
]; // PLACEHOLDER WORDING (tab names)

export interface TabProps {
  view: FarmView;
  /** The panel and the stage, in UI px. */
  panel: Box;
  stage: { w: number; h: number; dock?: Box };
  /** The panel's inside (within its border): where content goes. */
  inner: Box;
  narrow: boolean;
}

export interface GameMenuProps {
  view: FarmView;
  tab: MenuTab;
  onTab: (t: MenuTab) => void;
  onClose: () => void;
  /** A ready sticker can be placed now (its place in Rio is open). */
  canPlace: (key: string) => boolean;
  day: number;
  statuses: ReadonlyMap<string, AreaStatus>;
  /** The Collection opens on this area (the one she's in), if it has stickers. */
  startArea?: string | null;
  /** The Collection's shown area (null when another tab shows): the nook's host follows it. */
  onArea?: (area: string | null) => void;
}

/** What Tab reaches (a roving tab's tabindex -1 is not: review I2). */
const FOCUSABLE = 'button:not([disabled]):not([tabindex="-1"]), [href]:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

export function GameMenu({ view, tab, onTab, onClose, canPlace, day, statuses, startArea, onArea }: GameMenuProps) {
  const outer = useUi();
  // Inside the menu everything is drawn at the menu's own scale (fractional on the desktop).
  const fit = { ...outer, u: outer.menuU };
  const { u, layout } = fit;
  const narrow = layout === "narrow";
  const stage = stageOf(fit);
  const P = stage.panel;
  const inner: Box = { x: P.x + 6, y: P.y + 6, w: P.w - 13, h: P.h - 12 };
  const root = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const id = useId();
  const still = useReducedMotion();
  const shown = tab === "map" ? "collection" : tab;

  // Focus moves into the menu as it opens (onto the open tab).
  useEffect(() => {
    tabRefs.current[MENU_TABS.findIndex((t) => t.key === shown)]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (shown !== "collection") onArea?.(null);
  }, [shown, onArea]);

  // Esc closes the menu wherever focus is, even after a click left it on the page (review I1);
  // something inside that uses Esc first (a sticker's card) marks it handled.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const pick = (t: MenuTab) => (t === "map" ? onClose() : onTab(t));

  const onTabKey = (e: ReactKeyboardEvent, i: number) => {
    const n = MENU_TABS.length;
    const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : null;
    if (to === null) return;
    e.preventDefault();
    tabRefs.current[to]?.focus();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== "Tab" || !root.current) return;
    // Tab stays inside the menu while it's open.
    const all = [...root.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (all.length === 0) return;
    const first = all[0]!;
    const last = all[all.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const props: TabProps = { view, panel: P, stage, inner, narrow };
  const active = MENU_TABS.findIndex((t) => t.key === shown);

  return (
    <UiContext.Provider value={fit}>
    <div className="rio-menu-dim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={root} className={`rio-menu rio-ui${still ? " is-still" : ""}`} role="dialog" aria-modal="true" aria-label="Menu"
        tabIndex={-1} data-tab={shown} data-layout={layout} onKeyDown={onKeyDown}
        // A click on the panel itself keeps focus in the menu (so Tab stays inside it).
        onMouseDown={(e) => { if (e.target === e.currentTarget || !(e.target as HTMLElement).closest(FOCUSABLE)) root.current?.focus(); }}
        // The stage's empty corners (beside the tabs, left of the panel) are outside the panel too.
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        style={{ ...kitVars(), fontSize: `${u}px`, width: em(stage.w), height: em(stage.h) }}>
        {/* The panel (z 5), then the tabs that bite into it. */}
        <div className="pnl" style={{ ...pos(P.x, P.y, P.w, P.h), zIndex: 5 }} />
        <div className="a" role="tablist" aria-label="Menu" style={pos(P.x + 12, P.y - 15, MENU_TABS.length * 18, 18)}>
          {MENU_TABS.map((t, i) => (
            <button key={t.key} ref={(el) => { tabRefs.current[i] = el; }} type="button" role="tab" id={`${id}-tab-${t.key}`}
              aria-label={t.label} aria-selected={i === active} aria-controls={`${id}-panel`} tabIndex={i === active ? 0 : -1}
              className={i === active ? "tab on" : "tab"} title={t.label}
              style={pos(i * 18, i === active ? 3 : 0)} onClick={() => pick(t.key)} onKeyDown={(e) => onTabKey(e, i)}>
              <KitIcon name={t.icon} x={3} y={3} w={12} h={12} />
            </button>
          ))}
        </div>
        <button type="button" className="btn close" aria-label="Close" onClick={onClose}
          style={{ ...pos(P.x + P.w - 12, P.y - (narrow ? 14 : 26), 12, 12), backgroundImage: "var(--k-btn-close)" }} />
        <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${shown}`} className="a" style={{ ...pos(0, 0, stage.w, stage.h), zIndex: 6 }}>
          {shown === "collection" && <CollectionTab {...props} canPlace={canPlace} startArea={startArea} onArea={onArea} />}
          {shown === "noticeboard" && <NoticeboardTab {...props} day={day} statuses={statuses} />}
          {shown === "friends" && <FriendsTab {...props} />}
          {shown === "settings" && <SettingsTab {...props} />}
          {(shown === "wardrobe" || shown === "recipes") && <LaterTab {...props} name={MENU_TABS[active]!.label} />}
        </div>
      </div>
    </div>
    </UiContext.Provider>
  );
}
