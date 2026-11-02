import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../data/db";
import { createGoal, createItem, deleteGoal, setGoalOnHome, tickItem } from "../data/repo";
import { AppShell } from "./AppShell";
import type { Goal } from "../domain/types";
import { HomePage, homeGoals } from "./HomePage";
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
    expect(await screen.findByText("Choose which goals show here.")).toBeInTheDocument();
    expect(screen.queryByText("Targetless")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("with goals chosen for Home, the column shows only those, in sidebar area order", async () => {
    await createGoal({ title: "Pretend target goal", areaId: "art", kind: "practice", monthlyTarget: 4 }, TODAY);
    const body = await createGoal({ title: "Pretend long run", areaId: "body", kind: "practice" }, TODAY);
    const admin = await createGoal({ title: "Pretend tidy papers", areaId: "admin", kind: "practice", monthlyTarget: 2 }, TODAY);
    await setGoalOnHome(body.id, true);
    await setGoalOnHome(admin.id, true);
    renderHome();
    const column = await screen.findByRole("complementary", { name: "Goals this month" });
    await vi.waitFor(() => expect(within(column).getAllByRole("listitem")).toHaveLength(2));
    // Admin comes before Body in the sidebar.
    expect(within(column).getAllByRole("listitem").map((li) => li.querySelector(".goal-title")!.textContent)).toEqual([
      "Pretend tidy papers",
      "Pretend long run",
    ]);
    expect(within(column).queryByText("Pretend target goal")).toBeNull();
    expect(within(column).queryByText("No monthly targets yet.")).toBeNull();
  });

  it("Choose goals lists every live goal by area; ticking one shows it on Home, unticking falls back", async () => {
    await createGoal({ title: "Pretend target goal", areaId: "art", kind: "practice", monthlyTarget: 4 }, TODAY);
    const mind = await createGoal({ title: "Pretend calm", areaId: "mind", kind: "practice" }, TODAY);
    const binned = await createGoal({ title: "Pretend binned", areaId: "mind", kind: "practice" }, TODAY);
    await deleteGoal(binned.id, TODAY);
    renderHome();
    const column = await screen.findByRole("complementary", { name: "Goals this month" });
    // Nothing chosen yet: the goals with a monthly target show, as before.
    expect(await within(column).findByText("Pretend target goal")).toBeInTheDocument();
    expect(within(column).queryByText("Pretend calm")).toBeNull();

    await userEvent.click(within(column).getByRole("button", { name: "Choose goals" }));
    expect(within(column).getByRole("group", { name: "Art" })).toBeInTheDocument();
    const mindGroup = within(column).getByRole("group", { name: "Mind" });
    expect(within(mindGroup).queryByText("Pretend binned")).toBeNull();
    await userEvent.click(within(mindGroup).getByRole("checkbox", { name: "Pretend calm" }));
    await vi.waitFor(async () => expect((await db.goals.get(mind.id))!.onHome).toBe(true));
    await vi.waitFor(() => expect(within(mindGroup).getByRole("checkbox", { name: "Pretend calm" })).toBeChecked());
    await userEvent.click(within(column).getByRole("button", { name: "Done" }));
    expect(await within(column).findByRole("link", { name: "Pretend calm" })).toBeInTheDocument();
    expect(within(column).queryByText("Pretend target goal")).toBeNull();

    await userEvent.click(within(column).getByRole("button", { name: "Choose goals" }));
    await userEvent.click(within(column).getByRole("checkbox", { name: "Pretend calm" }));
    await vi.waitFor(async () => expect(await db.goals.get(mind.id)).not.toHaveProperty("onHome"));
    await userEvent.click(within(column).getByRole("button", { name: "Done" }));
    expect(await within(column).findByRole("link", { name: "Pretend target goal" })).toBeInTheDocument();
  });

  it("goals all set not to show (onHome false) fall back to the goals with a monthly target", async () => {
    const a = await createGoal({ title: "Pretend target goal", areaId: "art", kind: "practice", monthlyTarget: 4 }, TODAY);
    await db.goals.update(a.id, { onHome: false });
    renderHome();
    const column = await screen.findByRole("complementary", { name: "Goals this month" });
    expect(await within(column).findByRole("link", { name: "Pretend target goal" })).toBeInTheDocument();
  });

  it("goals but none chosen and none with a monthly target: the heading, one line and Choose goals", async () => {
    await createGoal({ title: "Targetless", areaId: "mind", kind: "practice" }, TODAY);
    renderHome();
    const column = await screen.findByRole("complementary", { name: "Goals this month" });
    expect(within(column).getByRole("heading", { level: 2, name: "Goals this month" })).toBeInTheDocument();
    expect(await within(column).findByText("Choose which goals show here.")).toBeInTheDocument();
    expect(within(column).getByRole("button", { name: "Choose goals" })).toBeInTheDocument();
  });

  it("homeGoals: chosen first; else monthly targets; else nothing (the column still shows)", () => {
    const g = (id: string, extra: Record<string, unknown> = {}) =>
      ({ id, title: id, areaId: "art", kind: "practice", milestones: [], createdAt: TODAY, ...extra }) as Goal;
    expect(homeGoals([g("a", { monthlyTarget: 2 }), g("b")], [], TODAY)).toEqual({ goals: [g("a", { monthlyTarget: 2 })], chosen: false });
    expect(homeGoals([g("a", { monthlyTarget: 2 }), g("b", { onHome: true })], [], TODAY).goals.map((x) => x.id)).toEqual(["b"]);
    expect(homeGoals([g("a", { onHome: false, monthlyTarget: 2 })], [], TODAY).goals.map((x) => x.id)).toEqual(["a"]);
    expect(homeGoals([g("b")], [], TODAY).goals).toEqual([]);
  });

  it("no Choose goals link before there are any goals", async () => {
    renderHome();
    expect(await screen.findByText("No monthly targets yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose goals" })).toBeNull();
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
