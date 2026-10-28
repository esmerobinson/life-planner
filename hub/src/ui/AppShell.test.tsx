import { act, render, screen } from "@testing-library/react";
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

  it("top row has Add on the left and the Inbox pill last; Backup is not in it", async () => {
    renderShell(<p>x</p>);
    const row = document.querySelector(".shell-actions") as HTMLElement;
    const kids = Array.from(row.children).map((c) => c.textContent);
    expect(kids).toEqual(["Add", "Inbox"]);
    expect(row.lastElementChild).toHaveAttribute("href", "/inbox");
    expect(row.querySelector('a[href="/backup"]')).toBeNull();
    expect(document.querySelector('.sidebar-footer a[href="/backup"]')).not.toBeNull();
  });
});
