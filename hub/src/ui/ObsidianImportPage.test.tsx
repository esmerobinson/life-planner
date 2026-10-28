import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../data/db";
import * as importer from "../import/obsidianGoals";
import { GoalDetail } from "./GoalDetail";
import { GoalsPage } from "./GoalsPage";
import { ObsidianImportPage } from "./ObsidianImportPage";
import goalsMd from "../import/__fixtures__/ObsidianGoals.md?raw";
import monthMd from "../import/__fixtures__/ObsidianMonth.md?raw";
import habitsMd from "../import/__fixtures__/ObsidianHabits.md?raw";

const TODAY = "2026-10-28";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/goals/import"]}>
      <Routes>
        <Route path="/goals/import" element={<ObsidianImportPage today={TODAY} />} />
        <Route path="/goals" element={<h1>Goals page</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

function fill(label: string, text: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: text } });
}

async function preview(all = true) {
  if (all) {
    fill("Goals note text", goalsMd);
    fill("Monthly note text", monthMd);
    fill("Habits note text", habitsMd);
  }
  await userEvent.click(screen.getByRole("button", { name: "Preview" }));
  await screen.findByRole("heading", { name: "Preview" });
}

describe("ObsidianImportPage", () => {
  it("has three optional file inputs and text boxes and a Preview button", () => {
    renderPage();
    for (const n of ["Goals note", "Monthly note", "Habits note"]) {
      expect(screen.getByLabelText(`${n} file`)).toHaveAttribute("type", "file");
      expect(screen.getByLabelText(`${n} text`).tagName).toBe("TEXTAREA");
    }
    expect(screen.getByRole("button", { name: "Preview" })).toBeInTheDocument();
  });

  it("asks for something when everything is empty", async () => {
    renderPage();
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByText("Paste a note or choose a file first.")).toBeInTheDocument();
  });

  it("previews goals, tasks and information lines, and writes nothing", async () => {
    renderPage();
    await preview();
    expect(await db.goals.count()).toBe(0);
    expect(await db.items.count()).toBe(0);

    const goals = screen.getByRole("list", { name: "Proposed goals" });
    expect(within(goals).getAllByRole("checkbox").length).toBe(10);
    expect(screen.getByLabelText("Area for Creative technologist")).toHaveValue("tech");
    expect(screen.getByLabelText("Area for Gardening corner")).toHaveValue("admin");
    expect(screen.getByLabelText("Deadline for Writing")).toHaveValue("2027-12-31");
    expect(screen.queryByLabelText("Deadline for Art")).toBeNull();
    expect(screen.getByText("Publish 2 zines by 30 Jun 2027")).toBeInTheDocument();
    expect(within(goals).getByText(/finishes small pretend zines/)).toBeInTheDocument();

    const tasks = screen.getByRole("list", { name: "Proposed tasks" });
    expect(within(tasks).getAllByRole("checkbox").length).toBe(7);
    expect(screen.getByLabelText("Area for task Write the ending scene")).toHaveValue("admin");

    expect(screen.getByText("Not imported yet")).toBeInTheDocument();
    expect(screen.getByText("Pretend followers: 1200 of 5000")).toBeInTheDocument();
    expect(screen.getByText("3 sessions")).toBeInTheDocument();
    // area options are limited to goal areas (no inbox)
    const opts = within(screen.getByLabelText("Area for Writing")).getAllByRole("option").map((o) => o.textContent);
    expect(opts).not.toContain("Inbox");
  });

  it("shows parse notes", async () => {
    renderPage();
    fill("Habits note text", habitsMd);
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await userEvent.click(await screen.findByText("Notes (1)"));
    expect(screen.getByRole("list", { name: "Obsidian import notes" })).toHaveTextContent("Not a metric line");
  });

  it("adds only the selected rows, with edited area and deadline, then shows the result", async () => {
    renderPage();
    await preview();
    await userEvent.click(screen.getByLabelText("Select Art"));
    await userEvent.click(screen.getByLabelText("Select task Drink water"));
    await userEvent.selectOptions(screen.getByLabelText("Area for Gardening corner"), "body");
    fireEvent.change(screen.getByLabelText("Deadline for Writing"), { target: { value: "2027-09-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Add selected" }));
    expect(await screen.findByText("Added 9 goals and 6 tasks, already had 0.")).toBeInTheDocument();
    expect(await db.goals.count()).toBe(9);
    expect(await db.goals.filter((g) => g.title === "Art").count()).toBe(0);
    expect((await db.goals.filter((g) => g.title === "Gardening corner").first())!.areaId).toBe("body");
    expect((await db.goals.filter((g) => g.title === "Writing").first())!.deadline).toBe("2027-09-01");
    expect(await db.items.filter((i) => i.title === "Drink water").count()).toBe(0);
    expect(screen.getByRole("link", { name: "Back to Goals" })).toHaveAttribute("href", "/goals");
  });

  it("marks rows that already exist and disables them; second add changes nothing", async () => {
    renderPage();
    await preview();
    await userEvent.click(screen.getByRole("button", { name: "Add selected" }));
    await screen.findByText("Added 10 goals and 7 tasks, already had 0.");
    const goalsBefore = await db.goals.orderBy("id").toArray();
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByRole("heading", { name: "Preview" });
    expect(screen.getByLabelText("Select Writing")).toBeDisabled();
    expect(screen.getByLabelText("Select Writing")).not.toBeChecked();
    expect(screen.getByLabelText("Select task Drink water")).toBeDisabled();
    expect(screen.getAllByText("Already added").length).toBe(17);
    await userEvent.click(screen.getByRole("button", { name: "Add selected" }));
    expect(await screen.findByText("Added 0 goals and 0 tasks, already had 0.")).toBeInTheDocument();
    expect(await db.goals.orderBy("id").toArray()).toEqual(goalsBefore);
  });

  it("asks for a deadline when a selected finite goal has none, writing nothing", async () => {
    renderPage();
    await preview();
    fireEvent.change(screen.getByLabelText("Deadline for Writing"), { target: { value: "" } });
    await userEvent.click(screen.getByRole("button", { name: "Add selected" }));
    expect(await screen.findByText("Give each selected goal with a deadline a date first.")).toBeInTheDocument();
    expect(await db.goals.count()).toBe(0);
  });

  it("shows text from the notes as text, never HTML", async () => {
    renderPage();
    fill("Goals note text", "## Writing\n- Identity: <b>bold</b> <img src=x onerror=alert(1)>\n- Marker: <i>m</i>");
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));
    await screen.findByRole("heading", { name: "Preview" });
    expect(document.querySelector("b, i, img")).toBeNull();
    expect(within(screen.getByRole("list", { name: "Proposed goals" })).getByText(/<b>bold<\/b>/)).toBeInTheDocument();
  });

  it("double-clicking Add selected writes once", async () => {
    renderPage();
    await preview();
    const spy = vi.spyOn(importer, "importObsidianGoals");
    const btn = screen.getByRole("button", { name: "Add selected" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(await screen.findByText(/^Added 10 goals/)).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect(await db.goals.count()).toBe(10);
  });

  it("shows a calm message when the write fails", async () => {
    renderPage();
    await preview();
    const spy = vi.spyOn(importer, "importObsidianGoals").mockRejectedValue(new Error("boom"));
    await userEvent.click(screen.getByRole("button", { name: "Add selected" }));
    expect(await screen.findByText("That did not save. Try again.")).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("Goals page link and goal detail fields", () => {
  it("Goals page links to the importer", () => {
    render(
      <MemoryRouter initialEntries={["/goals"]}>
        <GoalsPage today={TODAY} />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "Import from Obsidian" })).toHaveAttribute("href", "/goals/import");
  });

  it("goal detail shows why and cadence as plain paragraphs when present", async () => {
    await db.goals.add({
      id: "g", title: "Pretend goal", areaId: "writing", kind: "practice", milestones: [], createdAt: TODAY,
      why: "First reason <b>x</b>\n\nSecond reason", cadence: "Weekly: 3 sessions\nDaily: 10 minutes",
    });
    render(
      <MemoryRouter initialEntries={["/goals/g"]}>
        <Routes>
          <Route path="/goals/:id" element={<GoalDetail today={TODAY} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("First reason <b>x</b>")).toBeInTheDocument();
    expect(screen.getByText("Second reason")).toBeInTheDocument();
    expect(screen.getByText("Weekly: 3 sessions")).toBeInTheDocument();
    expect(screen.getByText("Daily: 10 minutes")).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it("goal detail without why or cadence shows no extra paragraphs", async () => {
    await db.goals.add({ id: "g2", title: "Plain goal", areaId: "writing", kind: "practice", milestones: [], createdAt: TODAY });
    render(
      <MemoryRouter initialEntries={["/goals/g2"]}>
        <Routes>
          <Route path="/goals/:id" element={<GoalDetail today={TODAY} />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Plain goal" });
    expect(document.querySelectorAll(".goal-why, .goal-cadence").length).toBe(0);
  });
});
