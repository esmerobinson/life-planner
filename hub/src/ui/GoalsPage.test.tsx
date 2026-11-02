import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db } from "../data/db";
import { createGoal, createItem, tickItem } from "../data/repo";
import { AppShell } from "./AppShell";
import { GoalsPage } from "./GoalsPage";
import { GoalCard } from "./GoalProgress";
import { ProgressBar } from "./ProgressBar";
import { goalTaskSplit } from "../domain/progress";

const TODAY = "2026-10-27"; // a Tuesday

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

function renderGoals() {
  return render(
    <MemoryRouter initialEntries={["/goals"]}>
      <GoalsPage today={TODAY} />
    </MemoryRouter>,
  );
}


async function doneTasks(goalId: string, n: number) {
  for (let i = 0; i < n; i++) {
    const it = await createItem({ kind: "task", title: `Done ${i}`, areaId: "writing", priority: 3, goalId }, TODAY);
    await tickItem(it.id, TODAY);
  }
}

describe("ProgressBar", () => {
  it("clamps: ratio 1.5 -> 100, NaN -> 0", () => {
    const { rerender } = render(<ProgressBar ratio={1.5} label="x" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
    rerender(<ProgressBar ratio={NaN} label="x" />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-label", "x");
  });
});

describe("GoalCard (area pages)", () => {
  function renderCard(goalId: string) {
    return db.goals.get(goalId).then(async (goal) => {
      const items = await db.items.toArray();
      return render(
        <MemoryRouter>
          <ul>
            <GoalCard goal={goal!} items={items} today={TODAY} />
          </ul>
        </MemoryRouter>,
      );
    });
  }

  it("goal with 6 of 10 shows the October bar at 60%", async () => {
    const g = await createGoal({ title: "Write", areaId: "writing", kind: "finite", deadline: "2026-12-31", monthlyTarget: 10 }, TODAY);
    await doneTasks(g.id, 6);
    await renderCard(g.id);
    expect(screen.getByRole("progressbar", { name: "This month 6/10" })).toHaveAttribute("aria-valuenow", "60");
    expect(screen.getByText("October: 6 of 10")).toBeInTheDocument();
  });

  it("names the next step", async () => {
    const g = await createGoal({ title: "Book", areaId: "writing", kind: "practice" }, TODAY);
    await createItem({ kind: "task", title: "Today bit", areaId: "writing", priority: 3, goalId: g.id, pinnedDate: TODAY }, TODAY);
    const { container } = await renderCard(g.id);
    expect(container.querySelector(".goal-next")).toHaveTextContent("Next: Today bit");
  });
});

describe("GoalsPage (goals redesign: colour-band tiles)", () => {
  it("tiles are grouped by area, Mind first, in a grid; no NaN", async () => {
    await createGoal({ title: "Body goal", areaId: "body", kind: "practice" }, TODAY);
    await createGoal({ title: "Admin goal", areaId: "admin", kind: "practice" }, TODAY);
    await createGoal({ title: "Mind goal", areaId: "mind", kind: "practice" }, TODAY);
    await createGoal({ title: "Writing goal", areaId: "writing", kind: "practice" }, TODAY);
    const { container } = renderGoals();
    await screen.findByText("Body goal");
    const areas = [...container.querySelectorAll(".goals-area > h2")].map((h) => h.textContent);
    expect(areas).toEqual(["Mind", "Admin", "Writing", "Body"]);
    const writing = screen.getByRole("list", { name: "Writing goals" });
    expect(writing).toHaveClass("goal-grid");
    expect(within(writing).getAllByRole("listitem")[0]).toHaveClass("goal-tile-a");
    expect(container.textContent).not.toMatch(/NaN|Infinity|undefined/);
  });

  it("a goal whose area is not a sidebar area still shows, under its own heading", async () => {
    await createGoal({ title: "Stray goal", areaId: "inbox", kind: "practice" }, TODAY);
    renderGoals();
    expect(await screen.findByRole("link", { name: "Stray goal" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Inbox goals" })).getByText("Stray goal")).toBeInTheDocument();
  });

  it("a tile: the area-colour band with icon and title (opens the goal), the kind chip, Overall and the month box", async () => {
    const g = await createGoal({ title: "Book", areaId: "writing", kind: "finite", deadline: "2026-12-31",
      milestones: [{ id: "a", title: "A", done: true }, { id: "b", title: "B", done: false }] }, TODAY);
    renderGoals();
    const link = await screen.findByRole("link", { name: "Book" });
    expect(link).toHaveAttribute("href", `/goals?open=${g.id}`);
    const tile = link.closest("li")!;
    expect((tile.querySelector(".goal-band") as HTMLElement).style.background).toBe("rgb(230, 174, 175)"); // Writing #e6aeaf
    expect(tile.querySelector(".goal-band img")).not.toBeNull();
    expect(within(tile).getByText("By 31 Dec")).toBeInTheDocument();
    expect(within(tile).getByRole("progressbar", { name: "Overall 1/2" })).toHaveAttribute("aria-valuenow", "50");
    expect(within(tile).getByText("October goals")).toBeInTheDocument();
    expect(within(tile).getByRole("button", { name: "+ Add an October goal" })).toBeInTheDocument();
    expect(tile.querySelectorAll(".goal-dot")).toHaveLength(6);
  });

  it("chips: Ongoing for a practice, Daily (with the mint outline) for a daily goal", async () => {
    await createGoal({ title: "Practice goal", areaId: "art", kind: "practice" }, TODAY);
    await createGoal({ title: "Daily goal", areaId: "art", kind: "practice", rhythm: "daily" }, TODAY);
    renderGoals();
    const practice = (await screen.findByRole("link", { name: "Practice goal" })).closest("li")!;
    expect(within(practice).getByText("Ongoing")).toBeInTheDocument();
    expect(within(practice).getByText("ongoing")).toBeInTheDocument();
    expect(practice).not.toHaveClass("is-daily");
    const daily = screen.getByRole("link", { name: "Daily goal" }).closest("li")!;
    expect(within(daily).getByText("Daily")).toBeInTheDocument();
    expect(daily).toHaveClass("is-daily");
  });

  it("+ Add a goal: a count with a target, then +1 and −1; a step ticks", async () => {
    await createGoal({ title: "Write", areaId: "writing", kind: "practice" }, TODAY);
    renderGoals();
    const tile = (await screen.findByRole("link", { name: "Write" })).closest("li")!;
    await userEvent.click(within(tile).getByRole("button", { name: "+ Add an October goal" }));
    await userEvent.type(within(tile).getByLabelText("Title"), "Writing sessions");
    await userEvent.type(within(tile).getByLabelText("Target"), "20");
    await userEvent.click(within(tile).getByRole("button", { name: "Add" }));
    expect(await within(tile).findByText("0 / 20")).toBeInTheDocument();
    await userEvent.click(within(tile).getByRole("button", { name: "+1 Writing sessions" }));
    await userEvent.click(within(tile).getByRole("button", { name: "+1 Writing sessions" }));
    expect(await within(tile).findByText("2 / 20")).toBeInTheDocument();
    await userEvent.click(within(tile).getByRole("button", { name: "Undo the last +1 on Writing sessions" }));
    expect(await within(tile).findByText("1 / 20")).toBeInTheDocument();

    await userEvent.click(within(tile).getByRole("button", { name: "+ Add an October goal" }));
    await userEvent.click(within(tile).getByRole("button", { name: "Step" }));
    expect(within(tile).queryByLabelText("Target")).toBeNull();
    await userEvent.type(within(tile).getByLabelText("Title"), "Send chapter 3");
    await userEvent.click(within(tile).getByRole("button", { name: "Add" }));
    const step = await within(tile).findByRole("checkbox", { name: "Send chapter 3" });
    expect(within(tile).getByText("0 of 2 done")).toBeInTheDocument();
    await userEvent.click(step);
    expect(await within(tile).findByText("1 of 2 done")).toBeInTheDocument();
    expect(within(tile).getByRole("checkbox", { name: "Send chapter 3" })).toHaveAttribute("aria-checked", "true");
  });

  it("an automatic count says what counts and has no +1", async () => {
    const g = await createGoal({
      title: "Mind work", areaId: "mind", kind: "practice", countsFrom: ["linked", { area: "mind" }],
      monthGoals: [{ id: "m", month: "2026-10", kind: "count", title: "Mind things done", target: 30 }],
    }, TODAY);
    await createItem({ kind: "task", title: "Linked", areaId: "art", priority: 3, goalId: g.id }, TODAY).then((t) => tickItem(t.id, TODAY));
    await createItem({ kind: "task", title: "Mind one", areaId: "mind", priority: 3 }, TODAY).then((t) => tickItem(t.id, TODAY));
    renderGoals();
    const tile = (await screen.findByRole("link", { name: "Mind work" })).closest("li")!;
    expect(await within(tile).findByText("2 / 30")).toBeInTheDocument();
    expect(within(tile).getByText("Counts itself: linked to-dos, Mind to-dos, Mind habits")).toBeInTheDocument();
    expect(within(tile).queryByRole("button", { name: /^\+1/ })).toBeNull();
  });

  it("Plan <Month> copies last month's counts in one tap", async () => {
    await createGoal({
      title: "Write", areaId: "writing", kind: "practice",
      monthGoals: [{ id: "s", month: "2026-09", kind: "count", title: "Writing sessions", target: 20 }],
    }, TODAY);
    renderGoals();
    const tile = (await screen.findByRole("link", { name: "Write" })).closest("li")!;
    await userEvent.click(within(tile).getByRole("button", { name: "Plan October" }));
    expect(await within(tile).findByText("0 / 20")).toBeInTheDocument();
    expect(within(tile).queryByRole("button", { name: "Plan October" })).toBeNull();
  });

  it("an older goal with only a monthly target keeps its month count and history on the tile, as on Home (fix round 1, I2)", async () => {
    const g = await createGoal({ title: "Pretend imported sessions", areaId: "writing", kind: "practice", monthlyTarget: 2 }, TODAY);
    for (const d of ["2026-09-03", "2026-09-12", "2026-10-02"]) {
      const it = await createItem({ kind: "task", title: `Pretend session ${d}`, areaId: "writing", priority: 3, goalId: g.id }, d);
      await tickItem(it.id, d);
    }
    renderGoals();
    const tile = (await screen.findByRole("link", { name: "Pretend imported sessions" })).closest("li")!;
    expect(await within(tile).findByText("October: 1 of 2")).toBeInTheDocument();
    expect(tile.querySelectorAll(".goal-dot.on")).toHaveLength(1); // September hit
    expect(within(tile).getByText("1 month in a row")).toBeInTheDocument(); // ends last month (September)
  });

  it("Active / Inactive: inactive goals only under Inactive", async () => {
    await createGoal({ title: "Live one", areaId: "art", kind: "practice" }, TODAY);
    await createGoal({ title: "Resting one", areaId: "art", kind: "practice", active: false }, TODAY);
    renderGoals();
    expect(await screen.findByRole("link", { name: "Live one" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Resting one" })).toBeNull();
    expect(screen.getByRole("button", { name: "Active" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Inactive" }));
    expect(await screen.findByRole("link", { name: "Resting one" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Live one" })).toBeNull();
  });

  it("Suggested goals: nothing is created until a tap; each tap adds one; Dismiss hides the card", async () => {
    localStorage.removeItem("esmeworld:suggested-goals-dismissed");
    renderGoals();
    const card = await screen.findByRole("region", { name: "Suggested goals" });
    expect(within(card).getByText("Add your three goals")).toBeInTheDocument();
    expect(await db.goals.count()).toBe(0);
    await userEvent.click(within(card).getByRole("button", { name: "Add BPD practice every day" }));
    expect(await screen.findByRole("link", { name: "BPD practice every day" })).toBeInTheDocument();
    expect(within(card).getByText("Added")).toBeInTheDocument();
    expect(await db.goals.count()).toBe(1);
    await userEvent.click(within(card).getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("region", { name: "Suggested goals" })).toBeNull();
    cleanup();
    renderGoals();
    await screen.findByRole("link", { name: "BPD practice every day" });
    expect(screen.queryByRole("region", { name: "Suggested goals" })).toBeNull();
    localStorage.removeItem("esmeworld:suggested-goals-dismissed");
  });

  it("finite goal form blocks save without a deadline", async () => {
    renderGoals();
    await userEvent.type(await screen.findByLabelText("Goal title"), "No deadline");
    await userEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(await screen.findByText("A finite goal needs a deadline.")).toBeInTheDocument();
    expect(await db.goals.count()).toBe(0);
  });

  it("form saves a finite goal with milestones", async () => {
    renderGoals();
    await userEvent.type(await screen.findByLabelText("Goal title"), "Ship it");
    await userEvent.type(screen.getByLabelText("Deadline"), "2026-12-31");
    await userEvent.type(screen.getByLabelText("Milestones"), "Outline{enter}Draft part 1{enter}Draft part 2{enter}Edit");
    await userEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(await screen.findByText("Ship it")).toBeInTheDocument();
    const [g] = await db.goals.toArray();
    // Milestones are flagged linked tasks (round 3), in the order of the lines (review I-1).
    expect(g.milestones).toEqual([]);
    const tasks = goalTaskSplit(g, await db.items.toArray()).toCome;
    expect(tasks.map((t) => [t.title, t.status, t.milestone, t.goalId, t.order])).toEqual([
      ["Outline", "open", true, g.id, 0],
      ["Draft part 1", "open", true, g.id, 1],
      ["Draft part 2", "open", true, g.id, 2],
      ["Edit", "open", true, g.id, 3],
    ]);
    expect(g.deadline).toBe("2026-12-31");
  });
});

describe("Goals and the shell", () => {
  it("a goal created on /goals appears in an open quick-add form", async () => {
    render(
      <MemoryRouter initialEntries={["/goals"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/goals" element={<GoalsPage today={TODAY} />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Add" }));
    const quick = within(document.querySelector("form.quick-add") as HTMLElement);
    // On the Goals page Add opens as a goal; a to-do offers the goal picker.
    expect(quick.getByLabelText("Type")).toHaveValue("goal");
    await userEvent.selectOptions(quick.getByLabelText("Type"), "task");
    await userEvent.selectOptions(quick.getByLabelText("Area"), "writing");
    expect(quick.queryByRole("option", { name: "Fresh goal" })).toBeNull();
    await userEvent.type(screen.getByLabelText("Goal title"), "Fresh goal");
    await userEvent.selectOptions(screen.getByLabelText("Kind", { selector: "form.goal-form select" }), "practice");
    await userEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(await quick.findByRole("option", { name: "Fresh goal" })).toBeInTheDocument();
  });
});
