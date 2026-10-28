import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db } from "../data/db";
import { createGoal, createItem, tickItem } from "../data/repo";
import { AppShell } from "./AppShell";
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
  it("goal without monthly target: no month bar on its card, the set-a-target prompt on its page, no NaN", async () => {
    const g = await createGoal({ title: "Read more", areaId: "mind", kind: "practice" }, TODAY);
    const { container } = renderGoals();
    const card = (await screen.findByRole("link", { name: "Read more" })).closest("li")!;
    expect(within(card).getByText("Practice")).toBeInTheDocument();
    expect(within(card).queryByRole("progressbar")).toBeNull();
    expect(container.textContent).not.toMatch(/NaN|Infinity|undefined/);
    cleanup();
    renderDetail(g.id);
    expect(await screen.findByText("Set a monthly target to see progress this month.")).toBeInTheDocument();
  });

  it("goal with 6 of 10 shows the October bar at 60%", async () => {
    const g = await createGoal({ title: "Write", areaId: "writing", kind: "finite", deadline: "2026-12-31", monthlyTarget: 10 }, TODAY);
    await doneTasks(g.id, 6);
    renderGoals();
    const bar = await screen.findByRole("progressbar", { name: "This month 6/10" });
    expect(bar).toHaveAttribute("aria-valuenow", "60");
    expect(screen.getByText("October: 6 of 10")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
  });

  it("a practice goal's month bar says how many months in a row", async () => {
    const g = await createGoal({ title: "Write", areaId: "writing", kind: "practice", monthlyTarget: 10 }, TODAY);
    await doneTasks(g.id, 6);
    renderGoals();
    expect(await screen.findByText("October: 6 of 10")).toBeInTheDocument();
    expect(screen.getByText("1 month in a row")).toBeInTheDocument();
    expect(screen.queryByText("60%")).toBeNull();
  });

  it("practice goal shows evidence line on its page, finite goal card shows the Overall bar and By date", async () => {
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
    expect(await screen.findByRole("progressbar", { name: "Overall 1/2" })).toHaveAttribute("aria-valuenow", "50");
    const card = screen.getByRole("link", { name: "Finish book" }).closest("li")!;
    expect(within(card).getByText("Overall")).toBeInTheDocument();
    expect(within(card).getByText("50%")).toBeInTheDocument();
    expect(within(card).getByText("By 31 Dec")).toBeInTheDocument();
    expect(within(card).getByText("Writing")).toBeInTheDocument();
    cleanup();
    renderDetail(p.id);
    expect(await screen.findByText("2 this year, 1 month in a row, 1 day streak")).toBeInTheDocument();
  });

  it("pluralises months in a row: 2 months", async () => {
    const g = await createGoal({ title: "Two months", areaId: "art", kind: "practice", monthlyTarget: 3 }, TODAY);
    for (const d of ["2026-09-15", TODAY]) {
      const it = await createItem({ kind: "task", title: `T ${d}`, areaId: "art", priority: 3, goalId: g.id }, d);
      await tickItem(it.id, d);
    }
    renderGoals();
    expect(await screen.findByText("2 months in a row")).toBeInTheDocument();
    cleanup();
    renderDetail(g.id);
    expect(await screen.findByText("2 this year, 2 months in a row, 1 day streak")).toBeInTheDocument();
  });

  it("groups goals under one heading per area, in sidebar order, as cards", async () => {
    await createGoal({ title: "Body goal", areaId: "body", kind: "practice" }, TODAY);
    await createGoal({ title: "Admin goal", areaId: "admin", kind: "practice" }, TODAY);
    await createGoal({ title: "Writing goal", areaId: "writing", kind: "practice" }, TODAY);
    await createGoal({ title: "Writing goal 2", areaId: "writing", kind: "practice" }, TODAY);
    renderGoals();
    await screen.findByText("Body goal");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent).slice(0, 3)).toEqual([
      "Admin", "Writing", "Body",
    ]);
    const writing = screen.getByRole("list", { name: "Writing goals" });
    expect(writing).toHaveClass("goal-list");
    expect(within(writing).getAllByRole("listitem").map((li) => li.className)).toEqual(["goal-card", "goal-card"]);
    expect(screen.queryByRole("heading", { level: 2, name: "Art" })).toBeNull();
  });

  it("a goal whose area is not a sidebar area still shows, under its own heading", async () => {
    await createGoal({ title: "Stray goal", areaId: "inbox", kind: "practice" }, TODAY);
    await createGoal({ title: "Writing goal", areaId: "writing", kind: "practice" }, TODAY);
    renderGoals();
    expect(await screen.findByRole("link", { name: "Stray goal" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent).slice(0, 2)).toEqual(["Writing", "Inbox"]);
    expect(within(screen.getByRole("list", { name: "Inbox goals" })).getByText("Stray goal")).toBeInTheDocument();
  });

  it("a card shows the area tile, links to the goal, and names the next step (or none)", async () => {
    const g = await createGoal({ title: "Book", areaId: "writing", kind: "practice" }, TODAY);
    await createGoal({ title: "Idle", areaId: "writing", kind: "practice" }, TODAY);
    await createItem({ kind: "task", title: "Someday bit", areaId: "writing", priority: 3, goalId: g.id }, TODAY);
    await createItem({ kind: "task", title: "Today bit", areaId: "writing", priority: 3, goalId: g.id, pinnedDate: TODAY }, TODAY);
    renderGoals();
    const link = await screen.findByRole("link", { name: "Book" });
    expect(link).toHaveAttribute("href", `/goals/${g.id}`);
    const card = link.closest("li")!;
    expect((card.querySelector(".goal-tile") as HTMLElement).style.background).toBe("rgb(230, 174, 175)"); // Writing's tile #e6aeaf
    expect(card.querySelector(".goal-tile img")).not.toBeNull();
    expect(within(card).getByText("Today bit")).toBeInTheDocument();
    expect(card.querySelector(".goal-next")).toHaveTextContent("Next: Today bit");
    const idle = screen.getByRole("link", { name: "Idle" }).closest("li")!;
    expect(idle.querySelector(".goal-next")).toBeNull();
  });

  it("goal form Area select offers the three new areas", async () => {
    renderGoals();
    const select = await screen.findByLabelText("Area");
    for (const name of ["Tech projects", "Production", "Admin"]) {
      expect(within(select).getByRole("option", { name })).toBeInTheDocument();
    }
  });

  it("goal form Area select has no Inbox option", async () => {
    renderGoals();
    const select = await screen.findByLabelText("Area");
    expect(within(select).queryByRole("option", { name: "Inbox" })).not.toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Writing" })).toBeInTheDocument();
  });

  it("finite goal with zero milestones shows ratio 0, and the add-milestones prompt on its page", async () => {
    const g = await createGoal({ title: "Empty arc", areaId: "writing", kind: "finite", deadline: "2026-12-31" }, TODAY);
    renderGoals();
    expect(await screen.findByRole("progressbar", { name: "Overall 0/0" })).toHaveAttribute("aria-valuenow", "0");
    expect(screen.getByText("0%")).toBeInTheDocument();
    cleanup();
    renderDetail(g.id);
    expect(await screen.findByText("Add milestones to see the overall arc.")).toBeInTheDocument();
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
    // Milestones are flagged linked tasks (round 3).
    expect(g.milestones).toEqual([]);
    const tasks = (await db.items.toArray()).sort((a, b) => a.title.localeCompare(b.title));
    expect(tasks.map((t) => [t.title, t.status, t.milestone, t.goalId])).toEqual([
      ["one", "open", true, g.id],
      ["two", "open", true, g.id],
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
    await userEvent.selectOptions(quick.getByLabelText("Area"), "writing");
    expect(quick.queryByRole("option", { name: "Fresh goal" })).toBeNull();
    await userEvent.type(screen.getByLabelText("Goal title"), "Fresh goal");
    await userEvent.selectOptions(screen.getByLabelText("Kind", { selector: "form.goal-form select" }), "practice");
    await userEvent.click(screen.getByRole("button", { name: "Add goal" }));
    expect(await quick.findByRole("option", { name: "Fresh goal" })).toBeInTheDocument();
  });
});

describe("GoalDetail", () => {
  it("ticking a task on a goal page raises the monthly bar", async () => {
    const g = await createGoal({ title: "Write", areaId: "writing", kind: "practice", monthlyTarget: 4 }, TODAY);
    await createItem({ kind: "task", title: "Draft", areaId: "writing", priority: 3, goalId: g.id }, TODAY);
    renderDetail(g.id);
    expect(await screen.findByRole("progressbar", { name: "This month 0/4" })).toBeInTheDocument();
    expect(screen.getByText("4 more to reach this month's target")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Mark done: Draft" }));
    expect(await screen.findByRole("progressbar", { name: "This month 1/4" })).toBeInTheDocument();
    expect(screen.getByText("3 more to reach this month's target")).toBeInTheDocument();
  });

  it("groups attached tasks; a milestone is a flagged task ticked like any other", async () => {
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
    expect(await screen.findByRole("progressbar", { name: "Overall 0/1" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "Mark done: Outline" }));
    expect(await screen.findByRole("progressbar", { name: "Overall 1/1" })).toBeInTheDocument();
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

  it("Undo in Done lowers the monthly bar and returns the task to the open list", async () => {
    const g = await createGoal({ title: "Write", areaId: "writing", kind: "practice", monthlyTarget: 4 }, TODAY);
    const t = await createItem({ kind: "task", title: "Draft", areaId: "writing", priority: 3, goalId: g.id }, TODAY);
    await tickItem(t.id, TODAY);
    renderDetail(g.id);
    expect(await screen.findByRole("progressbar", { name: "This month 1/4" })).toBeInTheDocument();
    expect(screen.getByText("No open tasks attached to this goal.")).toBeInTheDocument();
    const done = screen.getByText("Done (1)", { selector: "summary" }).closest("details")!;
    expect(done).not.toHaveAttribute("open");
    await userEvent.click(within(done).getByText("Done (1)", { selector: "summary" }));
    await userEvent.click(within(done).getByRole("checkbox", { name: "Done: Draft" }));
    expect(await screen.findByRole("progressbar", { name: "This month 0/4" })).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Later" })).getByText("Draft")).toBeInTheDocument();
    expect(within(done).getByText("Nothing done yet.")).toBeInTheDocument();
  });

  it("unknown goal id shows a calm message", async () => {
    renderDetail("nope");
    expect(await screen.findByText("That goal does not exist.")).toBeInTheDocument();
  });
});
