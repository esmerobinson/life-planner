import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import * as repo from "../data/repo";
import { db } from "../data/db";
import { createItem } from "../data/repo";
import { TodayPanel } from "./TodayPanel";

const TODAY = "2026-10-27"; // a Tuesday

async function task(title: string, extra: Record<string, unknown> = {}) {
  return createItem({ kind: "task", title, areaId: "writing", priority: 3, ...extra }, TODAY);
}

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const DATA_LINE = "Your data could not be read. Reload to try again.";
const SAVE_LINE = "That did not save. Try again.";

type Listener = (...args: unknown[]) => void;
// Node's process, typed locally so the app's tsconfig does not need @types/node.
const proc = (globalThis as unknown as {
  process: { on(e: string, f: Listener): void; off(e: string, f: Listener): void };
}).process;

/** Records unhandled promise rejections while a test runs. */
function watchUnhandled() {
  const seen = vi.fn();
  proc.on("unhandledRejection", seen);
  return { seen, stop: () => proc.off("unhandledRejection", seen) };
}

describe("TodayPanel", () => {
  it("shows up to 4 picks and an Also due section for the rest", async () => {
    for (let i = 1; i <= 7; i++) await task(`Late ${i}`, { due: `2026-10-${10 + i}` });
    render(<TodayPanel today={TODAY} />);
    const main = await screen.findByRole("list", { name: "Today" });
    expect(within(main).getAllByRole("listitem")).toHaveLength(4);
    const also = screen.getByText("Also due").closest("details")!;
    expect(also).not.toHaveAttribute("open");
    expect(within(also).getAllByRole("listitem")).toHaveLength(3);
    for (let i = 1; i <= 7; i++) {
      expect(screen.getAllByText(`Late ${i}`)).toHaveLength(1);
    }
  });

  it("an overdue item says how late it is in a red due line, with no sticker", async () => {
    await task("Late one", { due: "2026-10-20" });
    await task("Soon one", { due: "2026-10-28" });
    render(<TodayPanel today={TODAY} />);
    const late = await screen.findByText("Due Tue 20 Oct · 7 days late");
    expect(late).toHaveClass("strip-late");
    expect(late.getAttribute("style") ?? "").toBe(""); // styles live in strips.css, no inline colours
    expect(screen.getByText("Due tomorrow")).not.toHaveClass("strip-late");
    expect(screen.queryByText("OVERDUE")).toBeNull();
    expect(document.querySelector(".overdue-sticker")).toBeNull();
  });

  it("every task is a strip in a bullet-free list: tick box, title, then the two icons", async () => {
    await task("Strip me", { pinnedDate: TODAY });
    render(<TodayPanel today={TODAY} />);
    const list = await screen.findByRole("list", { name: "Today" });
    expect(list).toHaveClass("strip-list");
    const row = within(list).getByRole("listitem");
    expect(row).toHaveClass("strip");
    const tick = within(row).getByRole("checkbox", { name: "Mark done: Strip me" });
    expect(tick).toHaveClass("tick");
    expect(tick).not.toBeChecked();
    const schedule = within(row).getByRole("button", { name: "Schedule for: Strip me" });
    const move = within(row).getByRole("button", { name: "Move to: Strip me" });
    expect(schedule).toHaveAttribute("title", "Schedule for");
    expect(move).toHaveAttribute("title", "Move to");
    expect(schedule.querySelector("svg")).not.toBeNull();
    expect(move.querySelector("svg")).not.toBeNull();
    expect(within(row).queryByRole("button", { name: /^Done/ })).toBeNull();
    expect(within(row).getByText("On Tue 27 Oct")).toBeInTheDocument();
  });

  it("ticking calls tickItem and shows the celebration placeholder", async () => {
    const it = await task("Tick me", { priority: 1 });
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("checkbox", { name: "Mark done: Tick me" }));
    expect(await screen.findByTestId("celebration-placeholder")).toBeInTheDocument();
    expect((await db.items.get(it.id))!.status).toBe("done");
  });

  it("Schedule for Tomorrow removes it from Today and leaves the due date alone", async () => {
    const it = await task("Move me", { pinnedDate: TODAY, due: "2026-11-20" });
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Schedule for: Move me" }));
    await userEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    await screen.findByText("Nothing planned for today.");
    expect((await db.items.get(it.id))!.pinnedDate).toBe("2026-10-28");
    expect((await db.items.get(it.id))!.due).toBe("2026-11-20");
  });

  describe.each([
    ["Schedule for", "Tomorrow", "Schedule for Tomorrow"],
    ["Schedule for", "Next week", "Schedule for Next week"],
    ["Move to", "This week", "Move to This week"],
    ["Move to", "Remove from today", "Remove from today"],
  ])("a due-today priority-1 item: %s %s", (icon, choice, what) => {
    it(`${what} removes it from the picks and from Also due`, async () => {
      // Four earlier-due items fill the picks so the target can sit in Also due too.
      for (let i = 1; i <= 4; i++) await task(`Filler ${i}`, { due: `2026-10-2${i}` });
      await task("Urgent", { due: TODAY, priority: 1 });
      render(<TodayPanel today={TODAY} />);
      const also = await screen.findByRole("list", { name: "Also due", hidden: true });
      expect(within(also).getByText("Urgent")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: `${icon}: Urgent` }));
      await userEvent.click(screen.getByRole("button", { name: choice }));
      await vi.waitFor(() => expect(screen.queryByText("Urgent")).toBeNull());
      expect(screen.queryByRole("list", { name: "Also due", hidden: true })).toBeNull();
    });

    it(`${what} removes it when it is a pick`, async () => {
      await task("Urgent", { due: TODAY, priority: 1 });
      render(<TodayPanel today={TODAY} />);
      const main = await screen.findByRole("list", { name: "Today" });
      expect(within(main).getByText("Urgent")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: `${icon}: Urgent` }));
      await userEvent.click(screen.getByRole("button", { name: choice }));
      await screen.findByText("Nothing planned for today.");
      expect(screen.queryByRole("list", { name: "Today" })).toBeNull();
      expect(screen.queryByText("Urgent")).toBeNull();
    });
  });

  it("empty state shows a calm message, no error", async () => {
    render(<TodayPanel today={TODAY} />);
    expect(await screen.findByText("Nothing planned for today.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Archive removes it from Today", async () => {
    const it = await task("Archive me", { pinnedDate: TODAY });
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Move to: Archive me" }));
    await userEvent.click(screen.getByRole("button", { name: "Archive" }));
    await screen.findByText("Nothing planned for today.");
    expect((await db.items.get(it.id))!.status).toBe("archived");
  });

  it("never shows the empty state while the first read is pending", async () => {
    const real = await db.items.toArray();
    expect(real).toEqual([]);
    const it = await task("Pinned", { pinnedDate: TODAY });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const orig = repo.listItems;
    vi.spyOn(repo, "listItems").mockImplementationOnce(async (f) => {
      await gate;
      return orig(f);
    });
    render(<TodayPanel today={TODAY} />);
    expect(screen.queryByText("Nothing planned for today.")).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByText("Nothing planned for today.")).toBeNull();
    await act(async () => release());
    expect(await screen.findByText(it.title)).toBeInTheDocument();
    expect(screen.queryByText("Nothing planned for today.")).toBeNull();
  });

  it("a failing first read shows the calm data message and no empty-state sentence", async () => {
    vi.spyOn(repo, "listItems").mockRejectedValueOnce(new Error("disk gone"));
    render(<TodayPanel today={TODAY} />);
    expect(await screen.findByText(DATA_LINE)).toBeInTheDocument();
    expect(screen.queryByText("Nothing planned for today.")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    ["Schedule for", "Tomorrow", "pinTo", "Schedule Stuck for"],
    ["Move to", "This week", "moveTo", "Move Stuck to"],
  ] as const)("a failing %s %s shows 'That did not save. Try again.' and no unhandled rejection", async (icon, choice, fn, group) => {
    const watch = watchUnhandled();
    try {
      await task("Stuck", { pinnedDate: TODAY });
      vi.spyOn(repo, fn).mockRejectedValueOnce(new Error("write failed"));
      render(<TodayPanel today={TODAY} />);
      await userEvent.click(await screen.findByRole("button", { name: `${icon}: Stuck` }));
      await userEvent.click(screen.getByRole("button", { name: choice }));
      expect(await screen.findByText(SAVE_LINE)).toBeInTheDocument();
      expect(screen.queryByRole("group", { name: group })).toBeNull(); // the menu closed
      expect(screen.getByRole("button", { name: `${icon}: Stuck` })).toHaveAttribute("aria-expanded", "false");
      expect(screen.getByRole("button", { name: `${icon}: Stuck` })).toHaveFocus();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(watch.seen).not.toHaveBeenCalled();
    } finally {
      watch.stop();
    }
  });

  it("a failing tick shows the save message, no celebration, no unhandled rejection", async () => {
    const watch = watchUnhandled();
    try {
      await task("Tick fails", { priority: 1 });
      vi.spyOn(repo, "tickItem").mockRejectedValueOnce(new Error("write failed"));
      render(<TodayPanel today={TODAY} />);
      await userEvent.click(await screen.findByRole("checkbox", { name: "Mark done: Tick fails" }));
      expect(await screen.findByText(SAVE_LINE)).toBeInTheDocument();
      expect(screen.queryByTestId("celebration-placeholder")).toBeNull();
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
      expect(watch.seen).not.toHaveBeenCalled();
    } finally {
      watch.stop();
    }
  });

  it("Move-to choices are plain labelled buttons, and Escape closes them and returns focus", async () => {
    await task("Keys", { pinnedDate: TODAY });
    render(<TodayPanel today={TODAY} />);
    const toggle = await screen.findByRole("button", { name: "Move to: Keys" });
    expect(toggle).not.toHaveAttribute("aria-haspopup");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const group = screen.getByRole("group", { name: "Move Keys to" });
    // Change to (not To-do, which it is), the other areas (not Writing, where it is), then
    // This week, Remove from today and Archive.
    expect(within(within(group).getByRole("group", { name: "Change to" })).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Idea", "Goal",
    ]);
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Idea", "Goal",
      "Admin", "Art", "Content", "Mind", "Body", "Tech projects", "Production",
      "This week", "Remove from today", "Archive", "Delete",
    ]);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("menuitem")).toBeNull();
    within(group).getByRole("button", { name: "This week" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("group", { name: "Move Keys to" })).toBeNull();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("Move to an area files the task there", async () => {
    const it = await task("Wander", { pinnedDate: TODAY });
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Move to: Wander" }));
    await userEvent.click(within(screen.getByRole("group", { name: "Move Wander to" })).getByRole("button", { name: "Body" }));
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.areaId).toBe("body"));
    expect(screen.queryByRole("group", { name: "Move Wander to" })).toBeNull();
    expect(screen.getByText("Wander")).toBeInTheDocument(); // still pinned to today
  });

  it("Schedule for offers Today, Tomorrow, Next week, a day with Set, and Clear", async () => {
    await task("Plan", { pinnedDate: TODAY });
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Schedule for: Plan" }));
    const group = screen.getByRole("group", { name: "Schedule Plan for" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Today", "Tomorrow", "Next week", "Set", "Clear",
    ]);
    expect(within(group).getByLabelText("Day for Plan")).toHaveValue(TODAY);
  });

  /** Waits long enough for any stray write to land. */
  const settle = () => act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

  it("editing the day saves nothing until Set, then pins it (never the due date) and closes", async () => {
    const it = await task("Plan", { pinnedDate: TODAY, due: "2026-11-30" });
    const spy = vi.spyOn(repo, "pinTo");
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Schedule for: Plan" }));
    const group = screen.getByRole("group", { name: "Schedule Plan for" });
    const day = within(group).getByLabelText("Day for Plan");
    // Typing the day first passes through real future dates (30 Oct) on the way to 30 Nov.
    for (const v of ["2026-10-03", "2026-10-30", "2026-11-30"]) fireEvent.change(day, { target: { value: v } });
    await settle();
    expect(spy).not.toHaveBeenCalled();
    expect((await db.items.get(it.id))!.pinnedDate).toBe(TODAY);
    expect(screen.getByRole("group", { name: "Schedule Plan for" })).toBeInTheDocument(); // still open, still on Today
    await userEvent.click(within(group).getByRole("button", { name: "Set" }));
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.pinnedDate).toBe("2026-11-30"));
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await db.items.get(it.id))!.due).toBe("2026-11-30");
    expect(screen.queryByRole("group", { name: "Schedule Plan for" })).toBeNull();
  });

  it("Enter in the day field saves it; a past or half-typed day is never saved", async () => {
    const it = await task("Keyed", { pinnedDate: TODAY });
    const spy = vi.spyOn(repo, "pinTo");
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Schedule for: Keyed" }));
    const day = screen.getByLabelText("Day for Keyed");
    fireEvent.change(day, { target: { value: "0002-11-04" } });
    fireEvent.keyDown(day, { key: "Enter" });
    fireEvent.change(day, { target: { value: "2026-10-01" } });
    fireEvent.keyDown(day, { key: "Enter" });
    await settle();
    expect(spy).not.toHaveBeenCalled();
    fireEvent.change(day, { target: { value: "2026-11-04" } });
    fireEvent.keyDown(day, { key: "Enter" });
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.pinnedDate).toBe("2026-11-04"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("leaving the day field saves it, but not when moving to another choice in the popover", async () => {
    const it = await task("Blurry", { pinnedDate: TODAY });
    const spy = vi.spyOn(repo, "pinTo");
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Schedule for: Blurry" }));
    const group = screen.getByRole("group", { name: "Schedule Blurry for" });
    const day = within(group).getByLabelText("Day for Blurry");
    fireEvent.change(day, { target: { value: "2026-11-09" } });
    fireEvent.blur(day, { relatedTarget: within(group).getByRole("button", { name: "Clear" }) });
    await settle();
    expect(spy).not.toHaveBeenCalled();
    fireEvent.blur(day, { relatedTarget: null });
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.pinnedDate).toBe("2026-11-09"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a typed day then a click on Tomorrow saves Tomorrow, even when the click gives no focus (Safari)", async () => {
    const it = await task("Webkit", { pinnedDate: TODAY });
    const spy = vi.spyOn(repo, "pinTo");
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Schedule for: Webkit" }));
    const group = screen.getByRole("group", { name: "Schedule Webkit for" });
    const day = within(group).getByLabelText("Day for Webkit");
    fireEvent.change(day, { target: { value: "2026-11-09" } });
    const tomorrow = within(group).getByRole("button", { name: "Tomorrow" });
    // Safari/WebKit: buttons take no focus on click, so the field blurs with no relatedTarget.
    fireEvent.pointerDown(tomorrow);
    fireEvent.mouseDown(tomorrow);
    fireEvent.blur(day, { relatedTarget: null });
    fireEvent.pointerUp(tomorrow);
    fireEvent.mouseUp(tomorrow);
    fireEvent.click(tomorrow);
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.pinnedDate).toBe("2026-10-28"));
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe("2026-10-28");
  });

  it("after pressing a choice, a later real leave of the day field still saves it", async () => {
    const it = await task("Later", { pinnedDate: TODAY });
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Schedule for: Later" }));
    const group = screen.getByRole("group", { name: "Schedule Later for" });
    const day = within(group).getByLabelText("Day for Later");
    // A press on Set with no valid day: nothing saves, and the press is used up.
    fireEvent.pointerDown(within(group).getByRole("button", { name: "Set" }));
    fireEvent.focus(day);
    fireEvent.change(day, { target: { value: "2026-11-12" } });
    fireEvent.blur(day, { relatedTarget: null });
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.pinnedDate).toBe("2026-11-12"));
  });

  it("Escape closes an open popover even when focus never went into it (Safari/Firefox clicks)", async () => {
    await task("Mac", { pinnedDate: TODAY });
    render(<TodayPanel today={TODAY} />);
    for (const [icon, group] of [["Schedule for: Mac", "Schedule Mac for"], ["Move to: Mac", "Move Mac to"]]) {
      const toggle = await screen.findByRole("button", { name: icon });
      await userEvent.click(toggle);
      expect(screen.getByRole("group", { name: group })).toBeInTheDocument();
      toggle.blur(); // Safari and Firefox on macOS leave focus on <body> after a click
      expect(document.activeElement).toBe(document.body);
      await userEvent.keyboard("{Escape}");
      expect(screen.queryByRole("group", { name: group })).toBeNull();
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(toggle).toHaveFocus();
    }
  });

  it("Schedule for Next week pins next Monday, and Clear removes the pin", async () => {
    const it = await task("Later", { pinnedDate: TODAY });
    const first = render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Schedule for: Later" }));
    await userEvent.click(screen.getByRole("button", { name: "Next week" }));
    await screen.findByText("Nothing planned for today.");
    expect((await db.items.get(it.id))!.pinnedDate).toBe("2026-11-02");
    first.unmount();
    await db.items.update(it.id, { pinnedDate: TODAY });
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Schedule for: Later" }));
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.pinnedDate).toBeUndefined());
  });

  it("a click outside closes an open popover", async () => {
    await task("Outside", { pinnedDate: TODAY });
    render(<TodayPanel today={TODAY} />);
    await userEvent.click(await screen.findByRole("button", { name: "Schedule for: Outside" }));
    expect(screen.getByRole("group", { name: "Schedule Outside for" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("heading", { name: "Today" }));
    expect(screen.queryByRole("group", { name: "Schedule Outside for" })).toBeNull();
    expect(screen.getByRole("button", { name: "Schedule for: Outside" })).toHaveAttribute("aria-expanded", "false");
  });
});
