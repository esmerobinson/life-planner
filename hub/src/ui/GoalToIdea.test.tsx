import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createGoal, goalToItem } from "../data/repo";
import { currentUrl, renderApp } from "../test/renderApp";

// A goal changed back to an idea (or a to-do). Pretend data only.
const TODAY = "2026-11-02";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});
afterEach(() => vi.useRealTimers());

const pretendGoal = () =>
  createGoal(
    {
      title: "Pretend kite festival", areaId: "art", kind: "finite", deadline: "2026-11-30", monthlyTarget: 3,
      notes: "Pretend goal notes", why: "Pretend reason it matters", cadence: "Pretend: twice a week",
    },
    "2026-10-01",
  );

describe("Change to → Idea for a goal (data)", () => {
  it("keeps the title, area and notes; no due date; the goal, with its goal-only data, goes to the Bin", async () => {
    const g = await pretendGoal();
    const id = await goalToItem(g.id, "idea", TODAY);
    const idea = (await db.items.get(id))!;
    expect(idea).toMatchObject({ kind: "idea", title: "Pretend kite festival", areaId: "art", notes: "Pretend goal notes", status: "open" });
    expect(idea.due).toBeUndefined();
    const binned = (await db.goals.get(g.id))!;
    expect(binned).toMatchObject({
      status: "deleted", deletedAt: TODAY, why: "Pretend reason it matters", cadence: "Pretend: twice a week", deadline: "2026-11-30", monthlyTarget: 3,
    });
  });

  it("→ To-do keeps the deadline too; a binned goal can't be changed again", async () => {
    const g = await pretendGoal();
    const id = await goalToItem(g.id, "task", TODAY);
    expect(await db.items.get(id)).toMatchObject({ kind: "task", title: "Pretend kite festival", notes: "Pretend goal notes", due: "2026-11-30" });
    await expect(goalToItem(g.id, "idea", TODAY)).rejects.toThrow();
  });
});

describe("Change to → Idea in the goal's panel", () => {
  it("Edit → Type → Idea: an idea with the goal's title, area and notes; the goal is in the Bin; Undo restores the goal and removes the idea", async () => {
    const g = await pretendGoal();
    renderApp(`/goals?open=${g.id}`, TODAY);
    const panel = within(await screen.findByRole("complementary", { name: "Pretend kite festival" }));
    await userEvent.click(panel.getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(panel.getByLabelText("Type"), "idea");
    await userEvent.click(panel.getByRole("button", { name: "Done" }));

    await vi.waitFor(async () => expect((await db.goals.get(g.id))!.status).toBe("deleted"));
    const [idea] = await db.items.toArray();
    expect(idea).toMatchObject({ kind: "idea", title: "Pretend kite festival", areaId: "art", notes: "Pretend goal notes", status: "open" });
    // The panel now shows the idea, and says where the goal went.
    await vi.waitFor(() => expect(currentUrl).toBe(`/goals?open=${idea.id}`));
    expect(await screen.findByText(/Changed to an idea; the goal is in the Bin/)).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await vi.waitFor(async () => expect((await db.goals.get(g.id))!.status).toBeUndefined());
    expect(await db.goals.get(g.id)).toMatchObject({ why: "Pretend reason it matters", deadline: "2026-11-30" });
    expect((await db.items.get(idea.id))!.status).toBe("deleted"); // the idea goes to the Bin, not destroyed
    await vi.waitFor(() => expect(currentUrl).toBe(`/goals?open=${g.id}`)); // the goal is open again
    expect(await screen.findByRole("complementary", { name: "Pretend kite festival" })).toBeInTheDocument();
  });

  it("Edit → Type → To-do: a to-do with the title, area, notes and the deadline shown", async () => {
    const g = await pretendGoal();
    renderApp(`/goals?open=${g.id}`, TODAY);
    const panel = within(await screen.findByRole("complementary", { name: "Pretend kite festival" }));
    await userEvent.click(panel.getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(panel.getByLabelText("Type"), "task");
    expect(panel.getByLabelText("Deadline")).toHaveValue("2026-11-30");
    await userEvent.click(panel.getByRole("button", { name: "Done" }));
    await vi.waitFor(async () => expect((await db.goals.get(g.id))!.status).toBe("deleted"));
    const [todo] = await db.items.toArray();
    expect(todo).toMatchObject({ kind: "task", title: "Pretend kite festival", areaId: "art", notes: "Pretend goal notes", due: "2026-11-30" });
    expect(todo.sessions).toBeUndefined(); // a plain to-do, not a project
    expect(await screen.findByText(/Changed to a to-do; the goal is in the Bin/)).toBeInTheDocument();
  });

  it("an idea has no deadline field", async () => {
    const g = await pretendGoal();
    renderApp(`/goals?open=${g.id}`, TODAY);
    const panel = within(await screen.findByRole("complementary", { name: "Pretend kite festival" }));
    await userEvent.click(panel.getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(panel.getByLabelText("Type"), "idea");
    expect(panel.queryByLabelText("Deadline")).toBeNull();
  });
});
