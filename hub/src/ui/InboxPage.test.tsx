import { render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db } from "../data/db";
import { createGoal, createItem, listBin } from "../data/repo";
import { importBacklog } from "../import/backlog";
import { AppShell } from "./AppShell";
import { InboxPage } from "./InboxPage";
import { SortPage } from "./SortPage";

const TODAY = "2026-10-27";
const BACKLOG = "- [ ] Water the ferns #home\n- [ ] Email Sam !p1\n- [ ] Call mum [due 2026-11-01]\n";

/** The Inbox links to Sort one by one, so it renders inside a router. */
const render = (ui: ReactElement) => rtlRender(<MemoryRouter>{ui}</MemoryRouter>);
const rowOf = (title: string) => screen.getByText(title, { selector: ".strip-title" }).closest("li") as HTMLElement;

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

describe("Inbox strips (unsorted: no type yet)", () => {
  it("a strip has no tick box or select box, and Schedule for, Move to and Delete on the right", async () => {
    await createItem({ kind: "task", title: "Loose end", areaId: "inbox", priority: 2 }, TODAY);
    render(<InboxPage today={TODAY} />);
    await screen.findByText("Loose end");
    const row = rowOf("Loose end");
    expect(row).toHaveClass("strip", "no-tick");
    expect(screen.getByRole("list", { name: "Inbox items" })).toHaveClass("strip-list");
    expect(within(row).queryByRole("checkbox")).toBeNull();
    const actions = row.querySelector(".strip-actions") as HTMLElement;
    expect(within(actions).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Schedule for: Loose end", "Move to: Loose end", "Delete: Loose end",
    ]);
    const del = within(actions).getByRole("button", { name: "Delete: Loose end" });
    expect(del).toHaveClass("icon");
    expect(del).toHaveAttribute("title", "Delete");
    // The only tray is the temporary More options (goal, priority, due).
    expect(within(row.querySelector(".strip-tray") as HTMLElement).getByText("More options")).toBeInTheDocument();
  });

  it("a stored idea looks the same as a stored to-do: the stored kind is ignored until it is sorted", async () => {
    await createItem({ kind: "idea", title: "Musing", areaId: "inbox", priority: 2 }, TODAY);
    render(<InboxPage today={TODAY} />);
    await screen.findByText("Musing");
    const row = rowOf("Musing");
    expect(within(row).queryByRole("checkbox")).toBeNull();
    expect(within(row).getByRole("button", { name: "Schedule for: Musing" })).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Move to: Musing" }));
    // No "Change to": there is no type to change from.
    expect(within(screen.getByRole("group", { name: "Move Musing to" })).queryByRole("group", { name: "Change to" })).toBeNull();
  });

  it("no multi-select and no bulk tools, and no per-row area filing", async () => {
    await createItem({ kind: "task", title: "One", areaId: "inbox", priority: 2 }, TODAY);
    render(<InboxPage today={TODAY} />);
    await screen.findByText("One");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    for (const gone of ["Select all shown", "Move selected to", "Move selected", "Archive selected", "File it", "Make it a goal"]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    expect(screen.queryByRole("group", { name: "File One in" })).toBeNull();
    expect(screen.queryByLabelText("Area for One")).toBeNull();
  });

  it("Move to on an Inbox strip: Sort this…, then Archive and Delete; no areas, no This week", async () => {
    await createItem({ kind: "task", title: "Stray", areaId: "inbox", priority: 2 }, TODAY);
    render(<InboxPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Move to: Stray" }));
    const menu = screen.getByRole("group", { name: "Move Stray to" });
    expect(within(menu).getAllByRole("button").map((b) => b.textContent)).toEqual(["Sort this…", "Archive", "Delete"]);
  });

  it("Sort this… opens Sort one by one on that item", async () => {
    await createItem({ kind: "task", title: "Older", areaId: "inbox", priority: 2 }, "2026-10-01");
    await createItem({ kind: "task", title: "Chosen", areaId: "inbox", priority: 2 }, TODAY);
    rtlRender(
      <MemoryRouter initialEntries={["/inbox"]}>
        <Routes>
          <Route path="/inbox" element={<InboxPage today={TODAY} />} />
          <Route path="/inbox/sort" element={<SortPage today={TODAY} />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Move to: Chosen" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Move Chosen to" })).getByRole("button", { name: "Sort this…" }));
    const card = await screen.findByRole("region", { name: "Item to sort" });
    await vi.waitFor(() => expect(within(card).getByText("Chosen")).toBeInTheDocument());
  });

  it("More options (temporary, until the side panel) sets goal, priority and due; the item stays in the Inbox", async () => {
    const goal = await createGoal({ title: "Pretend goal", areaId: "art", kind: "practice" }, TODAY);
    const it = await createItem({ kind: "idea", title: "Detailed", areaId: "inbox", priority: 2 }, TODAY);
    render(<InboxPage today={TODAY} />);
    await screen.findByText("Detailed");
    const row = rowOf("Detailed");
    expect(row.querySelector(".strip-tray details")).not.toHaveAttribute("open");
    await userEvent.click(within(row).getByText("More options"));
    await userEvent.selectOptions(within(row).getByLabelText("Goal for Detailed"), goal.id);
    await userEvent.selectOptions(within(row).getByLabelText("Priority for Detailed"), "1");
    // An Inbox item has no type yet, so the due date is always offered.
    await userEvent.type(within(row).getByLabelText("Due for Detailed"), "2026-11-05");
    await userEvent.click(within(row).getByRole("button", { name: "Save Detailed" }));
    await vi.waitFor(async () =>
      expect(await db.items.get(it.id)).toMatchObject({ goalId: goal.id, priority: 1, due: "2026-11-05", areaId: "inbox" }),
    );
    expect(screen.getByText("Detailed")).toBeInTheDocument();
  });

  it("More options can clear the goal and the due date again", async () => {
    const goal = await createGoal({ title: "Pretend goal", areaId: "art", kind: "practice" }, TODAY);
    const it = await createItem({ kind: "task", title: "Clear me", areaId: "inbox", priority: 3, goalId: goal.id, due: "2026-11-05" }, TODAY);
    render(<InboxPage today={TODAY} />);
    await screen.findByText("Clear me");
    const row = rowOf("Clear me");
    await userEvent.click(within(row).getByText("More options"));
    expect(within(row).getByLabelText("Goal for Clear me")).toHaveValue(goal.id);
    expect(within(row).getByLabelText("Priority for Clear me")).toHaveValue("3");
    await userEvent.selectOptions(within(row).getByLabelText("Goal for Clear me"), "");
    await userEvent.clear(within(row).getByLabelText("Due for Clear me"));
    await userEvent.click(within(row).getByRole("button", { name: "Save Clear me" }));
    await vi.waitFor(async () => {
      const got = (await db.items.get(it.id))!;
      expect(got.goalId).toBeUndefined();
      expect(got.due).toBeUndefined();
      expect(got.priority).toBe(3);
    });
  });

  it("Delete moves it to the Bin with an Undo line; Undo brings it back", async () => {
    const it = await createItem({ kind: "task", title: "Not needed", areaId: "inbox", priority: 2 }, TODAY);
    render(<InboxPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete: Not needed" }));
    await vi.waitFor(() => expect(screen.queryByText("Not needed")).toBeNull());
    expect((await listBin()).map((i) => i.id)).toEqual([it.id]);
    const line = screen.getByRole("status");
    expect(line).toHaveTextContent("Moved to the Bin · Undo");
    // The pressed icon is gone with its strip: focus moves to Undo.
    await vi.waitFor(() => expect(within(line).getByRole("button", { name: "Undo" })).toHaveFocus());
    await userEvent.click(within(line).getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Not needed")).toBeInTheDocument();
    expect((await db.items.get(it.id))!.status).toBe("open");
    expect(await listBin()).toEqual([]);
  });
});

describe("InboxPage", () => {
  it("shows a calm sentence when empty, and no Sort one by one", async () => {
    render(<InboxPage today={TODAY} />);
    expect(await screen.findByText("Nothing waiting in the inbox.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sort one by one" })).toBeNull();
  });

  it("shows how many are waiting and the Sort one by one pill at the top", async () => {
    await importBacklog(BACKLOG, TODAY);
    await createItem({ kind: "task", title: "Sorted already", areaId: "art", priority: 2 }, TODAY);
    render(<InboxPage today={TODAY} />);
    expect(await screen.findByText("3 to sort")).toBeInTheDocument();
    const sort = screen.getByRole("link", { name: "Sort one by one" });
    expect(sort).toHaveAttribute("href", "/inbox/sort");
    expect(sort).toHaveClass("btn-secondary");
    const h1 = screen.getByRole("heading", { level: 1, name: "Inbox" });
    expect(h1.compareDocumentPosition(sort) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sort.compareDocumentPosition(screen.getByRole("textbox", { name: "Add to inbox" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("lists imported items with their tags", async () => {
    await importBacklog(BACKLOG, TODAY);
    render(<InboxPage today={TODAY} />);
    expect(await screen.findByText("Water the ferns")).toBeInTheDocument();
    expect(screen.getByText("#home")).toBeInTheDocument();
    expect(screen.getByText("Email Sam")).toBeInTheDocument();
  });

  it("deleted items are not in the list or the count", async () => {
    await createItem({ kind: "task", title: "Here", areaId: "inbox", priority: 2 }, TODAY);
    const gone = await createItem({ kind: "task", title: "Gone", areaId: "inbox", priority: 2 }, TODAY);
    await db.items.update(gone.id, { status: "deleted", deletedAt: TODAY });
    render(<InboxPage today={TODAY} />);
    expect(await screen.findByText("1 to sort")).toBeInTheDocument();
    expect(screen.queryByText("Gone")).toBeNull();
  });
});

function renderShell() {
  return rtlRender(
    <MemoryRouter initialEntries={["/today"]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/today" element={<h1>Today page</h1>} />
          <Route path="/inbox" element={<InboxPage today={TODAY} />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("double actions and refresh", () => {
  it("quick-add on the inbox page makes the new task appear in the inbox list", async () => {
    await createItem({ kind: "task", title: "Seed", areaId: "inbox", priority: 2 }, TODAY);
    renderShell();
    await userEvent.click(await screen.findByRole("link", { name: "Inbox (1)" }));
    await screen.findByText("Seed", { selector: ".strip-title" });
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await userEvent.type(screen.getByLabelText("Title"), "Fresh arrival");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    const list = await screen.findByRole("list", { name: "Inbox items" });
    await vi.waitFor(() => expect(list).toHaveTextContent("Fresh arrival"));
  });
});

describe("AppShell additions", () => {
  it("Inbox link is always in the shell; the count shows only when inbox items exist", async () => {
    const first = renderShell();
    expect(await screen.findByText("Today page")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    const plain = screen.getByRole("link", { name: "Inbox" });
    expect(plain).toHaveAttribute("href", "/inbox");
    expect(plain).toHaveTextContent(/^Inbox$/);
    first.unmount();

    await createItem({ kind: "task", title: "Loose end", areaId: "inbox", priority: 2 }, TODAY);
    await createItem({ kind: "task", title: "Another", areaId: "inbox", priority: 2 }, TODAY);
    renderShell();
    const link = await screen.findByRole("link", { name: "Inbox (2)" });
    expect(link).toHaveAttribute("href", "/inbox");
  });

  it("Add button toggles the quick-add form and adding updates the inbox count", async () => {
    renderShell();
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(screen.getByRole("link", { name: "Inbox" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await userEvent.type(screen.getByLabelText("Title"), "Fresh");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(await screen.findByRole("link", { name: "Inbox (1)" })).toBeInTheDocument();
  });

  it("deleting the last inbox item from the inbox page drops the count from the shell link", async () => {
    await createItem({ kind: "task", title: "Only one", areaId: "inbox", priority: 2 }, TODAY);
    renderShell();
    await userEvent.click(await screen.findByRole("link", { name: "Inbox (1)" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete: Only one" }));
    await screen.findByText("Nothing waiting in the inbox.");
    await vi.waitFor(() => expect(screen.getByRole("link", { name: "Inbox" })).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /Inbox \(/ })).toBeNull();
  });

  it("Sidebar still shows exactly thirteen items (no Inbox) with the shell rendered", async () => {
    await createItem({ kind: "task", title: "Loose end", areaId: "inbox", priority: 2 }, TODAY);
    renderShell();
    await screen.findByRole("link", { name: "Inbox (1)" });
    const nav = within(document.querySelector(".sidebar") as HTMLElement).getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link")).toHaveLength(13);
    expect(within(nav).queryByText(/Inbox/)).toBeNull();
  });
});
