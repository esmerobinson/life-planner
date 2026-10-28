import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db } from "../data/db";
import * as repo from "../data/repo";
import { GoalDetail } from "./GoalDetail";

const TODAY = "2026-10-28";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

function renderDetail(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/goals/${id}`]}>
      <Routes>
        <Route path="/goals/:id" element={<GoalDetail today={TODAY} />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("goal detail: Edit section", () => {
  const finite = {
    id: "ef", title: "Edit me", areaId: "art" as const, kind: "finite" as const, deadline: "2026-12-31",
    monthlyTarget: 2, milestones: [{ id: "m", title: "keep", done: false }], createdAt: TODAY,
    why: "kept", source: { kind: "obsidian" as const, key: "obsidian:goal:edit me" },
  };

  it("has title, area, deadline and monthly target fields filled from the goal", async () => {
    await db.goals.add(finite);
    renderDetail("ef");
    expect(await screen.findByRole("heading", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("Edit me");
    expect(screen.getByLabelText("Area")).toHaveValue("art");
    expect(screen.getByLabelText("Deadline")).toHaveValue("2026-12-31");
    expect(screen.getByLabelText("Monthly target")).toHaveValue(2);
    const opts = within(screen.getByLabelText("Area")).getAllByRole("option").map((o) => o.textContent);
    expect(opts).not.toContain("Inbox");
    expect(opts).toContain("Admin");
  });

  it("saves changes, keeps milestones and source, and shows the new title", async () => {
    await db.goals.add(finite);
    renderDetail("ef");
    await screen.findByRole("heading", { name: "Edit" });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Renamed" } });
    await userEvent.selectOptions(screen.getByLabelText("Area"), "admin");
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "2027-03-01" } });
    fireEvent.change(screen.getByLabelText("Monthly target"), { target: { value: "" } });
    await userEvent.click(screen.getByRole("button", { name: "Save goal" }));
    expect(await screen.findByRole("heading", { name: "Renamed", level: 1 })).toBeInTheDocument();
    const got = (await db.goals.get("ef"))!;
    expect(got).toMatchObject({ title: "Renamed", areaId: "admin", deadline: "2027-03-01", why: "kept", milestones: finite.milestones, source: finite.source });
    expect(got.monthlyTarget).toBeUndefined();
  });

  it("asks for a deadline on a finite goal and writes nothing", async () => {
    await db.goals.add(finite);
    renderDetail("ef");
    await screen.findByRole("heading", { name: "Edit" });
    fireEvent.change(screen.getByLabelText("Deadline"), { target: { value: "" } });
    await userEvent.click(screen.getByRole("button", { name: "Save goal" }));
    expect(await screen.findByText("A finite goal needs a deadline.")).toBeInTheDocument();
    expect((await db.goals.get("ef"))!.deadline).toBe("2026-12-31");
  });

  it("asks for a title and a sensible monthly target", async () => {
    await db.goals.add(finite);
    renderDetail("ef");
    await screen.findByRole("heading", { name: "Edit" });
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "  " } });
    await userEvent.click(screen.getByRole("button", { name: "Save goal" }));
    expect(await screen.findByText("Give the goal a title.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "ok" } });
    fireEvent.change(screen.getByLabelText("Monthly target"), { target: { value: "0" } });
    await userEvent.click(screen.getByRole("button", { name: "Save goal" }));
    expect(await screen.findByText("A monthly target is a whole number, 1 or more.")).toBeInTheDocument();
    expect((await db.goals.get("ef"))!.title).toBe("Edit me");
  });

  it("a practice goal may have no deadline", async () => {
    await db.goals.add({ id: "ep", title: "Practice", areaId: "body", kind: "practice", milestones: [], createdAt: TODAY });
    renderDetail("ep");
    await screen.findByRole("heading", { name: "Edit" });
    await userEvent.click(screen.getByRole("button", { name: "Save goal" }));
    await vi.waitFor(async () => expect((await db.goals.get("ep"))!.title).toBe("Practice"));
    expect(screen.queryByText("A finite goal needs a deadline.")).toBeNull();
  });

  it("shows the calm save message when the write fails", async () => {
    await db.goals.add(finite);
    renderDetail("ef");
    await screen.findByRole("heading", { name: "Edit" });
    const spy = vi.spyOn(repo, "updateGoal").mockRejectedValue(new Error("boom"));
    await userEvent.click(screen.getByRole("button", { name: "Save goal" }));
    expect(await screen.findByText("That did not save. Try again.")).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("goal detail: why and cadence", () => {
  it("shows why and cadence as plain paragraphs when present", async () => {
    await db.goals.add({
      id: "g", title: "Pretend goal", areaId: "writing", kind: "practice", milestones: [], createdAt: TODAY,
      why: "First reason <b>x</b>\n\nSecond reason", cadence: "Weekly: 3 sessions\nDaily: 10 minutes",
    });
    renderDetail("g");
    expect(await screen.findByText("First reason <b>x</b>")).toBeInTheDocument();
    expect(screen.getByText("Second reason")).toBeInTheDocument();
    expect(screen.getByText("Weekly: 3 sessions")).toBeInTheDocument();
    expect(screen.getByText("Daily: 10 minutes")).toBeInTheDocument();
    expect(document.querySelector("b")).toBeNull();
  });

  it("shows no extra paragraphs without why or cadence", async () => {
    await db.goals.add({ id: "g2", title: "Plain goal", areaId: "writing", kind: "practice", milestones: [], createdAt: TODAY });
    renderDetail("g2");
    await screen.findByRole("heading", { name: "Plain goal" });
    expect(document.querySelectorAll(".goal-why, .goal-cadence").length).toBe(0);
  });
});
