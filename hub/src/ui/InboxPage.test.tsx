import { render, screen, within } from "@testing-library/react";
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

describe("AppShell additions", () => {
  it("Inbox link appears in the shell only when inbox items exist", async () => {
    const first = renderShell();
    expect(await screen.findByText("Today page")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole("link", { name: /Inbox/ })).toBeNull();
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
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await userEvent.type(screen.getByLabelText("Title"), "Fresh");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(await screen.findByRole("link", { name: "Inbox (1)" })).toBeInTheDocument();
  });

  it("filing the last inbox item from the inbox page drops the shell link", async () => {
    await createItem({ kind: "task", title: "Only one", areaId: "inbox", priority: 2 }, TODAY);
    renderShell();
    await userEvent.click(await screen.findByRole("link", { name: "Inbox (1)" }));
    await userEvent.selectOptions(await screen.findByLabelText("Area for Only one"), "art");
    await userEvent.click(screen.getByRole("button", { name: "File Only one" }));
    await screen.findByText("Nothing waiting in the inbox.");
    await vi.waitFor(() => expect(screen.queryByRole("link", { name: /Inbox/ })).toBeNull());
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
