import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../data/db";
import { createGoal, createItem, tickItem } from "../data/repo";
import { AppShell } from "./AppShell";
import { HomePage } from "./HomePage";
import { Route, Routes, useLocation } from "react-router-dom";

const TODAY = "2026-10-27";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

function JournalAt() {
  const l = useLocation();
  return <p>{`At ${l.pathname}${l.hash}`}</p>;
}

function renderHome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <HomePage today={TODAY} />
    </MemoryRouter>,
  );
}

describe("HomePage", () => {
  it("home shows Today picks, the journal card with its two buttons, and a bar per goal with a target", async () => {
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
    expect(screen.getByRole("button", { name: "Morning pages" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Daily check-in" })).toBeEnabled();
    expect(screen.queryByText("Coming in a later update")).toBeNull();
    expect(await screen.findByRole("progressbar", { name: /3\/10/ })).toBeInTheDocument();
    const card = screen.getByRole("link", { name: "Write more" }).closest("li")!;
    expect(card).toHaveClass("goal-card");
    expect(card).toHaveTextContent("October: 3 of 10");
  });

  it("home with no data renders three calm empty states and no console errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = renderHome();
    expect(await screen.findByText("Nothing planned for today.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Morning pages" })).toBeInTheDocument();
    expect(await screen.findByText("No monthly targets yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to goals" })).toHaveAttribute("href", "/goals");
    expect(container.textContent).not.toMatch(/NaN/);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("the desktop Journal card's Daily check-in button opens the check-in", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomePage today={TODAY} />} />
          <Route path="/journal" element={<JournalAt />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Daily check-in" }));
    expect(await screen.findByText("At /journal#daily-check-in")).toBeInTheDocument();
  });

  it("the desktop Journal card's Morning pages button opens morning pages", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomePage today={TODAY} />} />
          <Route path="/journal" element={<JournalAt />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Morning pages" }));
    expect(await screen.findByText("At /journal#morning-pages")).toBeInTheDocument();
  });

  it("goals without a target are not listed as bars", async () => {
    await createGoal({ title: "Targetless", areaId: "mind", kind: "practice" }, TODAY);
    renderHome();
    expect(await screen.findByText("No monthly targets yet.")).toBeInTheDocument();
    expect(screen.queryByText("Targetless")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("ticking a goal pick on Home updates the goal bar without navigation", async () => {
    const goal = await createGoal({ title: "Write more", areaId: "writing", kind: "practice", monthlyTarget: 10 }, TODAY);
    for (let i = 0; i < 3; i++) {
      const it = await createItem({ kind: "task", title: `Finished ${i}`, areaId: "writing", priority: 3, goalId: goal.id }, TODAY);
      await tickItem(it.id, TODAY);
    }
    await createItem({ kind: "task", title: "Open goal task", areaId: "writing", priority: 3, due: TODAY, goalId: goal.id }, TODAY);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/" element={<HomePage today={TODAY} />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const bar = await screen.findByRole("progressbar", { name: /3\/10/ });
    expect(bar).toHaveAttribute("aria-valuenow", "30");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Mark done: Open goal task" }));
    const updated = await screen.findByRole("progressbar", { name: /4\/10/ });
    expect(updated).toHaveAttribute("aria-valuenow", "40");
  });
});
