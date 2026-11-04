// Testing session (everyday walkthrough, goals). Each test here FAILS on purpose: it shows a bug
// Esme would hit. Do not "fix" the test; fix the app.
//
// 1. A double-click (or a double-tap) on Add under "+ Add a November goal" makes the same
//    monthly goal twice: the tile shows "Writing sessions 0 / 12" two times and "0 of 2 done".
// 2. A double-click on Add under "+ Add a task" in a goal's panel makes the same task twice,
//    both listed under To come.
// 3. Goals in one area are listed in a random order (the order of their random ids), not the
//    order she added them: a goal she adds today can land above or below older ones, and the
//    same goals came out in a different order in two fresh runs.
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../data/db";
import { createGoal } from "../data/repo";
import type { Goal } from "../domain/types";
import { renderApp } from "../test/renderApp";
import { GoalsPage } from "./GoalsPage";

const TODAY = "2026-11-04";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});
afterEach(() => vi.useRealTimers());

describe("Testing: goals, everyday use", () => {
  it("a double-click on Add under '+ Add a November goal' makes ONE monthly goal", async () => {
    const g = await createGoal({ title: "Write the pretend novel", areaId: "writing", kind: "practice" }, TODAY);
    render(
      <MemoryRouter initialEntries={["/goals"]}>
        <GoalsPage today={TODAY} />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "+ Add a November goal" }));
    const form = screen.getByRole("form", { name: "Add a November goal" });
    await userEvent.type(within(form).getByLabelText("Title"), "Writing sessions");
    await userEvent.type(within(form).getByLabelText("Target"), "12");
    const add = within(form).getByRole("button", { name: "Add" });
    fireEvent.click(add);
    fireEvent.click(add); // the second click of a double-click, before the first save has finished
    await vi.waitFor(async () => expect((await db.goals.get(g.id))?.monthGoals?.length ?? 0).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 100));
    const titles = ((await db.goals.get(g.id))?.monthGoals ?? []).map((m) => m.title);
    expect(titles).toEqual(["Writing sessions"]);
  });

  it("a double-click on Add under '+ Add a task' in the goal panel makes ONE task", async () => {
    const g = await createGoal({ title: "Learn the pretend cello", areaId: "art", kind: "practice" }, TODAY);
    renderApp(`/goals?open=${g.id}`, TODAY);
    const p = within(await screen.findByRole("complementary", { name: /\S/ }));
    await userEvent.click(p.getByRole("button", { name: "+ Add a task" }));
    await userEvent.type(p.getByLabelText("New task for this goal"), "Book a first lesson");
    const add = p.getByRole("button", { name: "Add" });
    fireEvent.click(add);
    fireEvent.click(add);
    await vi.waitFor(async () => expect(await db.items.count()).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 100));
    const titles = (await db.items.toArray()).map((i) => i.title);
    expect(titles).toEqual(["Book a first lesson"]);
  });

  it("goals in one area are listed oldest first (the order she added them), not by their random ids", async () => {
    const base: Omit<Goal, "id" | "title" | "createdAt"> = { areaId: "art", kind: "practice", milestones: [] };
    // Ids as crypto.randomUUID might hand them out: the newer goal happens to get the "smaller" id.
    await db.goals.put({ ...base, id: "f0a1c2d3-older", title: "Older pretend goal", createdAt: "2026-09-01" });
    await db.goals.put({ ...base, id: "0b1c2d3e-newer", title: "Newer pretend goal", createdAt: "2026-11-03" });
    render(
      <MemoryRouter initialEntries={["/goals"]}>
        <GoalsPage today={TODAY} />
      </MemoryRouter>,
    );
    const list = await screen.findByRole("list", { name: "Art goals" });
    const shown = within(list).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(shown).toEqual(["Older pretend goal", "Newer pretend goal"]);
  });
});
