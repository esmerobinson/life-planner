import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createGoal, createItem } from "../data/repo";
import { currentUrl, renderApp } from "../test/renderApp";
import { clampPanelWidth, PANEL_DEFAULT_WIDTH, PANEL_MIN_WIDTH, PANEL_WIDTH_KEY } from "./SidePanel";

const TODAY = "2026-10-28";
const findPanel = (name: string | RegExp = /\S/) => screen.findByRole("complementary", { name });
const queryPanel = () => screen.queryByRole("complementary", { name: /\S/ });

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const task = (title: string, extra: Record<string, unknown> = {}) =>
  createItem({ kind: "task", title, areaId: "art", priority: 2, ...extra }, TODAY);

describe("opening and closing the side panel", () => {
  it("clicking a strip title opens it; the URL has ?open=<id>; the list stays behind it", async () => {
    const a = await task("Pretend sketch");
    renderApp("/area/art", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Pretend sketch" }));
    expect(await findPanel("Pretend sketch")).toBeInTheDocument();
    expect(currentUrl).toBe(`/area/art?open=${a.id}`);
    expect(screen.getByRole("list", { name: "To-dos" })).toBeInTheDocument();
  });

  it("clicking elsewhere in the strip body opens it too, but the tick box and icons do not", async () => {
    await task("Body click", { due: "2026-10-30" });
    renderApp("/area/art", TODAY);
    const row = (await screen.findByRole("button", { name: "Body click" })).closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Move to: Body click" }));
    expect(queryPanel()).toBeNull();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(row.querySelector(".strip-meta") as HTMLElement);
    expect(await findPanel("Body click")).toBeInTheDocument();
  });

  it("clicking another title swaps the content; Close closes; Back after a swap closes too", async () => {
    const a = await task("First pretend");
    const b = await task("Second pretend");
    renderApp(["/", "/area/art"], TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "First pretend" }));
    await findPanel("First pretend");
    await userEvent.click(screen.getByRole("button", { name: "Second pretend" }));
    expect(await findPanel("Second pretend")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "First pretend" })).toBeNull();
    expect(currentUrl).toBe(`/area/art?open=${b.id}`);
    // Back (the router going back one step) closes it rather than stepping to the first item.
    await userEvent.click(within(await findPanel()).getByRole("button", { name: "Close" }));
    await vi.waitFor(() => expect(queryPanel()).toBeNull());
    expect(currentUrl).toBe("/area/art");
    expect(a.id).not.toBe(b.id);
  });

  it("Escape closes it", async () => {
    const a = await task("Escape me");
    renderApp(`/area/art?open=${a.id}`, TODAY);
    await findPanel("Escape me");
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(queryPanel()).toBeNull());
    expect(currentUrl).toBe("/area/art");
  });

  it("Escape with an icon menu open closes only the menu", async () => {
    const a = await task("Menu first");
    renderApp(`/area/art?open=${a.id}`, TODAY);
    await findPanel("Menu first");
    const row = screen.getByRole("list", { name: "To-dos" });
    await userEvent.click(within(row).getByRole("button", { name: "Move to: Menu first" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Move Menu first to" })).toBeNull();
    expect(queryPanel()).not.toBeNull();
  });

  it("opened from a link (no history of ours), Close stays on the page without the panel", async () => {
    const g = await createGoal({ title: "Linked goal", areaId: "art", kind: "practice" }, TODAY);
    renderApp(`/goals?open=${g.id}`, TODAY);
    await userEvent.click(within(await findPanel("Linked goal")).getByRole("button", { name: "Close" }));
    await vi.waitFor(() => expect(queryPanel()).toBeNull());
    expect(currentUrl).toBe("/goals");
  });

  it("an unknown or archived id opens nothing", async () => {
    const a = await task("Archived one");
    await db.items.update(a.id, { status: "archived" });
    renderApp(`/area/art?open=${a.id}`, TODAY);
    await screen.findByRole("heading", { level: 1, name: "Art" });
    expect(queryPanel()).toBeNull();
  });
});

describe("resizing", () => {
  it("clamps to 360px and 90% of the window", () => {
    expect(clampPanelWidth(100, 1280)).toBe(PANEL_MIN_WIDTH);
    expect(clampPanelWidth(2000, 1280)).toBe(1152);
    expect(clampPanelWidth(500.4, 1280)).toBe(500);
    expect(clampPanelWidth(NaN, 1280)).toBe(PANEL_DEFAULT_WIDTH);
    expect(clampPanelWidth(500, 300)).toBe(PANEL_MIN_WIDTH);
  });

  it("dragging the left edge widens it and the width is remembered on this device", async () => {
    const a = await task("Wide one");
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1280);
    const first = renderApp(`/area/art?open=${a.id}`, TODAY);
    const aside = await findPanel("Wide one");
    expect(aside.style.width).toBe(`min(${PANEL_DEFAULT_WIDTH}px, 92vw)`);
    const handle = screen.getByRole("separator", { name: "Resize panel" });
    fireEvent.pointerDown(handle, { clientX: 820, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 700, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 700, pointerId: 1 });
    expect(aside.style.width).toBe("min(580px, 92vw)");
    expect(localStorage.getItem(PANEL_WIDTH_KEY)).toBe("580");
    // Dragging past the limits clamps.
    fireEvent.pointerDown(handle, { clientX: 700, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 1270, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 1270, pointerId: 1 });
    expect(localStorage.getItem(PANEL_WIDTH_KEY)).toBe(String(PANEL_MIN_WIDTH));
    // The keyboard works too.
    handle.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(localStorage.getItem(PANEL_WIDTH_KEY)).toBe(String(PANEL_MIN_WIDTH + 16));
    first.unmount();
    renderApp(`/area/art?open=${a.id}`, TODAY);
    expect((await findPanel("Wide one")).style.width).toBe(`min(${PANEL_MIN_WIDTH + 16}px, 92vw)`);
  });

  it("works when storage is blocked (default width, nothing thrown)", async () => {
    const a = await task("No storage");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const aside = await findPanel("No storage");
    expect(aside.style.width).toBe(`min(${PANEL_DEFAULT_WIDTH}px, 92vw)`);
    const handle = screen.getByRole("separator", { name: "Resize panel" });
    handle.focus();
    await userEvent.keyboard("{ArrowLeft}");
    expect(aside.style.width).toBe(`min(${PANEL_DEFAULT_WIDTH + 16}px, 92vw)`);
  });
});

describe("the task panel", () => {
  it("shows Type, Area, Due, Goal and Priority; the title saves on blur", async () => {
    const g = await createGoal({ title: "Pretend goal", areaId: "art", kind: "practice" }, TODAY);
    const a = await task("Old title", { due: "2026-10-30", goalId: g.id });
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Old title"));
    expect(p.getByText("To-do")).toBeInTheDocument();
    expect(p.getByText("Art")).toBeInTheDocument();
    expect(p.getByText("Fri 30 Oct")).toBeInTheDocument();
    expect(p.getByRole("button", { name: "Pretend goal" })).toBeInTheDocument();
    const title = p.getByLabelText("Title");
    await userEvent.clear(title);
    await userEvent.type(title, "New pretend title");
    title.blur();
    await vi.waitFor(async () => expect((await db.items.get(a.id))!.title).toBe("New pretend title"));
    expect(await screen.findByRole("button", { name: "New pretend title" })).toBeInTheDocument();
  });

  it("typing in the title then closing with Escape still saves it", async () => {
    const a = await task("Before");
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Before"));
    fireEvent.change(p.getByLabelText("Title"), { target: { value: "After" } });
    await userEvent.keyboard("{Escape}");
    await vi.waitFor(() => expect(queryPanel()).toBeNull());
    await vi.waitFor(async () => expect((await db.items.get(a.id))!.title).toBe("After"));
  });

  it("notes save after a pause and when the panel closes, kept exactly as typed", async () => {
    const a = await task("Noted");
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Noted"));
    fireEvent.change(p.getByLabelText("Notes"), { target: { value: "## Heading\n- [ ] pretend" } });
    await vi.waitFor(async () => expect((await db.items.get(a.id))!.notes).toBe("## Heading\n- [ ] pretend"), { timeout: 3000 });
    fireEvent.change(p.getByLabelText("Notes"), { target: { value: "closing now" } });
    await userEvent.click(p.getByRole("button", { name: "Close" }));
    await vi.waitFor(async () => expect((await db.items.get(a.id))!.notes).toBe("closing now"));
  });

  it("Edit: setting a goal makes the task appear in the goal's panel; Milestone flags it", async () => {
    const g = await createGoal({ title: "Pretend goal", areaId: "art", kind: "practice" }, TODAY);
    const a = await task("Link me");
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Link me"));
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    expect(p.queryByLabelText("Milestone")).toBeNull();
    await userEvent.selectOptions(p.getByLabelText("Goal"), g.id);
    await userEvent.click(p.getByLabelText("Milestone"));
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    await vi.waitFor(async () => expect(await db.items.get(a.id)).toMatchObject({ goalId: g.id, milestone: true }));
    await userEvent.click(await p.findByRole("button", { name: "Pretend goal" }));
    const gp = within(await findPanel("Pretend goal"));
    expect(within(gp.getByRole("list", { name: "To come" })).getByText("Link me")).toBeInTheDocument();
  });

  it("Edit: changing a to-do into an idea drops its due date; Cancel discards", async () => {
    const a = await task("Turn me", { due: "2026-11-01" });
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Turn me"));
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(p.getByLabelText("Area"), "writing");
    await userEvent.click(p.getByRole("button", { name: "Cancel" }));
    expect(p.getByText("Art")).toBeInTheDocument();
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(p.getByLabelText("Type"), "idea");
    expect(p.queryByLabelText("Due")).toBeNull();
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    await vi.waitFor(async () => expect((await db.items.get(a.id))!.kind).toBe("idea"));
    expect((await db.items.get(a.id))!.due).toBeUndefined();
    expect(p.getByText("Idea")).toBeInTheDocument();
  });

  it("on a phone the panel fills the screen with a Back arrow and no Close or resize", async () => {
    const a = await task("Phone task");
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const aside = await findPanel("Phone task");
    expect(aside).toHaveClass("is-full");
    const p = within(aside);
    expect(p.queryByRole("button", { name: "Close" })).toBeNull();
    expect(p.queryByRole("separator")).toBeNull();
    await userEvent.click(p.getByRole("button", { name: "Back" }));
    await vi.waitFor(() => expect(queryPanel()).toBeNull());
  });
});

describe("Mark as milestone (arrow menu)", () => {
  it("is offered only for a to-do with a goal, and toggles the flag shown on the strip", async () => {
    const g = await createGoal({ title: "Pretend goal", areaId: "art", kind: "practice" }, TODAY);
    await task("With goal", { goalId: g.id });
    await task("No goal");
    renderApp("/area/art", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "Move to: No goal" }));
    expect(screen.queryByRole("button", { name: "Mark as milestone" })).toBeNull();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Move to: With goal" }));
    await userEvent.click(screen.getByRole("button", { name: "Mark as milestone" }));
    await vi.waitFor(async () => expect((await db.items.toArray()).find((i) => i.title === "With goal")!.milestone).toBe(true));
    expect(await screen.findByRole("button", { name: /Milestone: ?With goal/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Move to: With goal" }));
    await userEvent.click(screen.getByRole("button", { name: "Unmark as milestone" }));
    expect(await screen.findByRole("button", { name: "With goal" })).toBeInTheDocument();
  });
});
