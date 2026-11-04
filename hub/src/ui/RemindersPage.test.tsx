import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import { db } from "../data/db";
import { REMINDERS_HANDLER } from "../reminders/bridge";
import { DEFAULT_REMINDER_SETTINGS } from "../reminders/schedule";
import { REMINDER_SETTINGS_KEY } from "../reminders/settings";
import { RemindersPage } from "./RemindersPage";
import { Sidebar } from "./Sidebar";

type W = { webkit?: unknown };

/** A pretend Mac bridge answering like main.swift's. */
function fakeMac(status: "authorized" | "denied" | "not-determined", afterAsk: "authorized" | "denied" = "authorized") {
  let current: string = status;
  const postMessage = vi.fn(async (m: { action: string }) => {
    if (m.action === "requestPermission") current = afterAsk;
    return { status: current, scheduled: 0 };
  });
  (window as W).webkit = { messageHandlers: { [REMINDERS_HANDLER]: { postMessage } } };
  return postMessage;
}

const actions = (fn: ReturnType<typeof fakeMac>) => fn.mock.calls.map((c) => (c[0] as { action: string }).action);

beforeEach(async () => {
  await db.syncMeta.clear();
});

afterEach(() => {
  delete (window as W).webkit;
  vi.restoreAllMocks();
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <RemindersPage />
    </MemoryRouter>,
  );

const stored = async () => (await db.syncMeta.get(REMINDER_SETTINGS_KEY))?.value as typeof DEFAULT_REMINDER_SETTINGS | undefined;

describe("Reminders page (4A, a simple list)", () => {
  it("lists the six reminders with their words, times and On / Off, as in the mockup", async () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Reminders" })).toBeInTheDocument();
    const rows = within(await screen.findByRole("list")).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector(".rem-name")!.textContent)).toEqual([
      "Morning pages", "Daily check-in", "To-dos and deadlines", "Project session today", "Weekly review", "Monthly review",
    ]);
    expect(screen.getByText("“Morning pages: Three pages, before anything else.”")).toBeInTheDocument();
    expect(screen.getByLabelText("Morning pages time")).toHaveValue("08:30");
    expect(screen.getByLabelText("Daily check-in time")).toHaveValue("20:00");
    expect(screen.getByLabelText("Weekly review day")).toHaveValue("sun");
    expect(screen.getByLabelText("Monthly review day")).toHaveValue("first");
    expect(screen.getByRole("button", { name: "Morning pages: On" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Monthly review: Off" })).toHaveAttribute("aria-pressed", "false");
    expect(rows[5]).toHaveClass("off");
    expect(screen.getByRole("checkbox", { name: "Deadlines: also the day before" })).toBeChecked();
  });

  it("in a browser tab, says reminders come from the Mac app", async () => {
    renderPage();
    expect(await screen.findByText(/pop up from the Esmeworld Mac app/)).toBeInTheDocument();
  });

  it("on the phone, says phone reminders come with the iPhone app", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)");
    renderPage();
    expect(await screen.findByText(/Reminders on the phone come with the iPhone app/)).toBeInTheDocument();
  });

  it("saves every change on this device only (syncMeta)", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Monthly review: Off" }));
    await waitFor(async () => expect((await stored())?.monthly.on).toBe(true));
    fireEvent.change(screen.getByLabelText("Morning pages time"), { target: { value: "07:15" } });
    await waitFor(async () => expect((await stored())?.morning.time).toBe("07:15"));
    await user.selectOptions(screen.getByLabelText("Weekly review day"), "sat");
    await waitFor(async () => expect((await stored())?.weekly.day).toBe("sat"));
    await user.click(screen.getByRole("checkbox", { name: "Deadlines: also the day before" }));
    await waitFor(async () => expect((await stored())?.todos.dayBefore).toBe(false));
    expect(screen.getByRole("button", { name: "Monthly review: On" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows what was saved before", async () => {
    await db.syncMeta.put({ key: REMINDER_SETTINGS_KEY, value: { ...DEFAULT_REMINDER_SETTINGS, checkin: { on: false, time: "21:45" } } });
    renderPage();
    expect(await screen.findByRole("button", { name: "Daily check-in: Off" })).toBeInTheDocument();
    expect(screen.getByLabelText("Daily check-in time")).toHaveValue("21:45");
  });

  it("in the Mac app, opening it asks the Mac once (reminders are on by default)", async () => {
    const mac = fakeMac("not-determined");
    renderPage();
    await waitFor(() => expect(actions(mac)).toContain("requestPermission"));
    expect(actions(mac).filter((a) => a === "requestPermission")).toHaveLength(1);
    expect(await screen.findByText(/the Mac asks once/)).toBeInTheDocument();
  });

  it("never asks again once the Mac has an answer, and says how to turn them back on", async () => {
    const mac = fakeMac("denied");
    renderPage();
    expect(await screen.findByText(/Notifications are turned off for Esmeworld/)).toBeInTheDocument();
    expect(actions(mac)).not.toContain("requestPermission");
  });

  it("with every reminder off, asks only when one is turned on", async () => {
    const off = structuredClone(DEFAULT_REMINDER_SETTINGS);
    for (const r of Object.values(off)) r.on = false;
    await db.syncMeta.put({ key: REMINDER_SETTINGS_KEY, value: off });
    const mac = fakeMac("not-determined");
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("button", { name: "Morning pages: Off" });
    await waitFor(() => expect(actions(mac)).toContain("status"));
    expect(actions(mac)).not.toContain("requestPermission");
    await user.click(screen.getByRole("button", { name: "Morning pages: Off" }));
    await waitFor(() => expect(actions(mac)).toContain("requestPermission"));
  });
});

describe("Reminders link", () => {
  it("is a quiet footer link beside Backup, Sync and Bin", () => {
    render(
      <MemoryRouter initialEntries={["/reminders"]}>
        <Sidebar />
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Reminders" });
    expect(link).toHaveAttribute("href", "/reminders");
    expect(link.closest(".sidebar-footer")).not.toBeNull();
    expect([...link.closest(".sidebar-footer")!.querySelectorAll("a")].map((a) => a.textContent)).toEqual([
      "Reminders", "Backup", "Sync", "Bin",
    ]);
  });
});
