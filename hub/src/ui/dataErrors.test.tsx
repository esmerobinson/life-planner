import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import * as repo from "../data/repo";
import { db } from "../data/db";
import { AreaPage } from "./AreaPage";
import { GoalDetail } from "./GoalDetail";
import { GoalsPage } from "./GoalsPage";
import { HomePage } from "./HomePage";
import { InboxPage } from "./InboxPage";

const TODAY = "2026-10-27";
const DATA_LINE = "Your data could not be read. Reload to try again.";
const SAVE_LINE = "That did not save. Try again.";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function at(path: string, pattern: string, el: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={pattern} element={el} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("a failing read shows one calm line and no empty state", () => {
  it.each([
    ["Home", () => at("/", "/", <HomePage today={TODAY} />), ["Nothing planned for today.", "No monthly targets yet."]],
    ["Inbox", () => at("/inbox", "/inbox", <InboxPage today={TODAY} />), ["Nothing waiting in the inbox."]],
    ["Area", () => at("/area/art", "/area/:areaId", <AreaPage today={TODAY} />), ["Nothing here yet.", "Nothing archived."]],
    ["Goals", () => at("/goals", "/goals", <GoalsPage today={TODAY} />), ["No goals yet."]],
    ["Goal detail", () => at("/goals/x", "/goals/:id", <GoalDetail today={TODAY} />), ["That goal does not exist."]],
  ])("%s", async (_name, renderPage, emptyLines) => {
    vi.spyOn(repo, "listItems").mockRejectedValue(new Error("disk gone"));
    renderPage();
    expect(await screen.findByText(DATA_LINE)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getAllByText(DATA_LINE)).toHaveLength(1);
    for (const line of emptyLines) expect(screen.queryByText(line)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("failing writes show the save line", () => {
  it("filing an inbox item that does not save", async () => {
    await repo.createItem({ kind: "task", title: "Loose", areaId: "inbox", priority: 2 }, TODAY);
    vi.spyOn(repo, "updateItem").mockRejectedValueOnce(new Error("write failed"));
    at("/inbox", "/inbox", <InboxPage today={TODAY} />);
    await userEvent.selectOptions(await screen.findByLabelText("Area for Loose"), "art");
    await userEvent.click(screen.getByRole("button", { name: "File Loose" }));
    expect(await screen.findByText(SAVE_LINE)).toBeInTheDocument();
    expect(screen.getByText("Loose")).toBeInTheDocument();
  });

  it("ticking on an area page that does not save", async () => {
    await repo.createItem({ kind: "task", title: "Stretch", areaId: "body", priority: 3 }, TODAY);
    vi.spyOn(repo, "tickItem").mockRejectedValueOnce(new Error("write failed"));
    at("/area/body", "/area/:areaId", <AreaPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Mark done: Stretch" }));
    expect(await screen.findByText(SAVE_LINE)).toBeInTheDocument();
    expect(screen.queryByTestId("celebration-placeholder")).toBeNull();
  });
});
