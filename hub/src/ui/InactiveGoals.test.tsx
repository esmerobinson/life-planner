import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { db } from "../data/db";
import { createGoal, createItem } from "../data/repo";
import { renderApp } from "../test/renderApp";

// Inactive goals (goals redesign) are hidden from Home, area pages and goal pickers, and
// shown on the Goals page only under Inactive. Fictional data only.

const TODAY = "2026-11-02";
beforeEach(async () => {
  await Promise.all([db.items.clear(), db.goals.clear()]);
});

it("an inactive goal is not on its area page", async () => {
  await createGoal({ title: "Pretend live", areaId: "art", kind: "practice" }, TODAY);
  await createGoal({ title: "Pretend resting", areaId: "art", kind: "practice", active: false }, TODAY);
  renderApp("/area/art", TODAY);
  expect(await screen.findByRole("link", { name: "Pretend live" })).toBeInTheDocument();
  expect(screen.queryByText("Pretend resting")).toBeNull();
});

it("an inactive goal is not offered in the Add form's goal picker, nor in a task's Goal select (unless it is the task's)", async () => {
  await createGoal({ title: "Pretend live", areaId: "art", kind: "practice" }, TODAY);
  const resting = await createGoal({ title: "Pretend resting", areaId: "art", kind: "practice", active: false }, TODAY);
  renderApp("/area/art", TODAY);
  await userEvent.click(await screen.findByRole("button", { name: "Add" }));
  const quick = within(document.querySelector("form.quick-add") as HTMLElement);
  await userEvent.selectOptions(quick.getByLabelText("Type"), "task");
  expect(await quick.findByRole("option", { name: "Pretend live" })).toBeInTheDocument();
  expect(quick.queryByRole("option", { name: "Pretend resting" })).toBeNull();

  const t = await createItem({ kind: "task", title: "Pretend linked", areaId: "art", priority: 2, goalId: resting.id }, TODAY);
  renderApp(`/area/art?open=${t.id}`, TODAY);
  const panel = within(await screen.findByRole("complementary", { name: "Pretend linked" }));
  await userEvent.click(panel.getByRole("button", { name: "Edit" }));
  const select = panel.getByLabelText("Goal");
  expect(within(select).getByRole("option", { name: "Pretend resting" })).toBeInTheDocument();
});
