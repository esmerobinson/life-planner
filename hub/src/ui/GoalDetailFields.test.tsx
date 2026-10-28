import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db } from "../data/db";
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
