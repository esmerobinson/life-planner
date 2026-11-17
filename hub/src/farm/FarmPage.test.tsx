import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { db } from "../data/db";
import { currentUrl, renderApp } from "../test/renderApp";
import { StickerPopIn } from "./PopIn";
import { COLLECTION } from "./catalogue";
import { placedRow, seenRow, startRow } from "./state";

// The farm page and nook in the whole app (fictional data). Canvases aren't drawn in the test
// DOM; what they would show is checked through the page's buttons and data attributes.

beforeEach(async () => {
  await db.farm.clear();
  await db.items.clear();
  await db.pending.clear();
});
afterEach(() => vi.useRealTimers());

const farmRows = () => db.farm.toArray();

it("opening the farm the first time starts it (a fresh start); the Welcome sticker plays in the nook, then is kept", async () => {
  renderApp("/farm", "2026-11-04");
  expect(await screen.findByRole("heading", { level: 1, name: "Esme's Rio" })).toBeInTheDocument();
  await waitFor(async () => expect((await farmRows()).some((r) => r.kind === "start" && "date" in r && r.date === "2026-11-04")).toBe(true));
  // The earned moment plays in the nook, then Welcome is seen for good.
  await waitFor(async () => expect(await db.farm.get("seen:hi")).toBeTruthy(), { timeout: 3000 });
  await waitFor(() => expect(document.querySelector("[data-earned]")).toHaveAttribute("data-earned", "1"));
});

it("the earned moment never interrupts typing: it waits while a text field has focus", async () => {
  renderApp("/today", "2026-11-04");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Add" }));
  await waitFor(() => expect(document.activeElement?.tagName).toMatch(/INPUT|TEXTAREA/));
  // The farm starts (say, on another device, synced in) while she types: Welcome is earned now.
  await db.farm.put(startRow("dev-a", "2026-11-02"));
  await new Promise((r) => setTimeout(r, 1000));
  expect(await db.farm.get("seen:hi")).toBeUndefined();
  await user.keyboard("{Escape}");
  await waitFor(async () => expect(await db.farm.get("seen:hi")).toBeTruthy(), { timeout: 3000 });
});

it("nothing is written before the farm is opened", async () => {
  renderApp("/today", "2026-11-04");
  await screen.findByRole("heading", { level: 1, name: "Today" });
  expect(await db.farm.count()).toBe(0);
  expect(document.querySelector(".farm-nook")).toHaveAttribute("data-host", "domino");
  // Shown names: Esme's Rio, and the tuxedo cat is Mr Cat (Esme, 2026-11-10 and 2026-11-16).
  expect(screen.getByRole("link", { name: "Esme's Rio (Mr Cat is here)" })).toHaveAttribute("href", "/farm");
});

/** Opens the game menu from the hotbar (on the game screen) at a tab. */
async function openMenu(user: ReturnType<typeof userEvent.setup>, tab: string) {
  await user.click(within(await screen.findByRole("navigation", { name: "Game menu" })).getByRole("button", { name: tab }));
  return screen.findByRole("dialog", { name: "Menu" });
}

/** In the open menu's Collection: an area's tab (and its page). */
async function collectionAt(user: ReturnType<typeof userEvent.setup>, area: string, nextPages = 0) {
  await openMenu(user, "Collection");
  await user.click(screen.getByRole("tab", { name: area }));
  for (let i = 0; i < nextPages; i++) await user.click(screen.getByRole("button", { name: "Next page" }));
}

it("the game takes the whole window: no sidebar, Inbox or +; Back goes Home when she opened it directly (Esme, 2026-11-17)", async () => {
  renderApp("/farm", "2026-11-04");
  const user = userEvent.setup();
  await screen.findByRole("list", { name: "Places in Rio" });
  expect(screen.queryByRole("navigation", { name: "Main" })).toBeNull();
  expect(screen.queryByRole("link", { name: /^Inbox/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  // The nook stays with the game (its moments play there).
  expect(document.querySelector(".farm-nook")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() => expect(currentUrl).toBe("/"));
  expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
});

it("Back is the kit's small word button: the small pixel font at 1x (Esme, 2026-11-17: \"back button can be smaller\")", async () => {
  renderApp("/farm", "2026-11-04");
  await screen.findByRole("list", { name: "Places in Rio" });
  const back = screen.getByRole("button", { name: "Back" });
  expect(back).toHaveClass("game-back");
  const c = back.querySelector("canvas")!;
  expect(c.style.width).toBe(`${c.width}px`);
});

describe("on the phone, only the collection (Esme, 2026-11-17: \"no game on phone other than stickers collected UI\")", () => {
  beforeEach(() => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: q.includes("max-width"), media: q, addEventListener: () => undefined, removeEventListener: () => undefined,
    }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows her stickers full screen with Back; no map, areas, hotbar or menu tabs", async () => {
    await db.farm.bulkPut([startRow("dev-a", "2026-11-02"), seenRow("hi", "2026-11-02"), seenRow("lilypad", "2026-11-03")]);
    renderApp("/farm", "2026-11-04");
    const user = userEvent.setup();
    const col = await screen.findByRole("region", { name: "Your sticker collection" });
    expect(screen.queryByRole("list", { name: "Places in Rio" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Game menu" })).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Menu" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    // Placing still works from here.
    await user.click(within(col).getByRole("tab", { name: "Ipanema beach" }));
    await user.click(within(col).getByRole("button", { name: "Lily pad: ready to place" }));
    await user.click(within(screen.getByRole("dialog", { name: "Lily pad" })).getByRole("button", { name: "Place in Rio" }));
    await waitFor(async () => expect(await db.farm.get("placed:lilypad")).toMatchObject({ spot: "rio" }));
    // Esc doesn't open a menu here, and the nook (earned moments) is still there.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    expect(document.querySelector(".farm-nook")).toBeTruthy();
  });
});

it("Back returns to the page she came from", async () => {
  renderApp(["/goals", "/farm"], "2026-11-04");
  const user = userEvent.setup();
  await screen.findByRole("list", { name: "Places in Rio" });
  await user.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() => expect(currentUrl).toBe("/goals"));
});

it("Back still leaves the game after the nook's collection icon was used there (review v2)", async () => {
  await db.farm.put(startRow("dev-a", "2026-11-02"));
  renderApp(["/goals", "/farm"], "2026-11-04");
  const user = userEvent.setup();
  await screen.findByRole("list", { name: "Places in Rio" });
  await user.click(await screen.findByRole("link", { name: "Your sticker collection" }));
  await screen.findByRole("dialog", { name: "Menu" });
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull());
  await user.click(screen.getByRole("button", { name: "Back" }));
  await waitFor(() => expect(currentUrl).toBe("/goals"));
});

it("in an area the way back to the map is its exit (Esme, 2026-11-17: \"the exit of an area to be the way to go back to map\")", async () => {
  renderApp("/farm", "2026-11-04");
  const user = userEvent.setup();
  await user.click(within(await screen.findByRole("list", { name: "Places in Rio" })).getByRole("button", { name: "Fazenda" }));
  await screen.findByRole("heading", { level: 2, name: "Fazenda" });
  expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Back to the map" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Boat back to Rio" }));
  expect(await screen.findByRole("list", { name: "Places in Rio" })).toBeInTheDocument();
});

it("there is no sticker book: the game screen holds the map and the menu's hotbar (Esme, 2026-11-17)", async () => {
  renderApp("/farm", "2026-11-04");
  await screen.findByRole("list", { name: "Places in Rio" });
  expect(document.querySelector(".farm-book")).toBeNull();
  expect(document.querySelector(".game-screen .rio-map")).toBeTruthy();
  expect(within(screen.getByRole("navigation", { name: "Game menu" })).getAllByRole("button").map((b) => b.getAttribute("aria-label")))
    .toEqual(["Collection", "Wardrobe", "Map", "Noticeboard", "Friends"]);
  // The page's heading is there for screen readers only: the game fills the screen.
  expect(screen.getByRole("heading", { level: 1, name: "Esme's Rio" })).toHaveClass("visually-hidden");
  expect(document.querySelector(".app-shell")).toHaveClass("is-game");
});

it("the Collection: ready to place (place it in Rio) and not yet (a gentle hint)", async () => {
  await db.farm.bulkPut([startRow("dev-a", "2026-11-02"), seenRow("hi", "2026-11-02")]);
  // Fictional: a Mind to-do ticked since the start earns "seeds" (ready to place).
  await db.items.put({
    id: "t1", kind: "task", title: "Pretend task", links: [], areaId: "mind", priority: 2, status: "done",
    completedAt: "2026-11-03", createdAt: "2026-10-01", touchedAt: "2026-11-03",
  });
  await db.farm.put(seenRow("seeds-mind", "2026-11-03"));
  renderApp("/farm", "2026-11-04");
  const user = userEvent.setup();
  await collectionAt(user, "Fazenda");
  const ready = await screen.findByRole("button", { name: "Mind: seeds: ready to place" });

  await user.click(screen.getByRole("button", { name: "Mind: sprout: not yet" }));
  expect(screen.getByRole("dialog", { name: "Mind: sprout" })).toHaveTextContent("3 to-dos ticked off in Mind");

  await user.click(ready);
  await user.click(within(screen.getByRole("dialog", { name: "Mind: seeds" })).getByRole("button", { name: "Place in Rio" }));
  // New placements are in Rio: no fixed phase-1 spot (the slot comes from book order).
  await waitFor(async () => expect(await db.farm.get("placed:seeds-mind")).toMatchObject({ spot: "rio" }));
  expect(await screen.findByRole("button", { name: "Mind: seeds: placed in Rio" })).toBeInTheDocument();
});

it("Esc opens the menu and closes it again, focus going back where it was; never from a text field", async () => {
  await db.farm.put(startRow("dev-a", "2026-11-02"));
  renderApp("/farm", "2026-11-04");
  const user = userEvent.setup();
  const lagoa = within(await screen.findByRole("list", { name: "Places in Rio" })).getByRole("button", { name: "Lagoa house" });
  lagoa.focus();
  await user.keyboard("{Escape}");
  const menu = await screen.findByRole("dialog", { name: "Menu" });
  expect(within(menu).getByRole("tab", { name: "Collection" })).toHaveAttribute("aria-selected", "true");
  expect(within(menu).getByRole("tab", { name: "Collection" })).toHaveFocus();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull());
  expect(lagoa).toHaveFocus();
  // Typing somewhere (the search box): Esc is the search's, not the menu's.
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  const search = await screen.findByRole("dialog");
  await waitFor(() => expect(document.activeElement?.tagName).toMatch(/INPUT|TEXTAREA/));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
  expect(search).toBeTruthy();
});

it("/farm?menu=noticeboard opens the menu on the Noticeboard", async () => {
  await db.farm.put(startRow("dev-a", "2026-11-02"));
  renderApp("/farm?menu=noticeboard", "2026-11-04");
  const menu = await screen.findByRole("dialog", { name: "Menu" });
  expect(within(menu).getByRole("tab", { name: "Noticeboard" })).toHaveAttribute("aria-selected", "true");
  expect(within(menu).getByRole("tabpanel")).toHaveTextContent("Opens next: Clothing store");
  expect(within(menu).getByRole("tabpanel")).not.toHaveTextContent("All of Rio is open");
});

it("the nook's book icon opens the Collection", async () => {
  renderApp("/today", "2026-11-04");
  expect(await screen.findByRole("link", { name: "Your sticker collection" })).toHaveAttribute("href", "/farm?menu=collection");
});

describe("Esme's Rio on the farm page", () => {
  const places = () => screen.findByRole("list", { name: "Places in Rio" });

  it("on a fresh farm the map shows; opening the Lagoa house shows it and notes the visit; back, it's no longer new", async () => {
    renderApp("/farm", "2026-11-04");
    const user = userEvent.setup();
    const list = await places();
    expect(within(list).getAllByRole("button")).toHaveLength(21);
    const lagoa = within(list).getByRole("button", { name: "Lagoa house" });
    expect(lagoa).toHaveAttribute("data-status", "new");
    expect(within(list).getByRole("button", { name: "Barraca" })).toHaveAttribute("data-status", "next");
    await user.click(lagoa);
    expect(await screen.findByRole("heading", { level: 2, name: "Lagoa house" })).toBeInTheDocument();
    await waitFor(async () => expect(await db.farm.get("visited:lagoa-house")).toMatchObject({ area: "lagoa-house", date: "2026-11-04" }));
    await user.click(screen.getByRole("button", { name: "Back to the map" }));
    await waitFor(async () => expect(within(await places()).getByRole("button", { name: "Lagoa house" })).toHaveAttribute("data-status", "open"));
  });

  it("the hotbar's Map goes back to the city from an area", async () => {
    renderApp("/farm", "2026-11-04");
    const user = userEvent.setup();
    await user.click(within(await places()).getByRole("button", { name: "Fazenda" }));
    await screen.findByRole("heading", { level: 2, name: "Fazenda" });
    await user.click(within(screen.getByRole("navigation", { name: "Game menu" })).getByRole("button", { name: "Map" }));
    expect(await places()).toBeInTheDocument();
  });

  it("placing an earned pond sticker shows it at Ipanema beach", async () => {
    await db.farm.bulkPut([startRow("dev-a", "2026-11-02"), seenRow("hi", "2026-11-02"), seenRow("lilypad", "2026-11-03")]);
    renderApp("/farm", "2026-11-04");
    const user = userEvent.setup();
    await collectionAt(user, "Ipanema beach");
    await user.click(await screen.findByRole("button", { name: "Lily pad: ready to place" }));
    await user.click(within(screen.getByRole("dialog", { name: "Lily pad" })).getByRole("button", { name: "Place in Rio" }));
    await waitFor(async () => expect(await db.farm.get("placed:lilypad")).toMatchObject({ spot: "rio" }));
    await user.keyboard("{Escape}{Escape}");
    await user.click(within(await places()).getByRole("button", { name: "Ipanema beach" }));
    expect(within(await screen.findByRole("list", { name: "Stickers here" })).getByText("Lily pad")).toBeInTheDocument();
  });

  it("an earned orchard sticker waits in the collection (its place in Rio opens later) and still counts", async () => {
    const orchard = COLLECTION.find((s) => s.group === "orchard")!;
    await db.farm.bulkPut([startRow("dev-a", "2026-11-02"), seenRow("hi", "2026-11-02"), seenRow(orchard.key, "2026-11-03")]);
    renderApp("/farm", "2026-11-04");
    const user = userEvent.setup();
    await waitFor(() => expect(document.querySelector("[data-earned]")).toHaveAttribute("data-earned", "2"));
    await collectionAt(user, "Jardim Botânico");
    await user.click(await screen.findByRole("button", { name: `${orchard.name}: ready to place` }));
    const card = screen.getByRole("dialog", { name: orchard.name });
    expect(card).toHaveTextContent("Its place in Rio opens later");
    expect(within(card).queryByRole("button", { name: "Place in Rio" })).toBeNull();
  });

  it("from day 14 an orchard sticker is placed at the Jardim Botanico (phase 2a); it was never lost", async () => {
    // Fictional: the farm started on 22 October 2026, so 4 November is day 14.
    await db.farm.bulkPut([startRow("dev-a", "2026-10-22"), seenRow("hi", "2026-10-22"), seenRow("sapling", "2026-10-23")]);
    renderApp("/farm", "2026-11-04");
    const user = userEvent.setup();
    await waitFor(async () => expect(within(await places()).getByRole("button", { name: "Jardim Botânico" })).toHaveAttribute("data-status", "new"));
    await collectionAt(user, "Jardim Botânico");
    await user.click(await screen.findByRole("button", { name: "Sapling: ready to place" }));
    await user.click(within(screen.getByRole("dialog", { name: "Sapling" })).getByRole("button", { name: "Place in Rio" }));
    await waitFor(async () => expect(await db.farm.get("placed:sapling")).toMatchObject({ spot: "rio" }));
    await user.keyboard("{Escape}{Escape}");
    await user.click(within(await places()).getByRole("button", { name: "Jardim Botânico" }));
    expect(within(await screen.findByRole("list", { name: "Stickers here" })).getByText("Sapling")).toBeInTheDocument();
   }, 15000);

  it("an aquarium sticker waits until the sea off Arpoador opens on day 30 (Esme, 2026-11-16)", async () => {
    const fish = COLLECTION.find((s) => s.group === "aquarium")!;
    // Fictional: the farm started on 6 October 2026; 3 November is day 29, 4 November day 30.
    const rows = [startRow("dev-a", "2026-10-06"), seenRow("hi", "2026-10-06"), seenRow(fish.key, "2026-10-07")];
    await db.farm.bulkPut(rows);
    const { unmount } = renderApp("/farm", "2026-11-03");
    let user = userEvent.setup();
    await collectionAt(user, "Ipanema beach", 1);
    await user.click(await screen.findByRole("button", { name: `${fish.name}: ready to place` }));
    let card = screen.getByRole("dialog", { name: fish.name });
    expect(card).toHaveTextContent("Its place in Rio opens later");
    expect(within(card).queryByRole("button", { name: "Place in Rio" })).toBeNull();
    unmount();

    renderApp("/farm", "2026-11-04");
    user = userEvent.setup();
    await collectionAt(user, "Ipanema beach", 1);
    await user.click(await screen.findByRole("button", { name: `${fish.name}: ready to place` }));
    card = screen.getByRole("dialog", { name: fish.name });
    await user.click(within(card).getByRole("button", { name: "Place in Rio" }));
    await waitFor(async () => expect(await db.farm.get(`placed:${fish.key}`)).toMatchObject({ spot: "rio" }));
    await user.keyboard("{Escape}{Escape}");
    await user.click(within(await places()).getByRole("button", { name: "Ipanema beach" }));
    await user.click(await screen.findByRole("button", { name: "Swim out to Arpoador" }));
    expect(within(await screen.findByRole("list", { name: "Stickers here" })).getByText(fish.name)).toBeInTheDocument();
  });

  it("a sticker placed on the old farm stays placed and shows in its Rio area", async () => {
    await db.farm.bulkPut([startRow("dev-a", "2026-11-02"), placedRow("hen", "hen", "2026-11-03")]);
    renderApp("/farm", "2026-11-04");
    const user = userEvent.setup();
    await user.click(within(await places()).getByRole("button", { name: "Fazenda" }));
    expect(within(await screen.findByRole("list", { name: "Stickers here" })).getByText("Hen")).toBeInTheDocument();
    expect(await db.farm.get("placed:hen")).toMatchObject({ spot: "hen" }); // never rewritten
  });
});

it("a character's Wardrobe: pick one unlocked accessory (synced)", async () => {
  // Fictional: five stickers seen, so Bap has arrived and the straw sun hat (5) is unlocked.
  await db.farm.bulkPut([startRow("dev-a", "2026-11-02"), ...["hi", "seeds-mind", "seeds-art", "seeds-body", "daisy"].map((k) => seenRow(k, "2026-11-03"))]);
  renderApp("/farm", "2026-11-04");
  const user = userEvent.setup();
  expect(await screen.findByText("Caetano has moved in!")).toBeInTheDocument();
  await waitFor(async () => expect(await db.farm.get("arrived:bap")).toBeTruthy());
  await openMenu(user, "Friends");
  await user.click(within(screen.getByLabelText("Who lives here")).getByRole("button", { name: "Caetano" }));
  const wardrobe = screen.getByRole("group", { name: "Wardrobe" });
  expect(within(wardrobe).getAllByRole("button").map((b) => b.textContent)).toEqual(["Nothing", "Straw sun hat"]);
  await user.click(within(wardrobe).getByRole("button", { name: "Straw sun hat" }));
  await waitFor(async () => expect(await db.farm.get("outfit:bap")).toMatchObject({ item: "A1" }));
});

it("outfits: she picks, any time; a new unlock is offered, never put on for her (Esme, 2026-11-04)", async () => {
  // Fictional: fifteen stickers seen, so the sun hat (5) and the neckerchief (15) are unlocked.
  const keys = ["hi", "seeds-mind", "seeds-art", "seeds-body", "seeds-writing", "seeds-content", "seeds-tech", "seeds-production",
    "seeds-admin", "sprout-mind", "sprout-art", "sprout-body", "daisy", "hen", "lilypad"];
  await db.farm.bulkPut([startRow("dev-a", "2026-11-02"), ...keys.map((k) => seenRow(k, "2026-11-03"))]);
  renderApp("/farm", "2026-11-04");
  const user = userEvent.setup();
  await waitFor(async () => expect(await db.farm.get("arrived:bap")).toBeTruthy());
  // Nothing is worn until she picks: no outfit is written for anyone.
  await new Promise((r) => setTimeout(r, 300));
  expect((await farmRows()).filter((r) => r.kind === "outfit")).toEqual([]);
  await openMenu(user, "Friends");
  await user.click(within(screen.getByLabelText("Who lives here")).getByRole("button", { name: "Caetano" }));
  const wardrobe = screen.getByRole("group", { name: "Wardrobe" });
  expect(within(wardrobe).getByRole("button", { name: "Nothing" })).toHaveAttribute("aria-pressed", "true");
  // She picks one, then another, then nothing: each time it's her choice, one at a time.
  await user.click(within(wardrobe).getByRole("button", { name: "Straw sun hat" }));
  await waitFor(async () => expect(await db.farm.get("outfit:bap")).toMatchObject({ item: "A1" }));
  await user.click(within(wardrobe).getByRole("button", { name: "Neckerchief" }));
  await waitFor(async () => expect(await db.farm.get("outfit:bap")).toMatchObject({ item: "A2" }));
  expect(within(wardrobe).getByRole("button", { name: "Neckerchief" })).toHaveAttribute("aria-pressed", "true");
  expect(within(wardrobe).getByRole("button", { name: "Straw sun hat" })).toHaveAttribute("aria-pressed", "false");
  await user.click(within(wardrobe).getByRole("button", { name: "Nothing" }));
  await waitFor(async () => expect(await db.farm.get("outfit:bap")).toMatchObject({ item: null }));
  // Mr Cat (id domino), never dressed by her, still wears nothing.
  expect(await db.farm.get("outfit:domino")).toBeUndefined();
});

it("friends arrive by day too: with no stickers but Welcome, all five are there on day 120; Duvet is retired and never comes (Esme, 2026-11-17)", async () => {
  // Fictional: the farm started on 7 July 2026; 3 November is day 120.
  await db.farm.put(startRow("dev-a", "2026-07-07"));
  renderApp("/farm", "2026-11-03");
  await waitFor(async () => expect(await db.farm.get("arrived:crumpet")).toBeTruthy());
  await openMenu(userEvent.setup(), "Friends");
  expect(within(screen.getByLabelText("Who lives here")).getAllByRole("button").map((b) => b.textContent)).toEqual(
    ["Mr Cat", "Caetano", "Pupup", "Bebe", "Cereal"],
  );
  expect(await db.farm.get("arrived:duvet")).toBeUndefined();
  expect(screen.queryByText("Duvet has moved in!")).toBeNull();
});

it("Duvet already moved in on this device before it was retired: the row is kept, but Duvet is shown nowhere", async () => {
  await db.farm.bulkPut([startRow("dev-a", "2026-07-07"), { id: "arrived:duvet", kind: "arrived", character: "duvet", date: "2026-11-01" } as never]);
  renderApp("/farm", "2026-11-03");
  const user = userEvent.setup();
  await openMenu(user, "Friends");
  const here = within(screen.getByLabelText("Who lives here")).getAllByRole("button").map((b) => b.textContent);
  expect(here).not.toContain("Duvet");
  expect(here).toContain("Cereal");
  await user.click(screen.getByRole("tab", { name: "Noticeboard" }));
  expect(screen.getByRole("tabpanel")).not.toHaveTextContent("Duvet");
  expect(screen.queryByText("Duvet has moved in!")).toBeNull();
  expect(await db.farm.get("arrived:duvet")).toMatchObject({ character: "duvet" }); // nothing taken away
});

it("on the Journal, Bap (once arrived) takes the nook", async () => {
  await db.farm.bulkPut([startRow("dev-a", "2026-11-02"), ...["hi", "seeds-mind", "seeds-art", "seeds-body", "daisy"].map((k) => seenRow(k, "2026-11-03"))]);
  renderApp("/journal/check-in", "2026-11-04");
  await waitFor(() => expect(document.querySelector(".farm-nook")).toHaveAttribute("data-host", "bap"));
});

it("every sticker moment waits while she's on the Journal, whatever earned it, and plays once she leaves (review I5)", async () => {
  await db.farm.put(startRow("dev-a", "2026-11-02"));
  // Fictional: a Mind to-do ticked since the start (not a journal sticker) and the Welcome.
  await db.items.put({
    id: "t1", kind: "task", title: "Pretend task", links: [], areaId: "mind", priority: 2, status: "done",
    completedAt: "2026-11-03", createdAt: "2026-10-01", touchedAt: "2026-11-03",
  });
  renderApp("/journal/check-in", "2026-11-04");
  await screen.findByRole("heading", { level: 1, name: "Journal" });
  await new Promise((r) => setTimeout(r, 1500));
  expect(await db.farm.get("seen:hi")).toBeUndefined();
  expect(await db.farm.get("seen:seeds-mind")).toBeUndefined();
  const user = userEvent.setup();
  await user.click(within(document.querySelector("nav[aria-label='Main']") as HTMLElement).getByRole("link", { name: "Goals" }));
  await waitFor(async () => expect(await db.farm.get("seen:seeds-mind")).toBeTruthy(), { timeout: 4000 });
});

it("placed stickers stay placed (nothing is lost) even with no data behind them", async () => {
  await db.farm.bulkPut([startRow("dev-a", "2026-11-02"), placedRow("hen", "hen", "2026-11-03")]);
  renderApp("/farm", "2026-11-04");
  await waitFor(() => expect(document.querySelector("[data-earned]")).toHaveAttribute("data-earned", "2")); // hen + Welcome
});

describe("the monthly pop-in", () => {
  it("shows every sticker one by one", async () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter>
        <StickerPopIn stickers={["seeds-mind", "hen", "daisy"]} />
      </MemoryRouter>,
    );
    const el = document.querySelector(".farm-popin")!;
    const frames = async (n: number) => {
      for (let i = 0; i < n; i++) await act(async () => vi.advanceTimersByTime(100));
    };
    expect(el).toHaveAttribute("data-shown", "0");
    await frames(1);
    expect(el).toHaveAttribute("data-shown", "1");
    await frames(3); // its sparkle frames
    expect(el).toHaveAttribute("data-shown", "1");
    await frames(1);
    expect(el).toHaveAttribute("data-shown", "2");
    await frames(10);
    expect(el).toHaveAttribute("data-shown", "3");
  });
});
