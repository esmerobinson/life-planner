import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createItem } from "../data/repo";
import type { Item, Session } from "../domain/types";
import { renderApp } from "../test/renderApp";

// Project to-dos on the lists (mockup add-and-projects.html option 2C). Pretend data only.
const TODAY = "2026-11-02"; // a Monday
const MADE = "2026-10-29";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});
afterEach(() => vi.useRealTimers());

function project(sessions: Session[], o: Partial<Item> = {}) {
  return createItem(
    { kind: "task", title: "Pretend street scene", areaId: "art", priority: 2, due: "2026-11-09", sessions, ...o },
    MADE,
  );
}
const FOUR: Session[] = [
  { id: "a", title: "Block out the street", doneOn: "2026-10-30" },
  { id: "b", doneOn: "2026-11-01" },
  { id: "c", title: "Lighting and papel picado", details: "Warm dusk light; strings of papel picado over the stalls" },
  { id: "d" },
];
const rowOf = async (title = "Pretend street scene", list = "To-dos") =>
  (await within(await screen.findByRole("list", { name: list })).findByText(title, { selector: ".strip-title" })).closest(
    "li",
  ) as HTMLElement;

describe("a project on an area page (2C)", () => {
  it("shows Next: <session title> and the due line with days left, one small box per session and the countdown edge", async () => {
    await project(FOUR);
    renderApp("/area/art", TODAY);
    const row = await rowOf();
    expect(row).toHaveClass("project-row");
    expect(within(row).getByText("Next: Lighting and papel picado")).toBeInTheDocument();
    expect(within(row).getByText("Due Mon 9 Nov · 7 days left")).toBeInTheDocument();
    const boxes = within(within(row).getByRole("group", { name: "Sessions: Pretend street scene" })).getAllByRole("checkbox");
    expect(boxes.map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "true", "false", "false"]);
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Session 1: Block out the street", "Session 2", "Session 3: Lighting and papel picado", "Session 4",
    ]);
    const fill = row.querySelector(".project-edge-fill") as HTMLElement;
    expect(fill.style.width).toBe(`${(100 * 7) / 11}%`);
    // The next session has details: they are behind See more (compact strips).
    expect(within(row).getByRole("button", { name: "See more: Pretend street scene" })).toBeInTheDocument();
  });

  it("an unnamed next session reads Session N of M", async () => {
    await project([{ id: "a", doneOn: "2026-10-30" }, { id: "b" }]);
    renderApp("/area/art", TODAY);
    expect(within(await rowOf()).getByText("Session 2 of 2")).toBeInTheDocument();
  });

  it("the main checkbox logs the next session today; the row stays", async () => {
    const p = await project(FOUR);
    renderApp("/area/art", TODAY);
    await userEvent.click(within(await rowOf()).getByRole("checkbox", { name: "Log a session: Pretend street scene" }));
    await vi.waitFor(async () => expect((await db.items.get(p.id))!.sessions![2].doneOn).toBe(TODAY));
    const row = await rowOf();
    await vi.waitFor(() => expect(within(row).getByText("Session 4 of 4")).toBeInTheDocument());
    expect(within(row).getByRole("checkbox", { name: "Log a session: Pretend street scene" })).not.toBeChecked();
  });

  it("a session box ticks and unticks that session; the last one sends it to Done", async () => {
    const p = await project([{ id: "a", doneOn: "2026-10-30" }, { id: "b" }]);
    renderApp("/area/art", TODAY);
    await userEvent.click(within(await rowOf()).getByRole("checkbox", { name: "Session 1" }));
    await vi.waitFor(async () => expect((await db.items.get(p.id))!.sessions![0].doneOn).toBeUndefined());
    await userEvent.click(within(await rowOf()).getByRole("checkbox", { name: "Session 2" }));
    await userEvent.click(within(await rowOf()).getByRole("checkbox", { name: "Session 1" }));
    await vi.waitFor(async () => expect(await db.items.get(p.id)).toMatchObject({ status: "done", completedAt: TODAY }));
    await vi.waitFor(() => expect(screen.queryByRole("list", { name: "To-dos" })).toBeNull());
  });
});

describe("a project on Today", () => {
  it("shows when a session is planned for today: Session N of M today · <title> and Due …", async () => {
    await project([{ id: "a", doneOn: "2026-10-30" }, { id: "b", title: "Market stalls", plannedFor: TODAY }, { id: "c" }], {
      due: "2026-11-20",
    });
    renderApp("/", TODAY);
    const row = await rowOf("Pretend street scene", "Today");
    expect(within(row).getByText("Session 2 of 3 today · Market stalls")).toBeInTheDocument();
    expect(within(row).getByText("Due Fri 20 Nov")).toBeInTheDocument();
  });

  it("ticked today, it stays crossed out with the session done today; unticking brings it back", async () => {
    const p = await project([{ id: "a" }, { id: "b" }], { due: "2026-11-04" });
    renderApp("/", TODAY);
    await userEvent.click(within(await rowOf("Pretend street scene", "Today")).getByRole("checkbox", { name: "Log a session: Pretend street scene" }));
    await vi.waitFor(async () => expect((await db.items.get(p.id))!.sessions![0].doneOn).toBe(TODAY));
    const row = await rowOf("Pretend street scene", "Today");
    await vi.waitFor(() => expect(row).toHaveClass("crossed"));
    expect(within(row).getByText("Session 1 of 2 done today")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("checkbox", { name: "Done: Pretend street scene" }));
    await vi.waitFor(async () => expect((await db.items.get(p.id))!.sessions![0].doneOn).toBeUndefined());
  });
});

describe("Change to → Project (the arrow menu)", () => {
  it("a to-do becomes a project with 4 sessions, keeping its deadline and notes", async () => {
    const t = await createItem(
      { kind: "task", title: "Pretend mural", areaId: "art", priority: 2, due: "2026-11-09", notes: "Pretend notes" },
      MADE,
    );
    renderApp("/area/art", TODAY);
    const row = await rowOf("Pretend mural");
    await userEvent.click(within(row).getByRole("button", { name: "Move to: Pretend mural" }));
    const change = within(row).getByRole("group", { name: "Change to" });
    expect(within(change).getAllByRole("button").map((b) => b.textContent)).toEqual(["Project", "Idea", "Goal"]);
    await userEvent.click(within(change).getByRole("button", { name: "Project" }));
    await vi.waitFor(async () => expect((await db.items.get(t.id))!.sessions).toHaveLength(4));
    expect(await db.items.get(t.id)).toMatchObject({ due: "2026-11-09", notes: "Pretend notes", kind: "task" });
  });

  it("a project offers To-do, Idea, Goal; To-do drops the sessions", async () => {
    const p = await project(FOUR);
    renderApp("/area/art", TODAY);
    const row = await rowOf();
    await userEvent.click(within(row).getByRole("button", { name: "Move to: Pretend street scene" }));
    const change = within(row).getByRole("group", { name: "Change to" });
    expect(within(change).getAllByRole("button").map((b) => b.textContent)).toEqual(["To-do", "Idea", "Goal"]);
    await userEvent.click(within(change).getByRole("button", { name: "To-do" }));
    await vi.waitFor(async () => expect((await db.items.get(p.id))!.sessions).toBeUndefined());
  });

  it("To-do or Idea drops the sessions with an Undo that brings every session back as it was (I-2)", async () => {
    const p = await project(FOUR);
    const before = (await db.items.get(p.id))!;
    renderApp("/area/art", TODAY);
    for (const to of ["To-do", "Idea"]) {
      const row = await rowOf();
      await userEvent.click(within(row).getByRole("button", { name: "Move to: Pretend street scene" }));
      await userEvent.click(within(within(row).getByRole("group", { name: "Change to" })).getByRole("button", { name: to }));
      await vi.waitFor(async () => expect((await db.items.get(p.id))!.sessions).toBeUndefined());
      expect(
        await screen.findByText(new RegExp(`^Changed to ${to === "To-do" ? "a to-do" : "an idea"}, without its sessions`), {
          selector: ".shell-undo p",
        }),
      ).toBeInTheDocument();
      await userEvent.click(await screen.findByRole("button", { name: "Undo" }));
      await vi.waitFor(async () => expect((await db.items.get(p.id))!.sessions).toEqual(FOUR));
      const back = (await db.items.get(p.id))!;
      expect({ ...back, updatedAt: 0, touchedAt: "" }).toEqual({ ...before, updatedAt: 0, touchedAt: "" });
      await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Undo" })).toBeNull());
    }
  });

  it("a to-do done today sits in 'Done today' as a plain done strip, with no Move to menu (M-8)", async () => {
    const t = await createItem({ kind: "task", title: "Pretend done today", areaId: "art", priority: 2 }, MADE);
    await db.items.update(t.id, { status: "done", completedAt: TODAY });
    renderApp("/", TODAY);
    const fold = (await screen.findByText("Done today (1)")).closest("details")!;
    expect(within(fold).getByText("Pretend done today")).toBeInTheDocument();
    expect(within(fold).queryByRole("button", { name: "Move to: Pretend done today" })).toBeNull();
  });

  it("an idea offers To-do and Project", async () => {
    await createItem({ kind: "idea", title: "Pretend idea", areaId: "art", priority: 2 }, MADE);
    renderApp("/area/art", TODAY);
    const row = await rowOf("Pretend idea", "Ideas");
    await userEvent.click(within(row).getByRole("button", { name: "Move to: Pretend idea" }));
    const change = within(row).getByRole("group", { name: "Change to" });
    expect(within(change).getAllByRole("button").map((b) => b.textContent)).toEqual(["To-do", "Project", "Goal"]);
  });
});
