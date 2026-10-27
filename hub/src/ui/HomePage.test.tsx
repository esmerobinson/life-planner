import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../data/db";
import { createGoal, createItem, tickItem } from "../data/repo";
import { HomePage } from "./HomePage";

const TODAY = "2026-10-27";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <HomePage today={TODAY} />
    </MemoryRouter>,
  );
}

describe("HomePage", () => {
  it("home shows Today picks, the journal card with two disabled buttons, and a bar per goal with a target", async () => {
    const goal = await createGoal({ title: "Write more", areaId: "writing", kind: "practice", monthlyTarget: 10 }, TODAY);
    for (let i = 0; i < 3; i++) {
      const it = await createItem({ kind: "task", title: `Finished ${i}`, areaId: "writing", priority: 3, goalId: goal.id }, TODAY);
      await tickItem(it.id, TODAY);
    }
    await createItem({ kind: "task", title: "Pick alpha", areaId: "body", priority: 3, due: TODAY }, TODAY);
    await createItem({ kind: "task", title: "Pick beta", areaId: "body", priority: 3, due: TODAY }, TODAY);
    renderHome();
    expect(await screen.findByText("Pick alpha")).toBeInTheDocument();
    expect(screen.getByText("Pick beta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Morning pages" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Daily check-in" })).toBeDisabled();
    expect(screen.getByText("Coming in a later update")).toBeInTheDocument();
    expect(await screen.findByRole("progressbar", { name: /3\/10/ })).toBeInTheDocument();
    expect(screen.getByText("Write more")).toBeInTheDocument();
  });

  it("home with no data renders three calm empty states and no console errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = renderHome();
    expect(await screen.findByText("Nothing planned for today.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Morning pages" })).toBeInTheDocument();
    expect(await screen.findByText("No monthly targets yet.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("goals without a target are not listed as bars", async () => {
    await createGoal({ title: "Targetless", areaId: "mind", kind: "practice" }, TODAY);
    renderHome();
    expect(await screen.findByText("No monthly targets yet.")).toBeInTheDocument();
    expect(screen.queryByText("Targetless")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
});
