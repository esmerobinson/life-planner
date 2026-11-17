import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { COLLECTION, STICKERS } from "../../farm/catalogue";
import type { FarmView } from "../../farm/FarmContext";
import { motionPref, setMotionPref } from "../../farm/motion";
import { EMPTY_FARM, type FarmState } from "../../farm/state";
import { areaStatuses } from "../areas";
import { GameMenu, type MenuTab } from "./GameMenu";

// The game menu (Esme, 2026-11-17): one wooden kit panel with tabs. Fictional data throughout.

function fakeView(o: { earned?: string[]; placed?: string[]; seenOn?: [string, string][]; counters?: [string, number][]; place?: FarmView["place"] } = {}): FarmView {
  const earned = o.earned ?? [];
  const state: FarmState = {
    ...EMPTY_FARM,
    start: "2026-11-16",
    seen: new Set(earned),
    seenOn: new Map(o.seenOn ?? earned.map((k) => [k, "2026-11-16"] as [string, string])),
    placed: new Map((o.placed ?? []).map((k) => [k, "rio"])),
  };
  return {
    loaded: true, today: "2026-11-16", state, counters: new Map(o.counters ?? []) as FarmView["counters"], earned,
    earnedSet: new Set(earned), collected: earned.filter((k) => COLLECTION.some((s) => s.key === k)).length,
    arrived: new Set(["domino"]), awake: new Set(), unlocked: [], queue: [], journalOpen: false, farmZones: [], setFarmZones: () => undefined,
    glint: false, clearGlint: () => undefined, ensureStart: async () => undefined, markSeen: async () => undefined,
    place: o.place ?? vi.fn(async () => undefined), markArrived: async () => undefined, setOutfit: async () => undefined,
    markVisited: async () => undefined,
  };
}

function Menu({ view, start = "collection", onClose = () => undefined, canPlace = () => true }: {
  view: FarmView; start?: MenuTab; onClose?: () => void; canPlace?: (k: string) => boolean;
}) {
  const [tab, setTab] = useState<MenuTab>(start);
  return <GameMenu view={view} tab={tab} onTab={setTab} onClose={onClose} canPlace={canPlace} day={1} statuses={areaStatuses(1, new Set())} />;
}

const tabs = () => within(screen.getByRole("tablist", { name: "Menu" })).getAllByRole("tab");

it("is a dialog with the seven tabs along the top", () => {
  render(<Menu view={fakeView()} />);
  expect(screen.getByRole("dialog", { name: "Menu" })).toBeInTheDocument();
  expect(tabs().map((t) => t.getAttribute("aria-label"))).toEqual(["Map", "Collection", "Noticeboard", "Wardrobe", "Recipes", "Friends", "Settings"]);
  expect(screen.getByRole("tab", { name: "Collection" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", screen.getByRole("tab", { name: "Collection" }).id);
});

it("arrow keys move along the tabs, Home and End jump; Enter opens one", async () => {
  const user = userEvent.setup();
  render(<Menu view={fakeView()} />);
  screen.getByRole("tab", { name: "Collection" }).focus();
  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("tab", { name: "Noticeboard" })).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByRole("tab", { name: "Settings" })).toHaveFocus();
  await user.keyboard("{Home}{ArrowLeft}");
  expect(screen.getByRole("tab", { name: "Settings" })).toHaveFocus(); // wraps round
  await user.keyboard("{Enter}");
  expect(screen.getByRole("tab", { name: "Settings" })).toHaveAttribute("aria-selected", "true");
});

it("the Map tab and Esc both close it, back to the city", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<Menu view={fakeView()} onClose={onClose} />);
  await user.click(screen.getByRole("tab", { name: "Map" }));
  expect(onClose).toHaveBeenCalledTimes(1);
  screen.getByRole("tab", { name: "Collection" }).focus();
  await user.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(2);
  await user.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(3);
});

it("Esc closes it even after a click has left focus on the page behind (review I1)", () => {
  const onClose = vi.fn();
  render(<Menu view={fakeView()} onClose={onClose} />);
  (document.activeElement as HTMLElement | null)?.blur();
  expect(document.activeElement).toBe(document.body);
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("Esc on an open sticker card closes the card, not the menu", async () => {
  const user = userEvent.setup();
  const onClose = vi.fn();
  render(<Menu view={fakeView()} onClose={onClose} />);
  await user.click(screen.getByRole("tab", { name: "Fazenda" }));
  await user.click(screen.getByRole("button", { name: "Mind: sprout: not yet" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Mind: sprout" })).toBeNull();
  expect(onClose).not.toHaveBeenCalled();
});

it("Shift+Tab from the open tab stays inside the menu (review I2)", async () => {
  const user = userEvent.setup();
  render(<><button type="button">Behind the menu</button><Menu view={fakeView()} /></>);
  screen.getByRole("tab", { name: "Collection" }).focus();
  await user.tab({ shift: true });
  expect(screen.getByRole("dialog", { name: "Menu" }).contains(document.activeElement)).toBe(true);
});

describe("Collection", () => {
  it("shows earned stickers ready to place; its card places it in Rio", async () => {
    const user = userEvent.setup();
    const view = fakeView({ earned: ["hi", "seeds-mind"] });
    render(<Menu view={view} />);
    await user.click(screen.getByRole("tab", { name: "Fazenda" }));
    await user.click(screen.getByRole("button", { name: "Mind: seeds: ready to place" }));
    const card = screen.getByRole("dialog", { name: "Mind: seeds" });
    await user.click(within(card).getByRole("button", { name: "Place in Rio" }));
    expect(view.place).toHaveBeenCalledWith("seeds-mind");
  });

  it("a silhouette's card says what earns it", async () => {
    const user = userEvent.setup();
    render(<Menu view={fakeView()} />);
    await user.click(screen.getByRole("tab", { name: "Fazenda" }));
    await user.click(screen.getByRole("button", { name: "Mind: sprout: not yet" }));
    expect(screen.getByRole("dialog", { name: "Mind: sprout" })).toHaveTextContent("3 to-dos ticked off in Mind");
  });

  it("a sticker whose place in Rio hasn't opened waits, and still counts", async () => {
    const user = userEvent.setup();
    const orchard = COLLECTION.find((s) => s.group === "orchard")!;
    render(<Menu view={fakeView({ earned: [orchard.key] })} canPlace={() => false} />);
    await user.click(screen.getByRole("tab", { name: "Jardim Botânico" }));
    await user.click(screen.getByRole("button", { name: `${orchard.name}: ready to place` }));
    const card = screen.getByRole("dialog", { name: orchard.name });
    expect(card).toHaveTextContent("Its place in Rio opens later");
    expect(within(card).queryByRole("button", { name: "Place in Rio" })).toBeNull();
    expect(screen.getByRole("tabpanel")).toHaveTextContent("1 of 175");
  });

  it("if placing fails, the sticker stays ready and the card stays open (review M6)", async () => {
    const user = userEvent.setup();
    const view = fakeView({ earned: ["seeds-mind"], place: vi.fn(async () => { throw new Error("disk full"); }) });
    render(<Menu view={view} />);
    await user.click(screen.getByRole("tab", { name: "Fazenda" }));
    await user.click(screen.getByRole("button", { name: "Mind: seeds: ready to place" }));
    await user.click(within(screen.getByRole("dialog", { name: "Mind: seeds" })).getByRole("button", { name: "Place in Rio" }));
    expect(screen.getByRole("dialog", { name: "Mind: seeds" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mind: seeds: ready to place" })).toBeInTheDocument();
  });

  it("a sticker earned while the menu is open shows at once (review focus 1)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<GameMenu view={fakeView()} tab="collection" onTab={() => undefined} onClose={() => undefined}
      canPlace={() => true} day={1} statuses={areaStatuses(1, new Set())} />);
    await user.click(screen.getByRole("tab", { name: "Fazenda" }));
    expect(document.querySelector('[data-sticker="seeds-mind"]')).toHaveAttribute("data-state", "ghost");
    act(() => rerender(<GameMenu view={fakeView({ earned: ["seeds-mind"] })} tab="collection" onTab={() => undefined} onClose={() => undefined}
      canPlace={() => true} day={1} statuses={areaStatuses(1, new Set())} />));
    expect(document.querySelector('[data-sticker="seeds-mind"]')).toHaveAttribute("data-state", "ready");
  });

  it("repeat stickers keep their ×N; the bonus page counts apart from the 175", async () => {
    const user = userEvent.setup();
    const cleared = STICKERS.find((s) => s.bonus)!;
    render(<Menu view={fakeView({ earned: [cleared.key], counters: [[cleared.rule.source, 3]] })} />);
    await user.click(screen.getByRole("tab", { name: "Bonus" }));
    const cell = document.querySelector(`[data-sticker="${cleared.key}"]`)!;
    expect(cell).toHaveTextContent("×3");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("0 of 175");
  });

  it("an area with two pages turns with the arrows", async () => {
    const user = userEvent.setup();
    render(<Menu view={fakeView()} />);
    await user.click(screen.getByRole("tab", { name: "Fazenda" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Vegetable beds");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Barnyard");
    expect(document.querySelector('[data-sticker="hen"]')).toBeInTheDocument();
  });
});

describe("Noticeboard", () => {
  it("on day one: the Barraca opens next, on day 3; what she just earned; who moves in next", async () => {
    const user = userEvent.setup();
    render(<Menu view={fakeView({ earned: ["hi", "hen"] })} start="noticeboard" />);
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveTextContent("Opens next: Barraca");
    await user.click(screen.getByRole("button", { name: /Opens next: Barraca/ }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("day 3");
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: /Just earned/ }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Hen");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Next friend: Caetano");
    // Phase 2's notes aren't faked: an honest note says they come later.
    expect(screen.getByRole("tabpanel")).toHaveTextContent(/later/i);
  });
});

describe("Settings", () => {
  afterEach(() => setMotionPref("system"));

  it("motion follows the device, or her choice for this device", async () => {
    const user = userEvent.setup();
    render(<Menu view={fakeView()} start="settings" />);
    const group = screen.getByRole("radiogroup", { name: "Motion" });
    expect(within(group).getByRole("radio", { name: "Follow this device" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(group).getByRole("radio", { name: "Reduce motion" }));
    expect(motionPref()).toBe("on");
    expect(within(group).getByRole("radio", { name: "Reduce motion" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent(/earn stickers/);
  });
});

it("Wardrobe and Recipes open later", async () => {
  const user = userEvent.setup();
  render(<Menu view={fakeView()} start="wardrobe" />);
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Opens later");
  await user.click(screen.getByRole("tab", { name: "Recipes" }));
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Recipes");
  expect(screen.getByRole("tabpanel")).toHaveTextContent("Opens later");
});

it("a click outside the panel closes it (the dim, or the stage's empty corners); a click on the panel doesn't", async () => {
  const onClose = vi.fn();
  const user = userEvent.setup();
  render(<Menu view={fakeView()} onClose={onClose} />);
  await user.click(document.querySelector(".pnl")!);
  expect(onClose).not.toHaveBeenCalled();
  await user.click(document.querySelector(".rio-menu")!);
  expect(onClose).toHaveBeenCalledTimes(1);
  await user.click(document.querySelector(".rio-menu-dim")!);
  expect(onClose).toHaveBeenCalledTimes(2);
});
