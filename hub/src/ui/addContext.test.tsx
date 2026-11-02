import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createGoal } from "../data/repo";
import { renderApp } from "../test/renderApp";

// Esme, 2026-11-02: "The default area and type of addition … should be where add has
// launched from, if I'm in to dos for content, that is the default if I press add there".
const TODAY = "2026-10-28";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});
afterEach(() => vi.useRealTimers());

async function openAdd() {
  await userEvent.click(await screen.findByRole("button", { name: /^Add$/ }));
  const form = document.querySelector("form.quick-add") as HTMLElement;
  return within(form);
}

const preset = (f: Awaited<ReturnType<typeof openAdd>>) => ({
  type: (f.getByLabelText("Type") as HTMLSelectElement).value,
  area: (f.getByLabelText("Area") as HTMLSelectElement).value,
});

describe("the Add form opens pre-set from where Add was pressed", () => {
  it("an area page (All): that area, a to-do", async () => {
    renderApp("/area/content", TODAY);
    await screen.findByRole("heading", { name: "Content", level: 1 });
    expect(preset(await openAdd())).toEqual({ type: "task", area: "content" });
  });

  it.each([
    ["To-dos", "task"],
    ["Ideas", "idea"],
    ["Goals", "goal"],
  ])("an area page with %s shown: that area and that type", async (filter, type) => {
    renderApp("/area/content", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: filter }));
    expect(preset(await openAdd())).toEqual({ type, area: "content" });
  });

  it("Content › To-dos: the saved to-do lands in Content, with its notes", async () => {
    renderApp("/area/content", TODAY);
    await userEvent.click(await screen.findByRole("button", { name: "To-dos" }));
    const f = await openAdd();
    await userEvent.type(f.getByLabelText("Title"), "Pretend video edit");
    await userEvent.type(f.getByLabelText("Notes"), "Cut the intro");
    await userEvent.click(f.getByRole("button", { name: "Add item" }));
    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
    expect((await db.items.toArray())[0]).toMatchObject({
      kind: "task", areaId: "content", title: "Pretend video edit", notes: "Cut the intro",
    });
    expect(await screen.findByText("Pretend video edit", { selector: ".strip-title" })).toBeInTheDocument();
  });

  it("the Inbox: into the inbox, as Inbox capture works", async () => {
    renderApp("/inbox", TODAY);
    await screen.findByRole("heading", { name: "Inbox", level: 1 });
    const f = await openAdd();
    expect(preset(f)).toEqual({ type: "task", area: "inbox" });
    await userEvent.type(f.getByLabelText("Title"), "Pretend loose thought");
    await userEvent.click(f.getByRole("button", { name: "Add item" }));
    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
    expect((await db.items.toArray())[0]).toMatchObject({ kind: "task", areaId: "inbox" });
  });

  it("the Goals page: a goal, in the first area section shown", async () => {
    await createGoal({ title: "Pretend body goal", areaId: "body", kind: "practice" }, TODAY);
    await createGoal({ title: "Pretend art goal", areaId: "art", kind: "practice" }, TODAY);
    renderApp("/goals", TODAY);
    await screen.findByRole("heading", { name: "Art", level: 2 }); // Art comes before Body in the sidebar
    expect(preset(await openAdd())).toEqual({ type: "goal", area: "art" });
  });

  it("the Goals page with no goals yet: a goal in the first area shown there (Mind, goals redesign)", async () => {
    renderApp("/goals", TODAY);
    await screen.findByText("No goals yet.");
    expect(preset(await openAdd())).toEqual({ type: "goal", area: "mind" });
  });

  it("Today: a to-do (not pinned, as Today's Add never pinned)", async () => {
    renderApp("/today", TODAY);
    const f = await openAdd();
    expect(preset(f)).toEqual({ type: "task", area: "inbox" });
    await userEvent.type(f.getByLabelText("Title"), "Pretend errand");
    await userEvent.click(f.getByRole("button", { name: "Add item" }));
    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
    expect((await db.items.toArray())[0]).not.toHaveProperty("pinnedDate");
  });

  it("Home: a to-do", async () => {
    renderApp("/", TODAY);
    expect(preset(await openAdd())).toEqual({ type: "task", area: "inbox" });
  });

  it("both can still be changed; reopening on another page takes that page's defaults", async () => {
    renderApp("/area/art", TODAY);
    await screen.findByRole("heading", { name: "Art", level: 1 });
    let f = await openAdd();
    await userEvent.selectOptions(f.getByLabelText("Type"), "idea");
    await userEvent.selectOptions(f.getByLabelText("Area"), "mind");
    expect(preset(f)).toEqual({ type: "idea", area: "mind" });
    await userEvent.click(screen.getByRole("button", { name: /^Add$/ })); // close
    await userEvent.click(screen.getByRole("link", { name: /Writing/ }));
    await screen.findByRole("heading", { name: "Writing", level: 1 });
    f = await openAdd();
    expect(preset(f)).toEqual({ type: "task", area: "writing" });
  });
});
