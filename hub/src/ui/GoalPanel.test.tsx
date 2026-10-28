import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import * as repo from "../data/repo";
import { createGoal, createItem, listGoalBin, tickItem } from "../data/repo";
import { currentUrl, renderApp } from "../test/renderApp";
import { QuickAdd } from "./QuickAdd";

const TODAY = "2026-10-28";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
  vi.restoreAllMocks();
});
afterEach(() => vi.useRealTimers());

const panel = () => screen.getByRole("complementary", { name: /\S/ });

async function openGoal(id: string, path = "/goals") {
  renderApp(`${path}?open=${id}`, TODAY);
  return within(await screen.findByRole("complementary", { name: /\S/ }));
}

describe("the goal panel (view)", () => {
  it("a goal card opens the panel; the URL says so; Close closes it", async () => {
    const g = await createGoal({ title: "Pretend book", areaId: "writing", kind: "practice" }, TODAY);
    renderApp(["/", "/goals"], TODAY);
    await userEvent.click(await screen.findByRole("link", { name: "Pretend book" }));
    expect(await screen.findByRole("complementary", { name: "Pretend book" })).toBeInTheDocument();
    expect(currentUrl).toBe(`/goals?open=${g.id}`);
    await userEvent.click(within(panel()).getByRole("button", { name: "Close" }));
    await vi.waitFor(() => expect(screen.queryByRole("complementary", { name: /\S/ })).toBeNull());
    expect(currentUrl).toBe("/goals");
  });

  it("an old /goals/<id> link opens the goal in the panel on the Goals page", async () => {
    const g = await createGoal({ title: "Old link goal", areaId: "art", kind: "practice" }, TODAY);
    renderApp(`/goals/${g.id}`, TODAY);
    expect(await screen.findByRole("complementary", { name: "Old link goal" })).toBeInTheDocument();
    expect(currentUrl).toBe(`/goals?open=${g.id}`);
  });

  it("shows the header, both bars, the three stats, why, To come and Completed", async () => {
    const g = await createGoal(
      {
        title: "Finish the pretend book", areaId: "writing", kind: "finite", deadline: "2026-12-31", monthlyTarget: 6,
        cadence: "Weekly: 3 sessions\nDaily: a page", why: "A pretend reason <b>x</b>",
        milestones: [{ id: "m1", title: "Outline all parts", done: true }, { id: "m2", title: "Draft part 2", done: false }],
      },
      TODAY,
    );
    const t = await createItem({ kind: "task", title: "Send chapter 3", areaId: "writing", priority: 2, goalId: g.id }, TODAY);
    await tickItem(t.id, TODAY);
    await createItem({ kind: "task", title: "Book a writing day", areaId: "writing", priority: 2, goalId: g.id, due: "2026-10-30" }, TODAY);
    const p = await openGoal(g.id);
    expect(p.getByRole("heading", { level: 2, name: "Finish the pretend book" })).toBeInTheDocument();
    expect(p.getByText("Writing")).toBeInTheDocument();
    expect(p.getByText("By 31 Dec")).toBeInTheDocument();
    expect(p.getByText("Weekly: 3 sessions")).toBeInTheDocument();
    // Overall from the milestone-flagged tasks: 1 of 2.
    expect(p.getByText("Overall · milestones")).toBeInTheDocument();
    expect(p.getByRole("progressbar", { name: "Overall 1/2" })).toHaveAttribute("aria-valuenow", "50");
    expect(p.getByText("October: 1 of 6 sessions")).toBeInTheDocument();
    expect(p.getAllByText("1 month in a row").length).toBeGreaterThan(0);
    expect(p.getByText("1/6")).toBeInTheDocument();
    expect(p.getByText("A pretend reason <b>x</b>")).toBeInTheDocument();
    expect(document.querySelector(".peek b:not(.goal-peek-stat b)")).toBeNull();
    const toCome = p.getByRole("list", { name: "To come" });
    expect(within(toCome).getAllByRole("listitem").map((li) => li.querySelector(".strip-title")!.textContent)).toEqual([
      "Book a writing day",
      "Milestone: Draft part 2",
    ]);
    const done = p.getByRole("list", { name: "Completed" });
    expect(within(done).getByText("Send chapter 3")).toBeInTheDocument();
    expect(within(done).getByText("Outline all parts")).toBeInTheDocument();
    expect(p.getByRole("button", { name: "Delete goal" })).toBeInTheDocument();
  });

  it("a goal with no linked tasks has no overall bar", async () => {
    const g = await createGoal({ title: "Empty", areaId: "art", kind: "finite", deadline: "2026-12-31" }, TODAY);
    const p = await openGoal(g.id);
    expect(p.queryByText(/Overall/)).toBeNull();
    expect(p.getByText("No open tasks attached to this goal.")).toBeInTheDocument();
  });

  it("Completed shows the 10 most recent, newest first, then Show all", async () => {
    const g = await createGoal({ title: "Lots done", areaId: "art", kind: "practice" }, TODAY);
    for (let d = 1; d <= 12; d++) {
      const day = `2026-10-${String(d).padStart(2, "0")}`;
      const t = await createItem({ kind: "task", title: `Done on ${d}`, areaId: "art", priority: 2, goalId: g.id }, day);
      await tickItem(t.id, day);
    }
    const p = await openGoal(g.id);
    const done = p.getByRole("list", { name: "Completed" });
    const titles = () => within(done).getAllByRole("listitem").map((li) => li.querySelector(".strip-title")!.textContent);
    expect(titles()).toHaveLength(10);
    expect(titles()[0]).toBe("Done on 12");
    await userEvent.click(p.getByRole("button", { name: "Show all" }));
    expect(titles()).toHaveLength(12);
  });

  it("ticking a task in the panel raises the month bar; unticking a completed one lowers it", async () => {
    const g = await createGoal({ title: "Write", areaId: "writing", kind: "practice", monthlyTarget: 4 }, TODAY);
    await createItem({ kind: "task", title: "Draft", areaId: "writing", priority: 3, goalId: g.id }, TODAY);
    const p = await openGoal(g.id);
    expect(p.getByRole("progressbar", { name: "This month 0/4" })).toBeInTheDocument();
    await userEvent.click(p.getByRole("checkbox", { name: "Mark done: Draft" }));
    expect(await p.findByRole("progressbar", { name: "This month 1/4" })).toBeInTheDocument();
    expect(within(p.getByRole("list", { name: "Completed" })).getByText("Draft")).toBeInTheDocument();
    await userEvent.click(p.getByRole("checkbox", { name: "Done: Draft" }));
    expect(await p.findByRole("progressbar", { name: "This month 0/4" })).toBeInTheDocument();
  });

  it("+ Add a task makes a to-do in the goal's area with the goal linked (it shows in that area's To-dos)", async () => {
    const g = await createGoal({ title: "Pretend zine", areaId: "art", kind: "practice" }, TODAY);
    const p = await openGoal(g.id, "/area/art");
    await userEvent.click(p.getByRole("button", { name: "+ Add a task" }));
    await userEvent.type(p.getByLabelText("New task for this goal"), "Fold the pages{enter}");
    expect(within(await p.findByRole("list", { name: "To come" })).getByText("Fold the pages")).toBeInTheDocument();
    const [t] = await db.items.toArray();
    expect(t).toMatchObject({ kind: "task", areaId: "art", goalId: g.id, status: "open" });
    await vi.waitFor(() => expect(within(screen.getByRole("list", { name: "To-dos" })).getByText("Fold the pages")).toBeInTheDocument());
  });

  it("+ Add a task appends after the goal's existing steps (review I-1)", async () => {
    const g = await createGoal(
      {
        title: "Ordered goal", areaId: "art", kind: "finite", deadline: "2026-12-31",
        milestones: [{ id: "x", title: "Step one", done: false }, { id: "y", title: "Step two", done: false }],
      },
      TODAY,
    );
    const p = await openGoal(g.id);
    await userEvent.click(p.getByRole("button", { name: "+ Add a task" }));
    await userEvent.type(p.getByLabelText("New task for this goal"), "Step three{enter}");
    const list = p.getByRole("list", { name: "To come" });
    await vi.waitFor(() =>
      expect(within(list).getAllByRole("listitem").map((li) => li.querySelector(".strip-title")!.textContent)).toEqual([
        "Milestone: Step one", "Milestone: Step two", "Step three",
      ]),
    );
    expect((await db.items.toArray()).find((t) => t.title === "Step three")!.order).toBe(2);
  });

  it("clicking a task in the goal panel swaps the panel to that task", async () => {
    const g = await createGoal({ title: "Swap goal", areaId: "art", kind: "practice" }, TODAY);
    const t = await createItem({ kind: "task", title: "Swap to me", areaId: "art", priority: 2, goalId: g.id }, TODAY);
    const p = await openGoal(g.id);
    await userEvent.click(p.getByRole("button", { name: "Swap to me" }));
    expect(await screen.findByRole("complementary", { name: "Swap to me" })).toBeInTheDocument();
    expect(currentUrl).toBe(`/goals?open=${t.id}`);
  });

  it("notes are typeable without Edit and save after a pause, keeping the text exactly", async () => {
    const g = await createGoal({ title: "Noted", areaId: "art", kind: "practice", notes: "Study <b>these</b>" }, TODAY);
    const p = await openGoal(g.id);
    await userEvent.click(p.getByText("Study <b>these</b>"));
    const line = p.getByRole("textbox", { name: "Notes: text 1" });
    expect(line).toHaveValue("Study <b>these</b>");
    await userEvent.clear(line);
    await userEvent.type(line, "# Plan{Enter}- [[ ] a pretend step");
    await vi.waitFor(async () => expect((await db.goals.get(g.id))!.notes).toBe("# Plan\n- [ ] a pretend step"), { timeout: 3000 });
  });
});

describe("the goal panel (Edit)", () => {
  const finite = {
    id: "ef", title: "Edit me", areaId: "art" as const, kind: "finite" as const, deadline: "2026-12-31",
    monthlyTarget: 2, milestones: [], createdAt: TODAY,
    why: "kept", source: { kind: "obsidian" as const, key: "obsidian:goal:edit me" },
  };

  it("Edit shows the fields filled from the goal; Done saves through the repo", async () => {
    await db.goals.add(finite);
    const p = await openGoal("ef");
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    expect(p.getByLabelText("Title")).toHaveValue("Edit me");
    expect(p.getByLabelText("Area")).toHaveValue("art");
    expect(p.getByLabelText("Type")).toHaveValue("finite");
    expect(p.getByLabelText("Deadline")).toHaveValue("2026-12-31");
    expect(p.getByLabelText("Monthly target")).toHaveValue(2);
    expect(p.getByLabelText("Why it matters")).toHaveValue("kept");
    const opts = within(p.getByLabelText("Area")).getAllByRole("option").map((o) => o.textContent);
    expect(opts).not.toContain("Inbox");
    fireEvent.change(p.getByLabelText("Title"), { target: { value: "Renamed" } });
    await userEvent.selectOptions(p.getByLabelText("Area"), "admin");
    fireEvent.change(p.getByLabelText("Deadline"), { target: { value: "2027-03-01" } });
    fireEvent.change(p.getByLabelText("Monthly target"), { target: { value: "" } });
    fireEvent.change(p.getByLabelText("How often"), { target: { value: "Weekly: 2" } });
    fireEvent.change(p.getByLabelText("Why it matters"), { target: { value: "A new pretend reason" } });
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    expect(await p.findByRole("heading", { level: 2, name: "Renamed" })).toBeInTheDocument();
    const got = (await db.goals.get("ef"))!;
    expect(got).toMatchObject({ title: "Renamed", areaId: "admin", deadline: "2027-03-01", cadence: "Weekly: 2", why: "A new pretend reason", source: finite.source });
    expect(got.monthlyTarget).toBeUndefined();
  });

  it("Cancel and Escape discard unsaved field changes (Escape does not close the panel while editing)", async () => {
    await db.goals.add(finite);
    const p = await openGoal("ef");
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    fireEvent.change(p.getByLabelText("Title"), { target: { value: "Not kept" } });
    await userEvent.click(p.getByRole("button", { name: "Cancel" }));
    expect(p.getByRole("heading", { level: 2, name: "Edit me" })).toBeInTheDocument();
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    expect(p.getByLabelText("Title")).toHaveValue("Edit me");
    fireEvent.change(p.getByLabelText("Title"), { target: { value: "Not kept either" } });
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("complementary", { name: /\S/ })).toBeInTheDocument();
    expect(p.getByRole("heading", { level: 2, name: "Edit me" })).toBeInTheDocument();
    expect((await db.goals.get("ef"))!.title).toBe("Edit me");
  });

  it("switching to Practice drops the deadline; the messages guard title, deadline and target", async () => {
    await db.goals.add(finite);
    const p = await openGoal("ef");
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    fireEvent.change(p.getByLabelText("Deadline"), { target: { value: "" } });
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    expect(await p.findByText("A finite goal needs a deadline.")).toBeInTheDocument();
    fireEvent.change(p.getByLabelText("Title"), { target: { value: "  " } });
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    expect(await p.findByText("Give the goal a title.")).toBeInTheDocument();
    fireEvent.change(p.getByLabelText("Title"), { target: { value: "ok" } });
    await userEvent.selectOptions(p.getByLabelText("Type"), "practice");
    expect(p.queryByLabelText("Deadline")).toBeNull();
    fireEvent.change(p.getByLabelText("Monthly target"), { target: { value: "0" } });
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    expect(await p.findByText("A monthly target is a whole number, 1 or more.")).toBeInTheDocument();
    fireEvent.change(p.getByLabelText("Monthly target"), { target: { value: "3" } });
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    expect(await p.findByText("Practice", { selector: ".chip" })).toBeInTheDocument();
    const got = (await db.goals.get("ef"))!;
    expect(got).toMatchObject({ kind: "practice", title: "ok", monthlyTarget: 3 });
    expect(got.deadline).toBeUndefined();
  });

  it("a failed save shows the calm message and stays in Edit", async () => {
    await db.goals.add(finite);
    const p = await openGoal("ef");
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    fireEvent.change(p.getByLabelText("Title"), { target: { value: "Will not save" } });
    vi.spyOn(repo, "updateGoal").mockRejectedValue(new Error("boom"));
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    expect(await p.findByText("That did not save. Try again.")).toBeInTheDocument();
    expect(p.getByLabelText("Title")).toBeInTheDocument();
  });

  it("Done writes only what was changed, so a why synced in meanwhile is kept (review M-3)", async () => {
    await db.goals.add(finite);
    const p = await openGoal("ef");
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    await db.goals.update("ef", { why: "Synced from the phone" });
    fireEvent.change(p.getByLabelText("Title"), { target: { value: "Only the title" } });
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    expect(await p.findByRole("heading", { level: 2, name: "Only the title" })).toBeInTheDocument();
    expect(await db.goals.get("ef")).toMatchObject({ title: "Only the title", why: "Synced from the phone", deadline: "2026-12-31" });
  });
});

describe("habits in a goal's To come (review M-4)", () => {
  it("a habit ticked today shows crossed off there and can be unticked", async () => {
    const g = await createGoal({ title: "Habit goal", areaId: "art", kind: "practice" }, TODAY);
    const h = await createItem({ kind: "task", title: "Pretend daily sketch", areaId: "art", priority: 2, goalId: g.id, recur: ["wed"], doneDates: [TODAY] }, TODAY);
    const p = await openGoal(g.id);
    const box = p.getByRole("checkbox", { name: "Done: Pretend daily sketch" });
    expect(box).toBeChecked();
    expect(box.closest("li")).toHaveClass("crossed");
    await userEvent.click(box);
    expect(await p.findByRole("checkbox", { name: "Mark done: Pretend daily sketch" })).not.toBeChecked();
    expect((await db.items.get(h.id))!.doneDates).toBeUndefined();
  });
});

describe("Delete goal (at the bottom of the panel)", () => {
  it("asks first; Cancel keeps the goal", async () => {
    const g = await createGoal({ title: "Pretend goal", areaId: "art", kind: "practice" }, TODAY);
    const p = await openGoal(g.id);
    await userEvent.click(p.getByRole("button", { name: "Delete goal" }));
    expect(p.getByText("Delete this goal? You can restore it from the Bin.")).toBeInTheDocument();
    expect(p.getByRole("button", { name: "Cancel" })).toHaveFocus();
    await userEvent.click(p.getByRole("button", { name: "Cancel" }));
    expect(p.queryByText(/restore it from the Bin/)).toBeNull();
    expect((await db.goals.get(g.id))!.status).toBeUndefined();
  });

  it("Confirm sends it to the Bin and closes the panel; it is no longer listed; its tasks keep their goalId", async () => {
    const g = await createGoal({ title: "Pretend goal", areaId: "art", kind: "practice" }, TODAY);
    const t = await createItem({ kind: "task", title: "Pretend step", areaId: "art", priority: 2, goalId: g.id }, TODAY);
    const p = await openGoal(g.id);
    const del = p.getByRole("button", { name: "Delete goal" });
    expect(del).toHaveClass("btn-secondary");
    await userEvent.click(del);
    await userEvent.click(p.getByRole("button", { name: "Confirm" }));
    await vi.waitFor(() => expect(screen.queryByRole("complementary", { name: /\S/ })).toBeNull());
    expect(screen.queryByRole("link", { name: "Pretend goal" })).toBeNull();
    expect((await listGoalBin()).map((x) => x.id)).toEqual([g.id]);
    expect((await db.items.get(t.id))!.goalId).toBe(g.id);
  });

  it("a deleted goal does not open, and is gone from its area page", async () => {
    const g = await createGoal({ title: "Hidden goal", areaId: "art", kind: "practice", monthlyTarget: 2 }, TODAY);
    await repo.deleteGoal(g.id, TODAY);
    renderApp(`/area/art?open=${g.id}`, TODAY);
    await screen.findByRole("heading", { level: 1, name: "Art" });
    expect(screen.queryByText("Hidden goal")).toBeNull();
    expect(screen.queryByRole("complementary", { name: /\S/ })).toBeNull();
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
    const p = await openGoal(g.id);
    await userEvent.click(p.getByRole("button", { name: "Delete goal" }));
    await userEvent.click(p.getByRole("button", { name: "Confirm" }));
    expect(await p.findByText("That did not save. Try again.")).toBeInTheDocument();
    expect(p.getByRole("heading", { level: 2, name: "Stubborn goal" })).toBeInTheDocument();
  });
});

