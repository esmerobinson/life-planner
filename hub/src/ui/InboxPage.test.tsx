import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db } from "../data/db";
import { createItem } from "../data/repo";
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
    render(<InboxPage today={TODAY} />);
    await userEvent.click(screen.getByLabelText("Backlog text"));
    await userEvent.paste(BACKLOG);
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
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

  it("import panel shows added / already had / notes counts", async () => {
    render(<InboxPage today={TODAY} />);
    await userEvent.click(screen.getByLabelText("Backlog text"));
    await userEvent.paste(BACKLOG);
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Added 3, already had 0, notes 0")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Added 0, already had 3, notes 0")).toBeInTheDocument();
  });

  it("import notes are listed under a collapsed Notes (K) section", async () => {
    render(<InboxPage today={TODAY} />);
    await userEvent.click(screen.getByLabelText("Backlog text"));
    await userEvent.paste("- [ ] Pay rent [due 2026-13-45]\n- [ ] Odd one !p7\n");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("Added 2, already had 0, notes 2")).toBeInTheDocument();
    const summary = screen.getByText("Notes (2)", { selector: "summary" });
    const details = summary.closest("details")!;
    expect(details).not.toHaveAttribute("open");
    const items = within(details).getAllByRole("listitem", { hidden: true }).map((li) => li.textContent);
    expect(items).toEqual([
      "invalid due date 2026-13-45, imported without due: - [ ] Pay rent [due 2026-13-45]",
      "unknown priority !p7, defaulted to 2: - [ ] Odd one !p7",
    ]);
  });

  it("no Notes section when the import had nothing to note", async () => {
    render(<InboxPage today={TODAY} />);
    await userEvent.click(screen.getByLabelText("Backlog text"));
    await userEvent.paste(BACKLOG);
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByText("Added 3, already had 0, notes 0");
    expect(screen.queryByText(/^Notes \(/)).toBeNull();
  });

  it("import panel gives a short message for empty text", async () => {
    render(<InboxPage today={TODAY} />);
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByText("Paste some text or choose a file first.")).toBeInTheDocument();
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
  it("double-clicking Import imports once and disables the button while running", async () => {
    render(<InboxPage today={TODAY} />);
    await userEvent.click(screen.getByLabelText("Backlog text"));
    await userEvent.paste(BACKLOG);
    const btn = screen.getByRole("button", { name: "Import" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
    expect(await screen.findByText("Added 3, already had 0, notes 0")).toBeInTheDocument();
    await vi.waitFor(() => expect(btn).not.toBeDisabled());
    expect(screen.queryByText("Added 0, already had 3, notes 0")).toBeNull();
    expect(await db.items.count()).toBe(3);
  });

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

  it("Sidebar still shows exactly ten items (no Inbox) with the shell rendered", async () => {
    await createItem({ kind: "task", title: "Loose end", areaId: "inbox", priority: 2 }, TODAY);
    renderShell();
    await screen.findByRole("link", { name: "Inbox (1)" });
    const nav = document.querySelector(".sidebar") as HTMLElement;
    expect(within(nav).getAllByRole("link")).toHaveLength(10);
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
});
