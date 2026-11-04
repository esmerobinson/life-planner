import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { db } from "../data/db";
import { AppShell } from "./AppShell";
import { useShellToday } from "./shellContext";
import { TodayPanel } from "./TodayPanel";

function ShowToday() {
  return <p>{`date:${useShellToday()}`}</p>;
}

function TodayRoute() {
  return <TodayPanel today={useShellToday()} />;
}

function renderShell(child: React.ReactNode) {
  return render(
    <MemoryRouter initialEntries={["/x"]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/x" element={child} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AppShell", () => {
  it("converts legacy goal milestones into flagged tasks on start (sync off)", async () => {
    await db.goals.add({
      id: "g", title: "Pretend goal", areaId: "art", kind: "practice", createdAt: "2026-10-01",
      milestones: [{ id: "m", title: "A pretend step", done: false }],
    });
    renderShell(<p>page</p>);
    await vi.waitFor(async () => expect((await db.goals.get("g"))!.milestones).toEqual([]));
    expect(await db.items.toArray()).toEqual([expect.objectContaining({ title: "A pretend step", milestone: true, goalId: "g" })]);
  });

  it("quick-add on /today shows a task due today in the Today list", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 27, 12, 0));
    renderShell(<TodayRoute />);
    await screen.findByText("Nothing planned for today.");
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await userEvent.type(screen.getByLabelText("Title"), "Pay the gas bill");
    await userEvent.selectOptions(screen.getByLabelText("Area"), "mind");
    await userEvent.type(screen.getByLabelText("Due"), "2026-10-27");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    const list = await screen.findByRole("list", { name: "Today" });
    expect(list).toHaveTextContent("Pay the gas bill");
  });

  it("the Add form closes after an item is added and the item shows in the list", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 27, 12, 0));
    renderShell(<TodayRoute />);
    await screen.findByText("Nothing planned for today.");
    const addBtn = screen.getByRole("button", { name: "Add" });
    await userEvent.click(addBtn);
    await userEvent.type(screen.getByLabelText("Title"), "Water the ferns");
    await userEvent.selectOptions(screen.getByLabelText("Area"), "mind");
    await userEvent.type(screen.getByLabelText("Due"), "2026-10-27");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(await screen.findByRole("list", { name: "Today" })).toHaveTextContent("Water the ferns");
    expect(screen.queryByLabelText("Title")).toBeNull();
    expect(addBtn).toHaveAttribute("aria-expanded", "false");
    expect(addBtn).toHaveFocus(); // the focused "Add item" button went away: focus goes back to Add
  });

  it("a failed validation keeps the Add form open with what was typed", async () => {
    renderShell(<p>page</p>);
    await userEvent.click(screen.getByRole("button", { name: "Add" }));
    await userEvent.selectOptions(screen.getByLabelText("Type"), "goal");
    await userEvent.type(screen.getByLabelText("Title"), "A goal with no deadline");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(await screen.findByText("A finite goal needs a deadline.")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toHaveValue("A goal with no deadline");
    expect(await db.goals.count()).toBe(0);
  });

  it("today follows the clock: after midnight, a focus event updates children", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 27, 23, 50));
    renderShell(<ShowToday />);
    expect(await screen.findByText("date:2026-10-27")).toBeInTheDocument();
    vi.setSystemTime(new Date(2026, 9, 28, 0, 10));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByText("date:2026-10-28")).toBeInTheDocument();
  });

  it("a visibilitychange to visible also updates today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 27, 23, 50));
    renderShell(<ShowToday />);
    await screen.findByText("date:2026-10-27");
    vi.setSystemTime(new Date(2026, 9, 28, 0, 10));
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(await screen.findByText("date:2026-10-28")).toBeInTheDocument();
  });

  it("a tab left focused across midnight moves to the new day without a focus event", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date(2026, 9, 27, 23, 59, 30));
    renderShell(<ShowToday />);
    expect(await screen.findByText("date:2026-10-27")).toBeInTheDocument();
    vi.setSystemTime(new Date(2026, 9, 28, 0, 0, 30));
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(await screen.findByText("date:2026-10-28")).toBeInTheDocument();
  });

  it("the top row holds only the Inbox pill (Add is the round button); Backup is not in it", async () => {
    renderShell(<p>x</p>);
    const row = document.querySelector(".shell-actions") as HTMLElement;
    const kids = Array.from(row.children).map((c) => c.textContent);
    expect(kids).toEqual(["Inbox"]);
    expect(row.lastElementChild).toHaveAttribute("href", "/inbox");
    expect(row.querySelector('a[href="/backup"]')).toBeNull();
    expect(document.querySelector('.sidebar-footer a[href="/backup"]')).not.toBeNull();
  });
});

describe("the round Add button (1C)", () => {
  it("is a round '+' named Add, after the page, and opens the form as a pop-up card", async () => {
    renderShell(<p>page</p>);
    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toHaveClass("add-fab");
    // The plus is a drawn, centred icon (a "+" character sat off-centre).
    const icon = add.querySelector("svg.add-fab-icon");
    expect(icon).not.toBeNull();
    expect(icon!.querySelector("g")).not.toHaveAttribute("transform");
    expect(add.closest(".shell-actions")).toBeNull();
    await userEvent.click(add);
    const card = screen.getByRole("dialog", { name: "Add" });
    expect(card).toHaveClass("add-pop");
    expect(add).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Title")).toHaveFocus();
  });

  it("the button again, Escape, Cancel or a click outside closes it; focus returns to the button", async () => {
    renderShell(<p>page</p>);
    const add = screen.getByRole("button", { name: "Add" });
    await userEvent.click(add);
    await userEvent.click(add);
    expect(screen.queryByRole("dialog", { name: "Add" })).toBeNull();

    await userEvent.click(add);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Add" })).toBeNull();
    expect(add).toHaveFocus();

    await userEvent.click(add);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog", { name: "Add" })).toBeNull();
    expect(add).toHaveFocus();

    await userEvent.click(add);
    await userEvent.click(screen.getByText("page"));
    expect(screen.queryByRole("dialog", { name: "Add" })).toBeNull();
  });

  it("a click outside keeps what was typed for the next open; Cancel and a successful add clear it (I-5)", async () => {
    renderShell(<p>page</p>);
    const add = screen.getByRole("button", { name: "Add" });
    await userEvent.click(add);
    await userEvent.type(screen.getByLabelText("Title"), "Pretend half-typed thought");
    await userEvent.selectOptions(screen.getByLabelText("Type"), "project");
    await userEvent.type(screen.getByLabelText("Notes"), "Pretend notes");
    await userEvent.click(screen.getByText("page"));
    expect(screen.queryByRole("dialog", { name: "Add" })).toBeNull();
    await userEvent.click(add);
    expect(screen.getByLabelText("Title")).toHaveValue("Pretend half-typed thought");
    expect(screen.getByLabelText("Type")).toHaveValue("project");
    expect(screen.getByLabelText("Notes")).toHaveValue("Pretend notes");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(add);
    expect(screen.getByLabelText("Title")).toHaveValue("Pretend half-typed thought"); // Escape keeps it too
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(add);
    expect(screen.getByLabelText("Title")).toHaveValue("");
    expect(screen.getByLabelText("Type")).toHaveValue("task");

    await userEvent.type(screen.getByLabelText("Title"), "Pretend saved thought");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    await vi.waitFor(() => expect(screen.queryByRole("dialog", { name: "Add" })).toBeNull());
    await userEvent.click(add);
    expect(screen.getByLabelText("Title")).toHaveValue("");
  });

  it("on a phone it is a sheet from the bottom with Close; the shade closes it too", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {},
    }));
    try {
      renderShell(<p>page</p>);
      expect(document.querySelector(".shell-actions")).toBeNull(); // Inbox is in the phone top bar
      const add = screen.getByRole("button", { name: "Add" });
      await userEvent.click(add);
      const sheet = screen.getByRole("dialog", { name: "Add" });
      expect(sheet).toHaveClass("add-sheet");
      await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
      expect(screen.queryByRole("dialog", { name: "Add" })).toBeNull();
      expect(add).toHaveFocus();
      await userEvent.click(add);
      await userEvent.click(document.querySelector(".add-shade") as HTMLElement);
      expect(screen.queryByRole("dialog", { name: "Add" })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
