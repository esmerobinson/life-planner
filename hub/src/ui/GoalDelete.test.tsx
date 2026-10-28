import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db } from "../data/db";
import * as repo from "../data/repo";
import { createGoal, createItem, listGoalBin } from "../data/repo";
import { AreaPage } from "./AreaPage";
import { GoalDetail } from "./GoalDetail";
import { GoalsPage } from "./GoalsPage";
import { QuickAdd } from "./QuickAdd";

const TODAY = "2026-10-28";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
  vi.restoreAllMocks();
});

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/goals" element={<GoalsPage today={TODAY} />} />
        <Route path="/goals/:id" element={<GoalDetail today={TODAY} />} />
        <Route path="/area/:areaId" element={<AreaPage today={TODAY} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Delete goal", () => {
  it("asks first; Cancel keeps the goal", async () => {
    const g = await createGoal({ title: "Pretend goal", areaId: "art", kind: "practice" }, TODAY);
    renderAt(`/goals/${g.id}`);
    await userEvent.click(await screen.findByRole("button", { name: "Delete goal" }));
    expect(screen.getByText("Delete this goal? You can restore it from the Bin.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/restore it from the Bin/)).toBeNull();
    expect((await db.goals.get(g.id))!.status).toBeUndefined();
  });

  it("Confirm sends it to the Bin and goes to Goals, where it is no longer listed; its tasks keep their goalId", async () => {
    const g = await createGoal({ title: "Pretend goal", areaId: "art", kind: "practice" }, TODAY);
    const t = await createItem({ kind: "task", title: "Pretend step", areaId: "art", priority: 2, goalId: g.id }, TODAY);
    renderAt(`/goals/${g.id}`);
    const del = await screen.findByRole("button", { name: "Delete goal" });
    expect(del).toHaveClass("btn-secondary");
    await userEvent.click(del);
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Goals" })).toBeInTheDocument();
    expect(screen.queryByText("Pretend goal")).toBeNull();
    expect((await listGoalBin()).map((x) => x.id)).toEqual([g.id]);
    expect((await db.items.get(t.id))!.goalId).toBe(g.id);
  });

  it("a deleted goal is gone from its area page and its detail page", async () => {
    const g = await createGoal({ title: "Hidden goal", areaId: "art", kind: "practice", monthlyTarget: 2 }, TODAY);
    await repo.deleteGoal(g.id, TODAY);
    const first = renderAt("/area/art");
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText("Hidden goal")).toBeNull();
    first.unmount();
    renderAt(`/goals/${g.id}`);
    expect(await screen.findByText("That goal does not exist.")).toBeInTheDocument();
  });

  it("a deleted goal is not offered in the Add form's goal picker", async () => {
    await createGoal({ title: "Live goal", areaId: "art", kind: "practice" }, TODAY);
    const g = await createGoal({ title: "Binned goal", areaId: "art", kind: "practice" }, TODAY);
    await repo.deleteGoal(g.id, TODAY);
    render(<QuickAdd today={TODAY} onAdded={() => {}} />);
    await userEvent.selectOptions(screen.getByLabelText("Area"), "art");
    const picker = screen.getByLabelText("Goal");
    await vi.waitFor(() => expect(within(picker).getByRole("option", { name: "Live goal" })).toBeInTheDocument());
    expect(within(picker).queryByRole("option", { name: "Binned goal" })).toBeNull();
  });

  it("a failed delete shows the calm message and stays", async () => {
    const g = await createGoal({ title: "Stubborn goal", areaId: "art", kind: "practice" }, TODAY);
    vi.spyOn(repo, "deleteGoal").mockRejectedValueOnce(new Error("boom"));
    renderAt(`/goals/${g.id}`);
    await userEvent.click(await screen.findByRole("button", { name: "Delete goal" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("That did not save. Try again.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Stubborn goal" })).toBeInTheDocument();
  });
});
