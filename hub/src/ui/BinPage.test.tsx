import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { db } from "../data/db";
import * as repo from "../data/repo";
import { createGoal, createItem, deleteGoal, deleteItem } from "../data/repo";
import { BinPage } from "./BinPage";
import { ShellContext } from "./shellContext";
import { Sidebar } from "./Sidebar";

const TODAY = "2026-10-28";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
  vi.restoreAllMocks();
});

async function binned(title: string, on: string, areaId: "inbox" | "art" = "inbox") {
  const it = await createItem({ kind: "task", title, areaId, priority: 2 }, "2026-10-01");
  await deleteItem(it.id, on);
  return it;
}

const list = () => screen.getByRole("list", { name: "In the bin" });

describe("Bin page", () => {
  it("lists deleted items as strips, newest first, each with Restore; nothing else", async () => {
    await binned("Older", "2026-10-20");
    await binned("Newer", "2026-10-27");
    await createItem({ kind: "task", title: "Still open", areaId: "inbox", priority: 2 }, TODAY);
    render(<BinPage today={TODAY} />);
    expect(await screen.findByRole("heading", { name: "Bin" })).toBeInTheDocument();
    await screen.findByText("Newer");
    const rows = within(list()).getAllByRole("listitem");
    expect(list()).toHaveClass("strip-list");
    expect(rows.map((r) => r.querySelector(".strip-title")!.textContent)).toEqual(["Newer", "Older"]);
    for (const r of rows) expect(r).toHaveClass("strip");
    expect(within(rows[0]).getByRole("button", { name: "Restore: Newer" })).toBeInTheDocument();
    expect(screen.queryByText("Still open")).toBeNull();
  });

  it("Restore puts it back as open in its own area and tells the shell", async () => {
    const it = await binned("Bring back", "2026-10-27", "art");
    const refresh = vi.fn(async () => {});
    render(
      <ShellContext.Provider value={{ refresh, version: 0, today: TODAY, persistence: null }}>
        <BinPage today={TODAY} />
      </ShellContext.Provider>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Restore: Bring back" }));
    await vi.waitFor(() => expect(screen.queryByText("Bring back")).toBeNull());
    expect(await db.items.get(it.id)).toMatchObject({ status: "open", areaId: "art" });
    expect(refresh).toHaveBeenCalled();
  });

  it("Empty bin asks first; Cancel changes nothing", async () => {
    const it = await binned("Keep for now", "2026-10-27");
    render(<BinPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Empty bin" }));
    expect(screen.getByText("Delete 1 item for good? This can't be undone.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/for good\?/)).toBeNull();
    expect((await db.items.get(it.id))!.status).toBe("deleted");
  });

  it("Confirm empties it: the rows become purged tombstones and the Bin is empty", async () => {
    const a = await binned("Gone one", "2026-10-26");
    const b = await binned("Gone two", "2026-10-27");
    render(<BinPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Empty bin" }));
    expect(screen.getByText("Delete 2 items for good? This can't be undone.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("The bin is empty.")).toBeInTheDocument();
    for (const id of [a.id, b.id]) expect(await db.items.get(id)).toMatchObject({ status: "purged", title: "" });
    expect(screen.queryByRole("button", { name: "Empty bin" })).toBeNull();
  });

  it("a failed empty shows the calm message and keeps the items", async () => {
    await binned("Stays", "2026-10-27");
    vi.spyOn(repo, "emptyBin").mockRejectedValueOnce(new Error("boom"));
    render(<BinPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Empty bin" }));
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("That did not save. Try again.")).toBeInTheDocument();
    expect(screen.getByText("Stays")).toBeInTheDocument();
  });

  it("lists deleted goals too, with a Goal chip, newest first among the items, and restores them", async () => {
    await binned("Older task", "2026-10-20");
    const g = await createGoal({ title: "Pretend goal", areaId: "art", kind: "practice" }, "2026-10-01");
    await deleteGoal(g.id, "2026-10-25");
    render(<BinPage today={TODAY} />);
    await screen.findByText("Pretend goal");
    const rows = within(list()).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".strip-title")!.textContent)).toEqual(["Pretend goal", "Older task"]);
    expect(within(rows[0]).getByText("Goal")).toHaveClass("chip");
    expect(within(rows[1]).queryByText("Goal")).toBeNull();
    await userEvent.click(within(rows[0]).getByRole("button", { name: "Restore: Pretend goal" }));
    await vi.waitFor(() => expect(screen.queryByText("Pretend goal")).toBeNull());
    expect((await repo.listGoals()).map((x) => x.id)).toEqual([g.id]);
  });

  it("Empty bin counts and purges goals with the items", async () => {
    await binned("A task", "2026-10-20");
    const g = await createGoal({ title: "A goal", areaId: "art", kind: "practice" }, "2026-10-01");
    await deleteGoal(g.id, "2026-10-25");
    render(<BinPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Empty bin" }));
    expect(screen.getByText("Delete 2 items for good? This can't be undone.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("The bin is empty.")).toBeInTheDocument();
    expect(await db.goals.get(g.id)).toMatchObject({ status: "purged", title: "" });
  });

  it("the question takes focus (on Cancel), and Confirm empties only what it named (review M-2, M-5)", async () => {
    const shown = await binned("Shown one", "2026-10-26");
    render(<BinPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Empty bin" }));
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAccessibleDescription("Delete 1 item for good? This can't be undone.");
    // Something is binned elsewhere while the question shows.
    const late = await binned("Arrived later", "2026-10-27");
    await screen.findByText("Arrived later");
    expect(screen.getByText("Delete 1 item for good? This can't be undone.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await vi.waitFor(async () => expect((await db.items.get(shown.id))!.status).toBe("purged"));
    expect((await db.items.get(late.id))!.status).toBe("deleted");
    expect(await screen.findByRole("button", { name: "Restore: Arrived later" })).toBeInTheDocument();
  });

  it("an empty Bin says so and offers no Empty bin", async () => {
    render(<BinPage today={TODAY} />);
    expect(await screen.findByText("The bin is empty.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Empty bin" })).toBeNull();
  });
});

describe("Sidebar footer", () => {
  it("links to the Bin after Backup and Sync", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    );
    const footer = document.querySelector(".sidebar-footer") as HTMLElement;
    expect(within(footer).getAllByRole("link").map((l) => l.textContent)).toEqual(["Backup", "Sync", "Bin"]);
    expect(within(footer).getByRole("link", { name: "Bin" })).toHaveAttribute("href", "/bin");
  });
});
