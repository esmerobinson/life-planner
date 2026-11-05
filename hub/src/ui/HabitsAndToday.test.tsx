import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createItem, tickItem } from "../data/repo";
import { renderApp } from "../test/renderApp";

// 2026-10-28 is a Wednesday. October 2026 has 31 days; 27 of them are not Sundays.
const TODAY = "2026-10-28";
const EVERY_DAY_BUT_SUNDAY = ["mon", "tue", "wed", "thu", "fri", "sat"] as const;

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});
afterEach(() => vi.useRealTimers());

const habit = (title: string, extra: Record<string, unknown> = {}) =>
  createItem({ kind: "task", title, areaId: "writing", priority: 2, recur: [...EVERY_DAY_BUT_SUNDAY], ...extra }, TODAY);

describe("the Habits box on an area page", () => {
  it("lists the area's recurring to-dos with their schedule and month sessions; they are not in To-dos", async () => {
    await habit("Pretend book session", { doneDates: ["2026-09-30", "2026-10-01", "2026-10-02"] });
    await createItem({ kind: "task", title: "Mondays only", areaId: "writing", priority: 2, recur: ["mon"] }, TODAY);
    await createItem({ kind: "task", title: "A normal to-do", areaId: "writing", priority: 2 }, TODAY);
    renderApp("/area/writing", TODAY);
    const box = await screen.findByRole("region", { name: "Habits" });
    const list = within(box).getByRole("list", { name: "Habits" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(box).getByText("every day but Sunday")).toBeInTheDocument();
    expect(within(box).getByText("Mondays")).toBeInTheDocument();
    expect(within(box).getByText("2 of 27 this month")).toBeInTheDocument();
    expect(within(box).getByText("0 of 4 this month")).toBeInTheDocument();
    const todos = screen.getByRole("list", { name: "To-dos" });
    expect(within(todos).getByText("A normal to-do")).toBeInTheDocument();
    expect(within(todos).queryByText("Pretend book session")).toBeNull();
  });

  it("ticking a habit: stays in place, struck through, 'Done for today', session counts, celebration; never Done", async () => {
    const h = await habit("Pretend book session");
    renderApp("/area/writing", TODAY);
    const box = await screen.findByRole("region", { name: "Habits" });
    await userEvent.click(within(box).getByRole("checkbox", { name: "Mark done: Pretend book session" }));
    expect(await screen.findByTestId("celebration-placeholder")).toBeInTheDocument();
    expect(await within(box).findByText("Done for today")).toBeInTheDocument();
    const row = within(box).getByRole("checkbox", { name: "Done: Pretend book session" }).closest("li")!;
    expect(row).toHaveClass("crossed");
    expect(within(row).getByRole("checkbox")).toBeChecked();
    expect(within(box).getByText("1 of 27 this month")).toBeInTheDocument();
    const got = (await db.items.get(h.id))!;
    expect(got.status).toBe("open");
    expect(got.doneDates).toEqual([TODAY]);
    // The month count counts the session as a tick-off; the Done fold-out does not list it.
    expect(screen.getByText("1 ticked off in October")).toBeInTheDocument();
    expect(screen.getByText("Done (0)")).toBeInTheDocument();
    // Unticking brings it back.
    await userEvent.click(within(row).getByRole("checkbox"));
    expect(await within(box).findByText("every day but Sunday")).toBeInTheDocument();
    expect((await db.items.get(h.id))!.doneDates).toBeUndefined();
  });

  it("the next day it is unticked again with no write", async () => {
    await habit("Pretend book session", { doneDates: ["2026-10-27"] });
    renderApp("/area/writing", TODAY);
    const box = await screen.findByRole("region", { name: "Habits" });
    expect(within(box).getByRole("checkbox", { name: "Mark done: Pretend book session" })).not.toBeChecked();
    expect(within(box).queryByText("Done for today")).toBeNull();
  });

  it("an area without habits has no Habits box", async () => {
    await createItem({ kind: "task", title: "A normal to-do", areaId: "writing", priority: 2 }, TODAY);
    renderApp("/area/writing", TODAY);
    await screen.findByText("A normal to-do");
    expect(screen.queryByRole("region", { name: "Habits" })).toBeNull();
  });
});

describe("Today keeps what was ticked off today", () => {
  it("a ticked to-do leaves the list for a closed 'Done today (N)' dropdown; unticking brings it back", async () => {
    await createItem({ kind: "task", title: "First pretend", areaId: "art", priority: 2, pinnedDate: TODAY }, TODAY);
    await createItem({ kind: "task", title: "Second pretend", areaId: "art", priority: 2, pinnedDate: TODAY }, TODAY);
    renderApp("/", TODAY);
    const list = await screen.findByRole("list", { name: "Today" });
    const titles = () => within(list).getAllByRole("listitem").map((li) => li.querySelector(".strip-title")!.textContent);
    expect(titles().sort()).toEqual(["First pretend", "Second pretend"]);
    expect(screen.queryByText(/^Done today/)).toBeNull(); // hidden at 0
    await userEvent.click(within(list).getByRole("checkbox", { name: "Mark done: First pretend" }));
    const summary = await screen.findByText("Done today (1)");
    const fold = summary.closest("details")!;
    expect(fold).not.toHaveAttribute("open");
    expect(titles()).toEqual(["Second pretend"]);
    const crossed = within(fold).getByRole("checkbox", { name: "Done: First pretend", hidden: true });
    expect(crossed).toBeChecked();
    expect(crossed.closest("li")).toHaveClass("crossed");
    await userEvent.click(summary);
    await userEvent.click(crossed);
    await vi.waitFor(() => expect(within(list).getByRole("checkbox", { name: "Mark done: First pretend" })).not.toBeChecked());
    expect(screen.queryByText(/^Done today/)).toBeNull();
  });

  it("a to-do done earlier today elsewhere is in 'Done today'; one done yesterday is nowhere", async () => {
    const a = await createItem({ kind: "task", title: "Done today", areaId: "art", priority: 2 }, TODAY);
    await tickItem(a.id, TODAY);
    const b = await createItem({ kind: "task", title: "Done yesterday", areaId: "art", priority: 2 }, TODAY);
    await tickItem(b.id, "2026-10-27");
    renderApp("/", TODAY);
    const fold = (await screen.findByText("Done today (1)")).closest("details")!;
    expect(within(fold).getByRole("checkbox", { name: "Done: Done today", hidden: true })).toBeChecked();
    expect(screen.queryByText("Done yesterday")).toBeNull();
  });

  it("a project whose session was ticked (not finished) stays in the list, crossed off", async () => {
    const p = await createItem(
      { kind: "task", title: "Pretend project", areaId: "art", priority: 2, pinnedDate: TODAY, sessions: [{ id: "s1" }, { id: "s2" }] },
      TODAY,
    );
    await tickItem(p.id, TODAY);
    renderApp("/", TODAY);
    const list = await screen.findByRole("list", { name: "Today" });
    expect(within(list).getByRole("checkbox", { name: "Done: Pretend project" }).closest("li")).toHaveClass("crossed");
    expect(screen.queryByText(/^Done today/)).toBeNull();
  });

  it("a project whose last session is ticked moves to 'Done today'", async () => {
    const p = await createItem(
      { kind: "task", title: "Pretend project", areaId: "art", priority: 2, pinnedDate: TODAY, sessions: [{ id: "s1" }] },
      TODAY,
    );
    await tickItem(p.id, TODAY);
    renderApp("/", TODAY);
    const fold = (await screen.findByText("Done today (1)")).closest("details")!;
    expect(within(fold).getByText("Pretend project")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Today" })).toBeNull();
  });

  it("a habit ticked on Today stays in the rhythm list, crossed out, last", async () => {
    await habit("Pretend stretch");
    await habit("Pretend walk");
    renderApp("/", TODAY);
    const rhythm = await screen.findByRole("list", { name: "Rhythm" });
    await userEvent.click(within(rhythm).getByRole("checkbox", { name: "Mark done: Pretend stretch" }));
    await vi.waitFor(() =>
      expect(within(rhythm).getAllByRole("listitem").map((li) => li.querySelector(".strip-title")!.textContent)).toEqual([
        "Pretend walk",
        "Pretend stretch",
      ]),
    );
    expect(await within(rhythm).findByText("Done for today")).toBeInTheDocument();
    expect(within(rhythm).getAllByRole("listitem")[1]).toHaveClass("crossed");
  });
});
