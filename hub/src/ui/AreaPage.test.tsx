import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db } from "../data/db";
import { archiveItem, createGoal, createItem, tickItem } from "../data/repo";
import { AreaPage } from "./AreaPage";

const TODAY = "2026-10-27";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

function renderArea(areaId: string) {
  return render(
    <MemoryRouter initialEntries={[`/area/${areaId}`]}>
      <Routes>
        <Route path="/area/:areaId" element={<AreaPage today={TODAY} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AreaPage", () => {
  it("area page toggles between to-dos, ideas and goals", async () => {
    await createItem({ kind: "task", title: "A task", areaId: "art", priority: 3 }, TODAY);
    await createItem({ kind: "idea", title: "An idea", areaId: "art", priority: 3 }, TODAY);
    await createItem({ kind: "task", title: "Other area task", areaId: "body", priority: 3 }, TODAY);
    await createGoal({ title: "A goal", areaId: "art", kind: "practice" }, TODAY);
    renderArea("art");
    expect(await screen.findByText("A task")).toBeInTheDocument();
    expect(screen.getByText("An idea")).toBeInTheDocument();
    expect(screen.getByText("A goal")).toBeInTheDocument();
    expect(screen.queryByText("Other area task")).not.toBeInTheDocument();
    const filter = screen.getByRole("group", { name: "Show" });
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
    expect(within(filter).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(within(filter).getByRole("button", { name: "To-dos" })).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(within(filter).getByRole("button", { name: "To-dos" }));
    expect(within(filter).getByRole("button", { name: "To-dos" })).toHaveAttribute("aria-pressed", "true");
    expect(within(filter).getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("A task")).toBeInTheDocument();
    expect(screen.queryByText("An idea")).not.toBeInTheDocument();
    expect(screen.queryByText("A goal")).not.toBeInTheDocument();

    await userEvent.click(within(filter).getByRole("button", { name: "Ideas" }));
    expect(screen.getByText("An idea")).toBeInTheDocument();
    expect(screen.queryByText("A task")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /^Mark done:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Schedule for: An idea" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move to: An idea" })).toBeInTheDocument();

    await userEvent.click(within(filter).getByRole("button", { name: "Goals" }));
    expect(screen.getByText("A goal")).toBeInTheDocument();
    expect(screen.queryByText("An idea")).not.toBeInTheDocument();
  });

  it("archived item appears in Archive and restore returns it", async () => {
    const it = await createItem({ kind: "task", title: "Old plan", areaId: "mind", priority: 3 }, TODAY);
    await archiveItem(it.id, TODAY);
    renderArea("mind");
    const archive = await screen.findByRole("list", { name: "Archive" });
    expect(within(archive).getByText("Old plan")).toBeInTheDocument();
    await userEvent.click(within(archive).getByRole("button", { name: "Restore: Old plan" }));
    await screen.findByText("Nothing archived.");
    await userEvent.click(screen.getByRole("button", { name: "To-dos" }));
    expect(screen.getByRole("checkbox", { name: "Mark done: Old plan" })).toBeInTheDocument();
  });

  it("ticking a task marks it done", async () => {
    await createItem({ kind: "task", title: "Tick me", areaId: "body", priority: 3 }, TODAY);
    renderArea("body");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Mark done: Tick me" }));
    await screen.findByText("Nothing here yet.");
    expect((await db.items.toArray())[0].status).toBe("done");
  });

  it("a ticked task appears under Done (N) and unticking returns it to To-dos", async () => {
    await createItem({ kind: "task", title: "Oops", areaId: "art", priority: 3 }, TODAY);
    renderArea("art");
    await userEvent.click(await screen.findByRole("checkbox", { name: "Mark done: Oops" }));
    const summary = await screen.findByText("Done (1)", { selector: "summary" });
    const done = summary.closest("details")!;
    expect(done).not.toHaveAttribute("open");
    await userEvent.click(summary);
    const doneList = await within(done).findByRole("list", { name: "Done" });
    expect(within(doneList).getByText("Oops")).toBeInTheDocument();
    expect(within(doneList).getByText("27 Oct")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "To-dos" })).toBeNull();

    const box = within(doneList).getByRole("checkbox", { name: "Mark done: Oops" });
    expect(box).toBeChecked();
    await userEvent.click(box);
    const todos = await screen.findByRole("list", { name: "To-dos" });
    expect(within(todos).getByText("Oops")).toBeInTheDocument();
    expect(within(done).getByText("Nothing done yet.")).toBeInTheDocument();
    expect(within(done).getByText("Done (0)", { selector: "summary" })).toBeInTheDocument();
    const stored = (await db.items.toArray())[0];
    expect(stored.status).toBe("open");
    expect(stored.completedAt).toBeUndefined();
  });

  it("Done lists the most recently completed first, and says so calmly when empty", async () => {
    const a = await createItem({ kind: "task", title: "Earlier", areaId: "mind", priority: 3 }, TODAY);
    const b = await createItem({ kind: "task", title: "Later", areaId: "mind", priority: 3 }, TODAY);
    await tickItem(a.id, "2026-10-20");
    await tickItem(b.id, "2026-10-25");
    const first = renderArea("mind");
    const list = await screen.findByRole("list", { name: "Done", hidden: true });
    expect(within(list).getAllByRole("listitem", { hidden: true }).map((li) => li.textContent)).toEqual([
      expect.stringContaining("Later"),
      expect.stringContaining("Earlier"),
    ]);
    first.unmount();
    renderArea("body");
    expect(await screen.findByText("Nothing done yet.")).toBeInTheDocument();
  });

  it("inbox is not an area page", async () => {
    renderArea("inbox");
    expect(await screen.findByText("That area does not exist.")).toBeInTheDocument();
  });

  it("unknown area id shows a calm message", async () => {
    renderArea("nowhere");
    expect(await screen.findByText("That area does not exist.")).toBeInTheDocument();
  });

  it.each([
    ["tech", "Tech projects"],
    ["production", "Production"],
    ["admin", "Admin"],
  ])("the %s area page shows its heading and an empty state", async (id, label) => {
    renderArea(id);
    expect(await screen.findByRole("heading", { level: 1, name: label })).toBeInTheDocument();
    expect(await screen.findByText("Nothing here yet.")).toBeInTheDocument();
  });

  it("the inbox is still not an area page", () => {
    renderArea("inbox");
    expect(screen.getByText("That area does not exist.")).toBeInTheDocument();
  });

  describe("All view sections", () => {
    const headings = () => screen.queryAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    const SECTIONS = ["To-dos", "Ideas", "Goals"];

    it("groups a to-do, an idea and a goal under three headings in order", async () => {
      await createItem({ kind: "task", title: "A task", areaId: "art", priority: 3 }, TODAY);
      await createItem({ kind: "idea", title: "An idea", areaId: "art", priority: 3 }, TODAY);
      await createGoal({ title: "A goal", areaId: "art", kind: "practice" }, TODAY);
      renderArea("art");
      await screen.findByText("A task");
      expect(headings().filter((h) => SECTIONS.includes(h ?? ""))).toEqual(SECTIONS);
      const sec = (name: string) => screen.getByRole("heading", { level: 2, name }).closest("section") as HTMLElement;
      expect(within(sec("To-dos")).getByText("A task")).toBeInTheDocument();
      expect(within(sec("To-dos")).queryByText("An idea")).toBeNull();
      expect(within(sec("To-dos")).queryByText("A goal")).toBeNull();
      expect(within(sec("Ideas")).getByText("An idea")).toBeInTheDocument();
      expect(within(sec("Ideas")).queryByText("A task")).toBeNull();
      expect(within(sec("Goals")).getByText("A goal")).toBeInTheDocument();
      expect(within(sec("Goals")).queryByText("An idea")).toBeNull();
    });

    it("shows only the Ideas heading when only an idea exists", async () => {
      await createItem({ kind: "idea", title: "An idea", areaId: "art", priority: 3 }, TODAY);
      renderArea("art");
      await screen.findByText("An idea");
      expect(headings().filter((h) => SECTIONS.includes(h ?? ""))).toEqual(["Ideas"]);
    });

    it("shows only Nothing here yet when empty", async () => {
      renderArea("art");
      expect(await screen.findByText("Nothing here yet.")).toBeInTheDocument();
      expect(headings().filter((h) => SECTIONS.includes(h ?? ""))).toEqual([]);
    });

    it("a single filter shows just that group with no subheading", async () => {
      await createItem({ kind: "task", title: "A task", areaId: "art", priority: 3 }, TODAY);
      await createItem({ kind: "idea", title: "An idea", areaId: "art", priority: 3 }, TODAY);
      renderArea("art");
      await screen.findByText("A task");
      await userEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "To-dos" }));
      expect(screen.getByText("A task")).toBeInTheDocument();
      expect(screen.queryByText("An idea")).toBeNull();
      expect(headings().filter((h) => SECTIONS.includes(h ?? ""))).toEqual([]);
    });
  });

  describe("Month count (4A)", () => {
    async function doneOn(title: string, day: string, areaId: "art" | "body" = "art") {
      const it = await createItem({ kind: "task", title, areaId, priority: 3 }, day);
      await tickItem(it.id, day);
    }

    it("says how many were ticked off this month and last month, under the heading", async () => {
      for (const d of ["2026-10-01", "2026-10-15", "2026-10-26"]) await doneOn(`Oct ${d}`, d);
      for (const d of ["2026-09-03", "2026-09-30"]) await doneOn(`Sep ${d}`, d);
      await doneOn("Other area", "2026-10-02", "body");
      await doneOn("Too old", "2026-08-31");
      renderArea("art");
      const box = await screen.findByRole("region", { name: "Ticked off this month" });
      expect(within(box).getByText("3 ticked off in October")).toBeInTheDocument();
      expect(within(box).getByText("last month 2")).toBeInTheDocument();
      expect(within(box).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
      // Directly under the h1, above the filter pills.
      const h1 = screen.getByRole("heading", { level: 1, name: "Art" });
      expect(h1.nextElementSibling).toBe(box);
    });

    it("compares with last month's total", async () => {
      await doneOn("One", "2026-10-03");
      for (const d of ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]) await doneOn(`Sep ${d}`, d);
      renderArea("art");
      const box = await screen.findByRole("region", { name: "Ticked off this month" });
      expect(within(box).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    });

    it("has a calm zero state with an empty bar", async () => {
      renderArea("art");
      const box = await screen.findByRole("region", { name: "Ticked off this month" });
      expect(within(box).getByText("Nothing ticked off yet in October")).toBeInTheDocument();
      expect(within(box).getByText("last month 0")).toBeInTheDocument();
      expect(within(box).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
    });
  });

  describe("Done fold-out (4A)", () => {
    it("sits right after the to-dos and lists at most 50, with Show all for the rest", async () => {
      for (let i = 1; i <= 52; i++) {
        const it = await createItem({ kind: "task", title: `Did ${i}`, areaId: "mind", priority: 3 }, TODAY);
        await tickItem(it.id, `2026-${i > 26 ? "10" : "09"}-${String(((i - 1) % 26) + 1).padStart(2, "0")}`);
      }
      await createItem({ kind: "task", title: "Still open", areaId: "mind", priority: 3 }, TODAY);
      renderArea("mind");
      const todos = await screen.findByRole("list", { name: "To-dos" });
      const details = screen.getByText("Done (52)", { selector: "summary" }).closest("details")!;
      expect(todos.closest("section")!.nextElementSibling).toBe(details);
      const list = within(details).getByRole("list", { name: "Done", hidden: true });
      const rows = within(list).getAllByRole("listitem", { hidden: true });
      expect(rows).toHaveLength(50);
      expect(rows[0]).toHaveTextContent("Did 52");
      expect(rows[0]).toHaveTextContent("26 Oct");
      await userEvent.click(within(details).getByText("Done (52)", { selector: "summary" }));
      await userEvent.click(within(details).getByRole("button", { name: "Show all" }));
      expect(within(list).getAllByRole("listitem")).toHaveLength(52);
      expect(within(details).queryByRole("button", { name: "Show all" })).toBeNull();
      expect(within(details).getByText("Untick to bring one back.")).toBeInTheDocument();
    });
  });

  it("area goals are cards that link to the goal", async () => {
    const g = await createGoal({ title: "Paint daily", areaId: "art", kind: "practice", monthlyTarget: 4 }, TODAY);
    renderArea("art");
    const list = await screen.findByRole("list", { name: "Goals" });
    const card = within(list).getByRole("listitem");
    expect(card).toHaveClass("goal-card");
    expect(within(card).getByRole("link", { name: "Paint daily" })).toHaveAttribute("href", `/goals/${g.id}`);
    expect(within(card).getByText("October: 0 of 4")).toBeInTheDocument();
  });
});
