import { render as rtlRender, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db } from "../data/db";
import { createItem, listBin } from "../data/repo";
import { importBacklog } from "../import/backlog";
import { AppShell } from "./AppShell";
import { InboxPage } from "./InboxPage";

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
    expect(row.querySelector(".strip-tray")).toBeNull();
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

  it("no multi-select and no bulk tools, and no per-row filing controls", async () => {
    await createItem({ kind: "task", title: "One", areaId: "inbox", priority: 2 }, TODAY);
    render(<InboxPage today={TODAY} />);
    await screen.findByText("One");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    for (const gone of ["Select all shown", "Move selected to", "Move selected", "Archive selected", "More options"]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
    expect(screen.queryByRole("group", { name: "File One in" })).toBeNull();
  });

  it("Move to an area from the inbox files it", async () => {
    const it = await createItem({ kind: "task", title: "Stray", areaId: "inbox", priority: 2 }, TODAY);
    render(<InboxPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Move to: Stray" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Move Stray to" })).getByRole("button", { name: "Mind" }));
    await vi.waitFor(() => expect(screen.queryByText("Stray")).toBeNull());
    expect((await db.items.get(it.id))!.areaId).toBe("mind");
  });

  it("Delete moves it to the Bin with an Undo line; Undo brings it back", async () => {
    const it = await createItem({ kind: "task", title: "Not needed", areaId: "inbox", priority: 2 }, TODAY);
    render(<InboxPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete: Not needed" }));
    await vi.waitFor(() => expect(screen.queryByText("Not needed")).toBeNull());
    expect((await listBin()).map((i) => i.id)).toEqual([it.id]);
    const line = screen.getByRole("status");
    expect(line).toHaveTextContent("Moved to the Bin · Undo");
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
