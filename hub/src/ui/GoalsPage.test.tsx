import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db } from "../data/db";
import { createGoal, createItem, tickItem } from "../data/repo";
import { GoalDetail } from "./GoalDetail";
import { GoalsPage } from "./GoalsPage";
import { ProgressBar } from "./ProgressBar";

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

function renderDetail(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/goals/${id}`]}>
      <Routes>
        <Route path="/goals/:id" element={<GoalDetail today={TODAY} />} />
      </Routes>
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

describe("GoalsPage", () => {
  it("goal without monthly target shows a set-a-target prompt, no NaN", async () => {
    await createGoal({ title: "Read more", areaId: "mind", kind: "practice" }, TODAY);
    const { container } = renderGoals();
    expect(await screen.findByText("Set a monthly target to see progress this month.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it("goal with 6 of 10 shows 60% and label 6/10", async () => {
    const g = await createGoal({ title: "Write", areaId: "writing", kind: "practice", monthlyTarget: 10 }, TODAY);
    await doneTasks(g.id, 6);
    renderGoals();
    const bar = await screen.findByRole("progressbar", { name: "This month 6/10" });
    expect(bar).toHaveAttribute("aria-valuenow", "60");
    expect(screen.getByText("6/10")).toBeInTheDocument();
  });

  it("practice goal shows evidence line, finite goal shows milestones bar", async () => {
    const p = await createGoal({ title: "Practise", areaId: "art", kind: "practice" }, TODAY);
    await doneTasks(p.id, 2);
    await createGoal(
      {
        title: "Finish book",
        areaId: "writing",
        kind: "finite",
        deadline: "2026-12-31",
        milestones: [
          { id: "a", title: "A", done: true },
          { id: "b", title: "B", done: false },
        ],
      },
      TODAY,
    );
    renderGoals();
    expect(await screen.findByText("2 this year, 1 month in a row, 1 day streak")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Overall 1/2" })).toHaveAttribute("aria-valuenow", "50");
  });

  it("pluralises months in a row: 2 months", async () => {
    const g = await createGoal({ title: "Two months", areaId: "art", kind: "practice" }, TODAY);
    for (const d of ["2026-09-15", TODAY]) {
      const it = await createItem({ kind: "task", title: `T ${d}`, areaId: "art", priority: 3, goalId: g.id }, d);
      await tickItem(it.id, d);
    }
    renderGoals();
    expect(await screen.findByText("2 this year, 2 months in a row, 1 day streak")).toBeInTheDocument();
  });

  it("goal form Area select has no Inbox option", async () => {
    renderGoals();
    const select = await screen.findByLabelText("Area");
    expect(within(select).queryByRole("option", { name: "Inbox" })).not.toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Writing" })).toBeInTheDocument();
  });

  it("finite goal with zero milestones shows ratio 0 and the add-milestones prompt", async () => {
    await createGoal({ title: "Empty arc", areaId: "writing", kind: "finite", deadline: "2026-12-31" }, TODAY);
    renderGoals();
    expect(await screen.findByText("Add milestones to see the overall arc.")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Overall 0/0" })).toHaveAttribute("aria-valuenow", "0");
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
    await userEvent.type(screen.getByLabelText("Milestones"), "one{enter}two");
    await userEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(await screen.findByText("Ship it")).toBeInTheDocument();
    const [g] = await db.goals.toArray();
    expect(g.milestones.map((m) => [m.title, m.done])).toEqual([
      ["one", false],
      ["two", false],
    ]);
    expect(g.deadline).toBe("2026-12-31");
  });
});

describe("GoalDetail", () => {
  it("ticking a task on a goal page raises the monthly bar", async () => {
    const g = await createGoal({ title: "Write", areaId: "writing", kind: "practice", monthlyTarget: 4 }, TODAY);
    await createItem({ kind: "task", title: "Draft", areaId: "writing", priority: 3, goalId: g.id }, TODAY);
    renderDetail(g.id);
    expect(await screen.findByRole("progressbar", { name: "This month 0/4" })).toBeInTheDocument();
    expect(screen.getByText("4 more to reach this month's target")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done: Draft" }));
    expect(await screen.findByRole("progressbar", { name: "This month 1/4" })).toBeInTheDocument();
    expect(screen.getByText("3 more to reach this month's target")).toBeInTheDocument();
  });

  it("groups attached tasks and toggles milestones", async () => {
    const g = await createGoal(
      {
        title: "Book",
        areaId: "writing",
        kind: "finite",
        deadline: "2026-12-31",
        milestones: [{ id: "m1", title: "Outline", done: false }],
      },
      TODAY,
    );
    const mk = (title: string, extra: Record<string, unknown>) =>
      createItem({ kind: "task", title, areaId: "writing", priority: 3, goalId: g.id, ...extra }, TODAY);
    await mk("T-today", { pinnedDate: TODAY });
    await mk("T-week", { weekOf: "2026-10-26" });
    await mk("T-weekpin", { pinnedDate: "2026-10-29" });
    await mk("T-later", {});
    renderDetail(g.id);
    const today = await screen.findByRole("list", { name: "Today" });
    expect(within(today).getByText("T-today")).toBeInTheDocument();
    const week = screen.getByRole("list", { name: "This week" });
    expect(within(week).getByText("T-week")).toBeInTheDocument();
    expect(within(week).getByText("T-weekpin")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Later" })).getByText("T-later")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Outline" }));
    expect(await screen.findByRole("progressbar", { name: "Overall 1/1" })).toBeInTheDocument();
    expect((await db.goals.toArray())[0].milestones[0].done).toBe(true);
  });

  it.each([
    ["Sunday", "2026-11-01", "2026-10-26", "2026-10-30", "2026-11-02"],
    ["Monday", "2026-11-02", "2026-11-02", "2026-11-04", "2026-11-01"],
  ])("week boundary on a %s", async (_n, today, monday, laterInWeek, outside) => {
    const g = await createGoal({ title: "Edge", areaId: "writing", kind: "practice" }, today);
    const mk = (title: string, extra: Record<string, unknown>) =>
      createItem({ kind: "task", title, areaId: "writing", priority: 3, goalId: g.id, ...extra }, today);
    await mk("pinned-today", { pinnedDate: today });
    await mk("week-of", { weekOf: monday });
    await mk("pinned-same-week", { pinnedDate: laterInWeek });
    await mk("pinned-outside", { pinnedDate: outside });
    await mk("pinned-next-week", { pinnedDate: "2026-11-09" });
    await mk("pinned-prev-week", { pinnedDate: "2026-10-20" });
    render(
      <MemoryRouter initialEntries={[`/goals/${g.id}`]}>
        <Routes>
          <Route path="/goals/:id" element={<GoalDetail today={today} />} />
        </Routes>
      </MemoryRouter>,
    );
    const t = within(await screen.findByRole("list", { name: "Today" }));
    expect(t.getByText("pinned-today")).toBeInTheDocument();
    expect(t.getAllByRole("listitem")).toHaveLength(1);
    const w = within(screen.getByRole("list", { name: "This week" }));
    expect(w.getByText("week-of")).toBeInTheDocument();
    expect(w.getByText("pinned-same-week")).toBeInTheDocument();
    expect(w.getAllByRole("listitem")).toHaveLength(2);
    const l = within(screen.getByRole("list", { name: "Later" }));
    for (const n of ["pinned-outside", "pinned-next-week", "pinned-prev-week"]) {
      expect(l.getByText(n)).toBeInTheDocument();
    }
    expect(l.getAllByRole("listitem")).toHaveLength(3);
  });

  it("unknown goal id shows a calm message", async () => {
    renderDetail("nope");
    expect(await screen.findByText("That goal does not exist.")).toBeInTheDocument();
  });
});
