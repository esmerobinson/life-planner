import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createGoal } from "../data/repo";
import { currentUrl, renderApp } from "../test/renderApp";

// A goal changed to a project (fix round 1; her case is a Blender goal). Pretend data only.
const TODAY = "2026-11-02";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});
afterEach(() => vi.useRealTimers());

describe("Change to → Project for a goal", () => {
  it("Edit → Type → Project: a project with the goal's title, area, notes, deadline and target as sessions; the goal to the Bin; Undo", async () => {
    const g = await createGoal(
      { title: "Pretend blender scene", areaId: "art", kind: "finite", deadline: "2026-11-30", monthlyTarget: 6, notes: "Pretend goal notes" },
      "2026-10-01",
    );
    renderApp(`/goals?open=${g.id}`, TODAY);
    const panel = within(await screen.findByRole("complementary", { name: "Pretend blender scene" }));
    await userEvent.click(panel.getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(panel.getByLabelText("Type"), "project");
    expect(panel.getByLabelText("Deadline")).toHaveValue("2026-11-30");
    await userEvent.click(panel.getByRole("button", { name: "Done" }));

    await vi.waitFor(async () => expect((await db.goals.get(g.id))!.status).toBe("deleted"));
    const [p] = await db.items.toArray();
    expect(p).toMatchObject({
      kind: "task", title: "Pretend blender scene", areaId: "art", notes: "Pretend goal notes", due: "2026-11-30", status: "open",
    });
    expect(p.sessions).toHaveLength(6);
    // The panel now shows the project.
    await vi.waitFor(() => expect(currentUrl).toBe(`/goals?open=${p.id}`));
    expect(await screen.findByText("Project", { selector: ".peek-kicker" })).toBeInTheDocument();

    await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
    await vi.waitFor(async () => expect((await db.goals.get(g.id))!.status).toBeUndefined());
    expect((await db.items.get(p.id))!.status).toBe("deleted"); // the project goes to the Bin, not destroyed
    await vi.waitFor(() => expect(currentUrl).toBe(`/goals?open=${g.id}`)); // the goal is open again
    expect(await screen.findByRole("complementary", { name: "Pretend blender scene" })).toBeInTheDocument();
  });
});
