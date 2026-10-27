import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db } from "../data/db";
import { archiveItem, createGoal, createItem } from "../data/repo";
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
    expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute("aria-selected", "true");

    await userEvent.click(screen.getByRole("tab", { name: "To-dos" }));
    expect(screen.getByText("A task")).toBeInTheDocument();
    expect(screen.queryByText("An idea")).not.toBeInTheDocument();
    expect(screen.queryByText("A goal")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Ideas" }));
    expect(screen.getByText("An idea")).toBeInTheDocument();
    expect(screen.queryByText("A task")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Done:/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Goals" }));
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
    await userEvent.click(screen.getByRole("tab", { name: "To-dos" }));
    expect(screen.getByRole("button", { name: "Done: Old plan" })).toBeInTheDocument();
  });

  it("ticking a task marks it done", async () => {
    await createItem({ kind: "task", title: "Tick me", areaId: "body", priority: 3 }, TODAY);
    renderArea("body");
    await userEvent.click(await screen.findByRole("button", { name: "Done: Tick me" }));
    await screen.findByText("Nothing here yet.");
    expect((await db.items.toArray())[0].status).toBe("done");
  });

  it("inbox is not an area page", async () => {
    renderArea("inbox");
    expect(await screen.findByText("That area does not exist.")).toBeInTheDocument();
  });

  it("unknown area id shows a calm message", async () => {
    renderArea("nowhere");
    expect(await screen.findByText("That area does not exist.")).toBeInTheDocument();
  });
});
