import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { db } from "../data/db";
import { renderApp } from "../test/renderApp";
import { StickerPopIn } from "./PopIn";
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
  expect(await screen.findByRole("heading", { level: 1, name: "Esme's Farm" })).toBeInTheDocument();
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
});

it("the book opens; slots show collected, ready to place (place it), and not yet (a gentle hint)", async () => {
  await db.farm.bulkPut([startRow("dev-a", "2026-11-02"), seenRow("hi", "2026-11-02")]);
  // Fictional: a Mind to-do ticked since the start earns "seeds" (ready to place).
  await db.items.put({
    id: "t1", kind: "task", title: "Pretend task", links: [], areaId: "mind", priority: 2, status: "done",
    completedAt: "2026-11-03", createdAt: "2026-10-01", touchedAt: "2026-11-03",
  });
  await db.farm.put(seenRow("seeds-mind", "2026-11-03"));
  renderApp("/farm", "2026-11-04");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Open the book" }));
  await waitFor(() => expect(document.querySelector(".farm-book")).toHaveAttribute("data-spread", "0"));
  await user.click(await screen.findByRole("button", { name: "Next page" }));
  const ready = await screen.findByRole("button", { name: "Mind: seeds: ready to place" });
  expect(document.querySelector(".farm-book")).toHaveAttribute("data-spread", "1");
  // The farm highlights the beds while their page is open.
  expect(document.querySelector(".farm-scene")).toHaveAttribute("data-highlight", "beds");

  await user.click(screen.getByRole("button", { name: "Mind: sprout: not yet" }));
  expect(screen.getByRole("dialog", { name: "Mind: sprout" })).toHaveTextContent("3 to-dos ticked off in Mind");

  await user.click(ready);
  await user.click(within(screen.getByRole("dialog", { name: "Mind: seeds" })).getByRole("button", { name: "Place on the farm" }));
  await waitFor(async () => expect(await db.farm.get("placed:seeds-mind")).toMatchObject({ spot: "seeds-mind" }));
  expect(await screen.findByRole("button", { name: "Mind: seeds: on the farm" })).toBeInTheDocument();
});

it("arrow keys turn the pages", async () => {
  await db.farm.put(startRow("dev-a", "2026-11-02"));
  renderApp("/farm", "2026-11-04");
  await screen.findByRole("button", { name: "Open the book" });
  const user = userEvent.setup();
  await user.keyboard("{ArrowRight}");
  await waitFor(() => expect(document.querySelector(".farm-book")).toHaveAttribute("data-spread", "0"));
  await user.keyboard("{ArrowRight}");
  await waitFor(() => expect(document.querySelector(".farm-book")).toHaveAttribute("data-spread", "1"));
  await user.keyboard("{ArrowLeft}");
  await waitFor(() => expect(document.querySelector(".farm-book")).toHaveAttribute("data-spread", "0"));
});

it("a tap on a farm zone opens the book at its page", async () => {
  await db.farm.put(startRow("dev-a", "2026-11-02"));
  renderApp("/farm", "2026-11-04");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Open the book at the pond" }));
  await waitFor(() => expect(document.querySelector(".farm-book")).toHaveAttribute("data-spread", "5"), { timeout: 3000 });
  expect(document.querySelector(".farm-scene")).toHaveAttribute("data-highlight", "glasshouse pond");
});

it("a character's Wardrobe: pick one unlocked accessory (synced)", async () => {
  // Fictional: five stickers seen, so Bap has arrived and the straw sun hat (5) is unlocked.
  await db.farm.bulkPut([startRow("dev-a", "2026-11-02"), ...["hi", "seeds-mind", "seeds-art", "seeds-body", "daisy"].map((k) => seenRow(k, "2026-11-03"))]);
  renderApp("/farm", "2026-11-04");
  const user = userEvent.setup();
  expect(await screen.findByText("Bap has moved in!")).toBeInTheDocument();
  await waitFor(async () => expect(await db.farm.get("arrived:bap")).toBeTruthy());
  await user.click(within(screen.getByLabelText("Who lives here")).getByRole("button", { name: "Bap" }));
  const wardrobe = screen.getByRole("group", { name: "Wardrobe" });
  expect(within(wardrobe).getAllByRole("button").map((b) => b.textContent)).toEqual(["Nothing", "Straw sun hat"]);
  await user.click(within(wardrobe).getByRole("button", { name: "Straw sun hat" }));
  await waitFor(async () => expect(await db.farm.get("outfit:bap")).toMatchObject({ item: "A1" }));
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
