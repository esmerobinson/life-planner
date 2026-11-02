import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createGoal, createItem } from "../data/repo";
import { currentUrl, renderApp } from "../test/renderApp";

// Compact strips (Esme, 2026-11-02): "the info below an item should not all show on the
// list, it should just be clickable into, and have a small 'see more' if there is more info."
const TODAY = "2026-10-28";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});
afterEach(() => vi.useRealTimers());

const rowOf = (title: string) => screen.getByText(title, { selector: ".strip-title" }).closest("li") as HTMLElement;

describe("compact strips", () => {
  it("an idea's notes stay off the list; See more opens it in the side panel", async () => {
    const idea = await createItem(
      { kind: "idea", title: "Pretend zine", areaId: "content", priority: 2, notes: "A long pretend note about paper" },
      TODAY,
    );
    await createItem({ kind: "idea", title: "Bare idea", areaId: "content", priority: 2 }, TODAY);
    renderApp("/area/content", TODAY);
    await screen.findByText("Pretend zine", { selector: ".strip-title" });
    expect(screen.queryByText("A long pretend note about paper")).toBeNull();
    expect(within(rowOf("Bare idea")).queryByRole("button", { name: /See more/ })).toBeNull();
    await userEvent.click(within(rowOf("Pretend zine")).getByRole("button", { name: "See more: Pretend zine" }));
    expect(await screen.findByRole("complementary", { name: "Pretend zine" })).toBeInTheDocument();
    expect(currentUrl).toBe(`/area/content?open=${idea.id}`);
  });

  it("a to-do keeps its due line; blank notes do not count as more", async () => {
    await createItem({ kind: "task", title: "Pretend deadline", areaId: "art", priority: 2, due: "2026-10-30", notes: "  \n " }, TODAY);
    await createItem({ kind: "task", title: "Pretend tagged", areaId: "art", priority: 2, tags: ["home"] }, TODAY);
    renderApp("/area/art", TODAY);
    const row = (await screen.findByText("Pretend deadline", { selector: ".strip-title" })).closest("li")!;
    expect(within(row).getByText("Due Fri 30 Oct")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /See more/ })).toBeNull();
    expect(within(rowOf("Pretend tagged")).queryByText("#home")).toBeNull();
    expect(within(rowOf("Pretend tagged")).getByRole("button", { name: "See more: Pretend tagged" })).toBeInTheDocument();
  });

  it("tags are shown in the panel, since the strip no longer shows them", async () => {
    await createItem({ kind: "task", title: "Pretend tagged", areaId: "inbox", priority: 2, tags: ["home", "check"] }, TODAY);
    renderApp("/inbox", TODAY);
    await screen.findByText("Pretend tagged", { selector: ".strip-title" });
    expect(screen.queryByText("#home")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "See more: Pretend tagged" }));
    const panel = await screen.findByRole("complementary", { name: "Pretend tagged" });
    expect(within(panel).getByText("#home")).toBeInTheDocument();
    expect(within(panel).getByText("#check")).toBeInTheDocument();
  });

  it("the whole strip is openable (marked for the hover look); the tick box and icons do not open it", async () => {
    await createItem({ kind: "task", title: "Pretend strip", areaId: "art", priority: 2 }, TODAY);
    renderApp("/area/art", TODAY);
    await screen.findByText("Pretend strip", { selector: ".strip-title" });
    const row = rowOf("Pretend strip");
    expect(row).toHaveClass("openable");
    await userEvent.click(within(row).getByRole("button", { name: /^Schedule for: Pretend strip/ }));
    expect(screen.queryByRole("complementary", { name: /\S/ })).toBeNull();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(row);
    expect(await screen.findByRole("complementary", { name: "Pretend strip" })).toBeInTheDocument();
  });

  it("goal panel task lists are compact too", async () => {
    const g = await createGoal({ title: "Pretend goal", areaId: "art", kind: "practice" }, TODAY);
    await createItem({ kind: "task", title: "Pretend step", areaId: "art", priority: 2, goalId: g.id, notes: "Step detail" }, TODAY);
    renderApp(`/goals?open=${g.id}`, TODAY);
    const panel = within(await screen.findByRole("complementary", { name: "Pretend goal" }));
    const list = panel.getByRole("list", { name: "To come" });
    expect(within(list).queryByText("Step detail")).toBeNull();
    expect(within(list).getByRole("button", { name: "See more: Pretend step" })).toBeInTheDocument();
  });
});
