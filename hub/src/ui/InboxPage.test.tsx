import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db } from "../data/db";
import { HubDB } from "../data/db";
import * as repo from "../data/repo";
import { createItem } from "../data/repo";
import { importBacklog } from "../import/backlog";
import { AppShell } from "./AppShell";
import { InboxPage } from "./InboxPage";

const TODAY = "2026-10-27";
const BACKLOG = "- [ ] Water the ferns #home\n- [ ] Email Sam !p1\n- [ ] Call mum [due 2026-11-01]\n";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

describe("InboxPage", () => {
  it("shows a calm sentence when empty", async () => {
    render(<InboxPage today={TODAY} />);
    expect(await screen.findByText("Nothing waiting in the inbox.")).toBeInTheDocument();
  });

  it("inbox lists imported items and filing one removes it from inbox", async () => {
    await importBacklog(BACKLOG, TODAY);
    render(<InboxPage today={TODAY} />);
    expect(await screen.findByText("Water the ferns")).toBeInTheDocument();
    expect(screen.getByText("#home")).toBeInTheDocument();
    expect(screen.getByText("Email Sam")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Area for Email Sam"), "writing");
    await userEvent.selectOptions(screen.getByLabelText("Priority for Email Sam"), "3");
    await userEvent.type(screen.getByLabelText("Due for Email Sam"), "2026-11-05");
    await userEvent.click(screen.getByRole("button", { name: "File Email Sam" }));

    await vi.waitFor(() => expect(screen.queryByText("Email Sam")).toBeNull());
    expect(screen.getByText("Water the ferns")).toBeInTheDocument();
    const stored = (await db.items.toArray()).find((i) => i.title === "Email Sam")!;
    expect(stored).toMatchObject({ areaId: "writing", priority: 3, due: "2026-11-05" });
  });

  it("area choices exclude inbox", async () => {
    await createItem({ kind: "idea", title: "Zine", areaId: "inbox", priority: 2 }, TODAY);
    render(<InboxPage today={TODAY} />);
    const sel = await screen.findByLabelText("Area for Zine");
    expect(within(sel).queryByRole("option", { name: "Inbox" })).toBeNull();
  });

});

function renderShell() {
  return render(
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
    await screen.findByLabelText("Area for Seed");
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

  it("filing the last inbox item from the inbox page drops the count from the shell link", async () => {
    await createItem({ kind: "task", title: "Only one", areaId: "inbox", priority: 2 }, TODAY);
    renderShell();
    await userEvent.click(await screen.findByRole("link", { name: "Inbox (1)" }));
    await userEvent.selectOptions(await screen.findByLabelText("Area for Only one"), "art");
    await userEvent.click(screen.getByRole("button", { name: "File Only one" }));
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

describe("bulk filing", () => {
  async function seed(n: number) {
    for (let i = 1; i <= n; i++) {
      await createItem({ kind: "task", title: `Loose ${i}`, areaId: "inbox", priority: 2 }, TODAY);
    }
  }

  it("Move selected files five items to Art and they leave the inbox", async () => {
    await seed(6);
    render(<InboxPage today={TODAY} />);
    for (let i = 1; i <= 5; i++) {
      await userEvent.click(await screen.findByRole("checkbox", { name: new RegExp(`Loose ${i}$`) }));
    }
    await userEvent.selectOptions(screen.getByLabelText("Move selected to"), "art");
    await userEvent.click(screen.getByRole("button", { name: "Move selected" }));
    await vi.waitFor(() => expect(screen.queryByText("Loose 1")).toBeNull());
    expect(screen.getByText("Loose 6")).toBeInTheDocument();
    const all = await db.items.toArray();
    expect(all.filter((i) => i.areaId === "art")).toHaveLength(5);
    expect(all.find((i) => i.title === "Loose 6")!.areaId).toBe("inbox");
    expect(screen.getByRole("checkbox", { name: /Loose 6$/ })).not.toBeChecked();
  });

  it("select all shown then move empties the inbox", async () => {
    await seed(3);
    render(<InboxPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.selectOptions(screen.getByLabelText("Move selected to"), "mind");
    await userEvent.click(screen.getByRole("button", { name: "Move selected" }));
    expect(await screen.findByText("Nothing waiting in the inbox.")).toBeInTheDocument();
    expect((await db.items.toArray()).every((i) => i.areaId === "mind")).toBe(true);
  });

  it("the move button is disabled until something is selected and an area is chosen", async () => {
    await seed(2);
    render(<InboxPage today={TODAY} />);
    const btn = await screen.findByRole("button", { name: "Move selected" });
    expect(btn).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("Move selected to"), "body");
    expect(btn).toBeDisabled();
    await userEvent.click(screen.getByRole("checkbox", { name: /Loose 1$/ }));
    expect(btn).toBeEnabled();
    const sel = screen.getByLabelText("Move selected to");
    expect(within(sel).queryByRole("option", { name: "Inbox" })).toBeNull();
  });

  it("a failing bulk move shows the calm message and changes nothing", async () => {
    await seed(2);
    render(<InboxPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.selectOptions(screen.getByLabelText("Move selected to"), "art");
    const spy = vi.spyOn(db.items, "update").mockRejectedValue(new Error("boom"));
    await userEvent.click(screen.getByRole("button", { name: "Move selected" }));
    expect(await screen.findByText("That did not save. Try again.")).toBeInTheDocument();
    spy.mockRestore();
    expect((await db.items.toArray()).every((i) => i.areaId === "inbox")).toBe(true);
    expect(screen.getByText("Loose 1")).toBeInTheDocument();
  });

  it("the move and file selects offer the three new areas and no inbox", async () => {
    await seed(1);
    render(<InboxPage today={TODAY} />);
    for (const sel of [await screen.findByLabelText("Move selected to"), screen.getByLabelText("Area for Loose 1")]) {
      for (const name of ["Tech projects", "Production", "Admin"]) {
        expect(within(sel).getByRole("option", { name })).toBeInTheDocument();
      }
      expect(within(sel).queryByRole("option", { name: "Inbox" })).toBeNull();
    }
  });

  it("double-clicking Move selected writes once", async () => {
    await seed(2);
    render(<InboxPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    await userEvent.selectOptions(screen.getByLabelText("Move selected to"), "tech");
    const spy = vi.spyOn(repo, "updateItems");
    const btn = screen.getByRole("button", { name: "Move selected" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await screen.findByText("Nothing waiting in the inbox.");
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    expect((await db.items.toArray()).every((i) => i.areaId === "tech")).toBe(true);
  });

  it("a ticked item that left the inbox elsewhere is not still ticked when it returns", async () => {
    await seed(2);
    const other = new HubDB();
    render(<InboxPage today={TODAY} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select all shown" }));
    const one = (await db.items.filter((i) => i.title === "Loose 1").first())!;
    await other.items.update(one.id, { areaId: "art" });
    await vi.waitFor(() => expect(screen.queryByText("Loose 1")).toBeNull());
    await other.items.update(one.id, { areaId: "inbox" });
    await vi.waitFor(() => expect(screen.getByText("Loose 1")).toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: /Loose 1$/ })).not.toBeChecked();
    other.close();
  });
});
