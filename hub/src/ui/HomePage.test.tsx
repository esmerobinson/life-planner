import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../data/db";
import { addSuggestedGoal, createGoal, createItem, deleteGoal, setGoalOnHome, tickItem } from "../data/repo";
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
  it("home shows Today picks, the Journal rows, and a bar per goal with a target", async () => {
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
    expect(card).toHaveClass("goal-mini");
    expect(card).toHaveTextContent("3 / 10 this month");
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

  it("the Daily check-in row opens the check-in", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomePage today={TODAY} />} />
          <Route path="/journal/:tab" element={<JournalAt />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Daily check-in" }));
    expect(await screen.findByText("At /journal/check-in")).toBeInTheDocument();
  });

  it("the Morning pages row opens morning pages", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<HomePage today={TODAY} />} />
          <Route path="/journal/:tab" element={<JournalAt />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Morning pages" }));
    expect(await screen.findByText("At /journal/morning")).toBeInTheDocument();
  });

  it("Today's list starts with the three Journal rows (mint strips), before the to-dos; no separate Journal section", async () => {
    await createItem({ kind: "task", title: "Pick alpha", areaId: "body", priority: 3, due: TODAY }, TODAY);
    renderHome();
    const pick = await screen.findByText("Pick alpha");
    const heading = screen.getByRole("heading", { level: 1, name: "Today" });
    const journal = screen.getByRole("list", { name: "Journal" });
    const rows = within(journal).getAllByRole("listitem");
    expect(rows.map((li) => within(li).getByRole("button").textContent)).toEqual([
      "Mental health exercise", "Morning pages", "Daily check-in",
    ]);
    for (const r of rows) expect(r).toHaveClass("strip", "journal-row");
    const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(heading, journal)).toBe(true);
    expect(follows(journal, pick)).toBe(true);
    // The first strip under the heading is the exercise.
    expect(heading.closest("section")!.querySelector(".strip")).toBe(rows[0]);
    expect(screen.queryByRole("heading", { name: "Journal" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Journal" })).toBeNull();
  });

  it("daily goals chosen for Home are not green rows: they show in the Goals column only", async () => {
    await addSuggestedGoal("suggested-bpd-practice", TODAY);
    await addSuggestedGoal("suggested-journal-daily", TODAY);
    renderHome();
    const column = await screen.findByRole("complementary", { name: "Goals this month" });
    expect(await within(column).findByRole("link", { name: "BPD practice every day" })).toBeInTheDocument();
    expect(within(column).getByRole("link", { name: "Journal daily" })).toBeInTheDocument();
    await screen.findByText("Nothing planned for today.");
    expect(screen.queryByRole("list", { name: "Daily goals" })).toBeNull();
    expect(screen.queryByRole("button", { name: "BPD practice every day" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Journal daily" })).toBeNull();
    const green = [...document.querySelectorAll(".journal-row .strip-title")].map((t) => t.textContent);
    expect(green).toEqual(["Mental health exercise", "Morning pages", "Daily check-in"]);
  });

  it("goals without a target are not listed as bars", async () => {
    await createGoal({ title: "Targetless", areaId: "mind", kind: "practice" }, TODAY);
    renderHome();
    expect(await screen.findByText("Choose which goals show here.")).toBeInTheDocument();
    expect(screen.queryByText("Targetless")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("with goals chosen for Home, the column shows only those (active ones), Mind first, then sidebar order", async () => {
    await createGoal({ title: "Pretend target goal", areaId: "art", kind: "practice", monthlyTarget: 4 }, TODAY);
    const body = await createGoal({ title: "Pretend long run", areaId: "body", kind: "practice" }, TODAY);
    const admin = await createGoal({ title: "Pretend tidy papers", areaId: "admin", kind: "practice", monthlyTarget: 2 }, TODAY);
    const mind = await createGoal({ title: "Pretend calm", areaId: "mind", kind: "practice", onHome: true }, TODAY);
    await createGoal({ title: "Pretend resting", areaId: "mind", kind: "practice", onHome: true, active: false }, TODAY);
    await setGoalOnHome(body.id, true);
    await setGoalOnHome(admin.id, true);
    renderHome();
    const column = await screen.findByRole("complementary", { name: "Goals this month" });
    await vi.waitFor(() => expect(within(column).getAllByRole("listitem")).toHaveLength(3));
    // Mind first; then Admin comes before Body in the sidebar. The inactive goal never shows.
    expect(within(column).getAllByRole("listitem").map((li) => li.querySelector(".goal-mini-link")!.textContent)).toEqual([
      "Pretend calm",
      "Pretend tidy papers",
      "Pretend long run",
    ]);
    expect(mind.onHome).toBe(true);
    expect(within(column).queryByText("Pretend target goal")).toBeNull();
    expect(within(column).queryByText("No monthly targets yet.")).toBeNull();
  });

  it("Choose goals is a pop-up: active goals by area as cards; a tap puts one on Home at once; Done closes", async () => {
    await createGoal({ title: "Pretend target goal", areaId: "art", kind: "practice", monthlyTarget: 4 }, TODAY);
    const mind = await createGoal({ title: "Pretend calm", areaId: "mind", kind: "practice" }, TODAY);
    const binned = await createGoal({ title: "Pretend binned", areaId: "mind", kind: "practice" }, TODAY);
    await createGoal({ title: "Pretend resting", areaId: "mind", kind: "practice", active: false }, TODAY);
    await deleteGoal(binned.id, TODAY);
    renderHome();
    const column = await screen.findByRole("complementary", { name: "Goals this month" });
    // Nothing chosen yet: the goals with a monthly target show, as before.
    expect(await within(column).findByText("Pretend target goal")).toBeInTheDocument();
    expect(within(column).queryByText("Pretend calm")).toBeNull();

    await userEvent.click(within(column).getByRole("button", { name: "Choose goals" }));
    const sheet = screen.getByRole("dialog", { name: "Goals on Home" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(within(sheet).getByText("0 chosen")).toBeInTheDocument();
    const groups = within(sheet).getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(groups).toEqual(["Mind", "Art"]);
    expect(within(sheet).queryByText("Pretend binned")).toBeNull();
    expect(within(sheet).queryByText("Pretend resting")).toBeNull();
    expect(sheet).not.toHaveTextContent(/On Home|Not on Home/);
    await userEvent.click(within(sheet).getByRole("button", { name: "Pretend calm" }));
    await vi.waitFor(async () => expect((await db.goals.get(mind.id))!.onHome).toBe(true));
    expect(within(sheet).getByRole("button", { name: "Pretend calm" })).toHaveAttribute("aria-pressed", "true");
    expect(within(sheet).getByText("1 chosen")).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await within(column).findByRole("link", { name: "Pretend calm" })).toBeInTheDocument();
    expect(within(column).queryByText("Pretend target goal")).toBeNull();

    // Escape closes too; focus goes back to Choose goals.
    await userEvent.click(within(column).getByRole("button", { name: "Choose goals" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Pretend calm" }));
    await vi.waitFor(async () => expect(await db.goals.get(mind.id)).not.toHaveProperty("onHome"));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(within(column).getByRole("button", { name: "Choose goals" })).toHaveFocus();
    expect(await within(column).findByRole("link", { name: "Pretend target goal" })).toBeInTheDocument();
  });

  it("the pop-up keeps focus inside (Tab from the last card goes to the first control)", async () => {
    await createGoal({ title: "Pretend calm", areaId: "mind", kind: "practice" }, TODAY);
    renderHome();
    const column = await screen.findByRole("complementary", { name: "Goals this month" });
    await userEvent.click(await within(column).findByRole("button", { name: "Choose goals" }));
    const sheet = screen.getByRole("dialog");
    within(sheet).getByRole("button", { name: "Pretend calm" }).focus();
    await userEvent.tab();
    expect(within(sheet).getByRole("button", { name: "Done" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(within(sheet).getByRole("button", { name: "Pretend calm" })).toHaveFocus();
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
