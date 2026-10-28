import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../data/db";
import { createItem } from "../data/repo";
import { addDays, todayISO } from "../domain/dates";
import { AppShell } from "./AppShell";
import { InboxPage } from "./InboxPage";

const TODAY = "2026-10-27";

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

async function seed(title: string, extra: { due?: string; touchedAt?: string; areaId?: "art" | "inbox" } = {}, today = TODAY) {
  const it = await createItem({ kind: "task", title, areaId: extra.areaId ?? "art", priority: 3, due: extra.due }, today);
  if (extra.due === undefined) await db.items.update(it.id, { due: undefined });
  if (extra.touchedAt) await db.items.update(it.id, { touchedAt: extra.touchedAt });
  return it;
}

describe("Inbox: To sort and Needs a look", () => {
  it("shows both sections, the three groups and calm reasons with correct singular and plural", async () => {
    await seed("Late two", { due: "2026-10-25" });
    await seed("Late one", { due: "2026-10-26" });
    await seed("Today job", { due: "2026-10-27" });
    await seed("Tomorrow job", { due: "2026-10-28" });
    await seed("Soon job", { due: "2026-10-30" });
    await seed("Old job", { touchedAt: "2026-10-01" });
    render(<InboxPage today={TODAY} />);
    await screen.findByText("Late two");
    const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual(expect.arrayContaining(["To sort", "Needs a look"]));
    expect(h2.indexOf("To sort")).toBeLessThan(h2.indexOf("Needs a look"));
    const h3 = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(h3).toEqual(["Overdue", "Due soon", "Not looked at in a while"]);
    const row = (t: string) => screen.getByText(t).closest("li") as HTMLElement;
    expect(within(row("Late two")).getByText("Overdue by 2 days.")).toBeInTheDocument();
    expect(within(row("Late one")).getByText("Overdue by 1 day.")).toBeInTheDocument();
    expect(within(row("Today job")).getByText("Due today.")).toBeInTheDocument();
    expect(within(row("Tomorrow job")).getByText("Due in 1 day.")).toBeInTheDocument();
    expect(within(row("Soon job")).getByText("Due in 3 days.")).toBeInTheDocument();
    expect(
      within(row("Old job")).getByText("Not looked at for 26 days. What do you want to do with this?"),
    ).toBeInTheDocument();
    expect(within(row("Late two")).getByText("Art")).toBeInTheDocument();
    expect(screen.queryByText("Nothing needs a look.")).toBeNull();
  });

  it("empty groups are hidden and an empty section says Nothing needs a look.", async () => {
    await seed("Only overdue", { due: "2026-10-20" });
    const first = render(<InboxPage today={TODAY} />);
    await screen.findByText("Only overdue");
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Overdue"]);
    first.unmount();
    await db.items.clear();
    render(<InboxPage today={TODAY} />);
    expect(await screen.findByText("Nothing needs a look.")).toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
    expect(screen.getByText("Nothing waiting in the inbox.")).toBeInTheDocument();
  });

  it("does not list unsorted inbox items under Needs a look", async () => {
    await seed("Loose", { areaId: "inbox", due: "2026-10-01" });
    render(<InboxPage today={TODAY} />);
    await screen.findByLabelText("Area for Loose");
    expect(screen.getByText("Nothing needs a look.")).toBeInTheDocument();
  });

  it("changing the due date to a later one removes the row and saves", async () => {
    const it = await seed("Late job", { due: "2026-10-20" });
    render(<InboxPage today={TODAY} />);
    await screen.findByText("Late job");
    fireEvent.change(screen.getByLabelText("Change due date for Late job"), { target: { value: "2026-12-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Save date for Late job" }));
    await vi.waitFor(() => expect(screen.queryByText("Late job")).toBeNull());
    expect((await db.items.get(it.id))?.due).toBe("2026-12-01");
  });

  it("an empty date clears the due date and the row leaves", async () => {
    const it = await seed("Late job", { due: "2026-10-20" });
    render(<InboxPage today={TODAY} />);
    await screen.findByText("Late job");
    await userEvent.clear(screen.getByLabelText("Change due date for Late job"));
    await userEvent.click(screen.getByRole("button", { name: "Save date for Late job" }));
    await vi.waitFor(() => expect(screen.queryByText("Late job")).toBeNull());
    expect((await db.items.get(it.id))!.due).toBeUndefined();
  });

  it("ticking removes the row and Move to Archive removes it too", async () => {
    await seed("Tick me", { due: "2026-10-20" });
    await seed("Archive me", { due: "2026-10-21" });
    render(<InboxPage today={TODAY} />);
    await screen.findByText("Tick me");
    await userEvent.click(screen.getByRole("button", { name: "Done: Tick me" }));
    await vi.waitFor(() => expect(screen.queryByText("Tick me")).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Move: Archive me" }));
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await vi.waitFor(() => expect(screen.queryByText("Archive me")).toBeNull());
  });
});

describe("Inbox pill count", () => {
  function shell(today: string) {
    return render(
      <MemoryRouter initialEntries={["/inbox"]}>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/inbox" element={<InboxPage today={today} />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it("is unsorted plus overdue plus due soon plus stale, and drops after a tick without reload", async () => {
    const t = todayISO();
    await seed("Loose", { areaId: "inbox" }, t);
    await seed("Late", { due: addDays(t, -2) }, t);
    await seed("Soon", { due: addDays(t, 2) }, t);
    await seed("Old", { touchedAt: addDays(t, -20) }, t);
    await seed("Calm", { due: addDays(t, 30) }, t);
    shell(t);
    expect(await screen.findByRole("link", { name: "Inbox (4)" })).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Done: Late" }));
    expect(await screen.findByRole("link", { name: "Inbox (3)" })).toBeInTheDocument();
  });

  it("drops after changing a date from the page", async () => {
    const t = todayISO();
    await seed("Late", { due: addDays(t, -2) }, t);
    shell(t);
    await screen.findByRole("link", { name: "Inbox (1)" });
    fireEvent.change(await screen.findByLabelText("Change due date for Late"), { target: { value: addDays(t, 40) } });
    await userEvent.click(screen.getByRole("button", { name: "Save date for Late" }));
    await vi.waitFor(() => expect(screen.getByRole("link", { name: "Inbox" })).toBeInTheDocument());
  });
});
