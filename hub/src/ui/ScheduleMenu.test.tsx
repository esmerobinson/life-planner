import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import * as repo from "../data/repo";
import { db } from "../data/db";
import { createItem } from "../data/repo";
import { TodayPanel } from "./TodayPanel";

const WED = "2026-10-28";
const FRI = "2026-10-30";

async function task(today: string, title: string, extra: Record<string, unknown> = {}) {
  return createItem({ kind: "task", title, areaId: "writing", priority: 3, pinnedDate: today, ...extra }, today);
}

/** Opens the calendar menu of a task on Today and returns its two parts. */
async function open(today: string, title: string) {
  render(<TodayPanel today={today} />);
  await userEvent.click(await screen.findByRole("button", { name: `Schedule for: ${title}` }));
  const menu = screen.getByRole("group", { name: `Schedule ${title} for` });
  return {
    menu,
    doItOn: within(within(menu).getByRole("group", { name: "Do it on" })),
    deadline: within(within(menu).getByRole("group", { name: "Deadline" })),
  };
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("calendar menu: two parts", () => {
  it("has Do it on and Deadline, labelled and divided, Clear under Deadline only when a deadline is set", async () => {
    await task(WED, "Plan");
    const { menu, doItOn, deadline } = await open(WED, "Plan");
    const labels = menu.querySelectorAll(".pop-menu-label");
    expect([...labels].map((l) => l.textContent)).toEqual(["Do it on", "Deadline"]);
    // A divider (an hr, like the arrow menu's) sits between the two parts.
    expect([...menu.children].map((c) => c.tagName)).toEqual(["DIV", "HR", "DIV"]);
    expect(doItOn.getAllByRole("button").map((b) => b.textContent)).toEqual(["Today", "Tomorrow", "Next week", "Set", "Clear"]);
    expect(deadline.getAllByRole("button").map((b) => b.textContent)).toEqual(["Today", "Tomorrow", "Friday", "Next week", "Set"]);
  });

  it("shows the current values in the two date fields, and offers Clear under Deadline", async () => {
    await task(WED, "Plan", { due: "2026-11-20" });
    const { doItOn, deadline } = await open(WED, "Plan");
    expect(doItOn.getByLabelText("Day for Plan")).toHaveValue(WED);
    expect(deadline.getByLabelText("Deadline for Plan")).toHaveValue("2026-11-20");
    expect(deadline.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Today", "Tomorrow", "Friday", "Next week", "Set", "Clear",
    ]);
  });
});

describe("Deadline choices", () => {
  it.each([
    ["Today", WED],
    ["Tomorrow", "2026-10-29"],
    ["Friday", FRI],
    ["Next week", "2026-11-02"],
  ])("%s sets the due date and leaves the day it shows on Today alone", async (choice, expected) => {
    const it = await task(WED, "Plan", { due: "2026-12-01" });
    const spy = vi.spyOn(repo, "updateItem");
    const pin = vi.spyOn(repo, "pinTo");
    const { menu, deadline } = await open(WED, "Plan");
    await userEvent.click(deadline.getByRole("button", { name: choice }));
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.due).toBe(expected));
    expect((await db.items.get(it.id))!.pinnedDate).toBe(WED);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(pin).not.toHaveBeenCalled();
    expect(menu).not.toBeInTheDocument(); // closed
    expect(screen.getByText("Plan")).toBeInTheDocument(); // still on Today
  });

  it("Friday on a Wednesday is that week's Friday", async () => {
    const it = await task(WED, "Plan");
    const { deadline } = await open(WED, "Plan");
    await userEvent.click(deadline.getByRole("button", { name: "Friday" }));
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.due).toBe("2026-10-30"));
  });

  it("Friday on a Friday is the Friday a week later", async () => {
    const it = await task(FRI, "Plan");
    const { deadline } = await open(FRI, "Plan");
    await userEvent.click(deadline.getByRole("button", { name: "Friday" }));
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.due).toBe("2026-11-06"));
  });

  it("the strip's due line shows the new deadline", async () => {
    await task(WED, "Plan");
    const { deadline } = await open(WED, "Plan");
    await userEvent.click(deadline.getByRole("button", { name: "Friday" }));
    expect(await screen.findByText(/^Due Fri 30 Oct/)).toBeInTheDocument();
  });

  it("Clear removes the deadline (and only the deadline)", async () => {
    const it = await task(WED, "Plan", { due: "2026-11-20" });
    const { deadline } = await open(WED, "Plan");
    await userEvent.click(deadline.getByRole("button", { name: "Clear" }));
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.due).toBeUndefined());
    expect((await db.items.get(it.id))!.pinnedDate).toBe(WED);
    expect("due" in (await db.items.get(it.id))!).toBe(false);
  });

  it("a failing save shows the calm message and closes the menu", async () => {
    await task(WED, "Stuck");
    vi.spyOn(repo, "updateItem").mockRejectedValueOnce(new Error("write failed"));
    const { menu, deadline } = await open(WED, "Stuck");
    await userEvent.click(deadline.getByRole("button", { name: "Friday" }));
    expect(await screen.findByText("That did not save. Try again.")).toBeInTheDocument();
    expect(menu).not.toBeInTheDocument();
  });
});

describe("Deadline day field", () => {
  it("saves nothing while typing; Set saves the due date (never the pin) and closes", async () => {
    const it = await task(WED, "Plan");
    const spy = vi.spyOn(repo, "updateItem");
    const { menu, deadline } = await open(WED, "Plan");
    const day = deadline.getByLabelText("Deadline for Plan");
    for (const v of ["2026-10-03", "2026-10-30", "2026-11-30"]) fireEvent.change(day, { target: { value: v } });
    await settle();
    expect(spy).not.toHaveBeenCalled();
    expect(menu).toBeInTheDocument();
    await userEvent.click(deadline.getByRole("button", { name: "Set" }));
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.due).toBe("2026-11-30"));
    expect((await db.items.get(it.id))!.pinnedDate).toBe(WED);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(menu).not.toBeInTheDocument();
  });

  it("Enter saves it; a past, half-typed or unchanged day is ignored", async () => {
    const it = await task(WED, "Keyed", { due: "2026-11-20" });
    const spy = vi.spyOn(repo, "updateItem");
    const { deadline } = await open(WED, "Keyed");
    const day = deadline.getByLabelText("Deadline for Keyed");
    fireEvent.change(day, { target: { value: "0002-11-04" } });
    fireEvent.keyDown(day, { key: "Enter" });
    fireEvent.change(day, { target: { value: "2026-10-01" } });
    fireEvent.keyDown(day, { key: "Enter" });
    fireEvent.change(day, { target: { value: "2026-11-20" } }); // equal to the current due
    fireEvent.keyDown(day, { key: "Enter" });
    fireEvent.change(day, { target: { value: "" } });
    fireEvent.keyDown(day, { key: "Enter" });
    await settle();
    expect(spy).not.toHaveBeenCalled();
    fireEvent.change(day, { target: { value: "2026-11-04" } });
    fireEvent.keyDown(day, { key: "Enter" });
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.due).toBe("2026-11-04"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("today itself is accepted", async () => {
    const it = await task(WED, "Now", { due: "2026-11-20" });
    const { deadline } = await open(WED, "Now");
    const day = deadline.getByLabelText("Deadline for Now");
    fireEvent.change(day, { target: { value: WED } });
    fireEvent.keyDown(day, { key: "Enter" });
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.due).toBe(WED));
  });

  it("leaving the field saves it, but not when moving to another choice in the popover", async () => {
    const it = await task(WED, "Blurry");
    const spy = vi.spyOn(repo, "updateItem");
    const { deadline } = await open(WED, "Blurry");
    const day = deadline.getByLabelText("Deadline for Blurry");
    fireEvent.change(day, { target: { value: "2026-11-09" } });
    fireEvent.blur(day, { relatedTarget: deadline.getByRole("button", { name: "Friday" }) });
    await settle();
    expect(spy).not.toHaveBeenCalled();
    fireEvent.blur(day, { relatedTarget: null });
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.due).toBe("2026-11-09"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("a typed day then a click on Friday saves Friday, even when the click gives no focus (Safari)", async () => {
    const it = await task(WED, "Webkit");
    const spy = vi.spyOn(repo, "updateItem");
    const { deadline } = await open(WED, "Webkit");
    const day = deadline.getByLabelText("Deadline for Webkit");
    fireEvent.change(day, { target: { value: "2026-11-09" } });
    const friday = deadline.getByRole("button", { name: "Friday" });
    // Safari/WebKit: buttons take no focus on click, so the field blurs with no relatedTarget.
    fireEvent.pointerDown(friday);
    fireEvent.mouseDown(friday);
    fireEvent.blur(day, { relatedTarget: null });
    fireEvent.pointerUp(friday);
    fireEvent.mouseUp(friday);
    fireEvent.click(friday);
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.due).toBe(FRI));
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toEqual({ due: FRI });
  });

  it("a typed deadline then a click on a Do it on choice saves that choice only (Safari)", async () => {
    const it = await task(WED, "Cross");
    const spy = vi.spyOn(repo, "updateItem");
    const { doItOn, deadline } = await open(WED, "Cross");
    const day = deadline.getByLabelText("Deadline for Cross");
    fireEvent.change(day, { target: { value: "2026-11-09" } });
    const tomorrow = doItOn.getByRole("button", { name: "Tomorrow" });
    fireEvent.pointerDown(tomorrow);
    fireEvent.blur(day, { relatedTarget: null });
    fireEvent.click(tomorrow);
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.pinnedDate).toBe("2026-10-29"));
    await settle();
    expect(spy).not.toHaveBeenCalled();
    expect((await db.items.get(it.id))!.due).toBeUndefined();
  });

  it("after pressing a choice, a later real leave of the field still saves it", async () => {
    const it = await task(WED, "Later");
    const { deadline } = await open(WED, "Later");
    const day = deadline.getByLabelText("Deadline for Later");
    fireEvent.pointerDown(deadline.getByRole("button", { name: "Set" })); // nothing valid yet
    fireEvent.focus(day);
    fireEvent.change(day, { target: { value: "2026-11-12" } });
    fireEvent.blur(day, { relatedTarget: null });
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.due).toBe("2026-11-12"));
  });
});

describe("Do it on is unchanged by the Deadline part", () => {
  it.each([
    ["Tomorrow", "2026-10-29"],
    ["Next week", "2026-11-02"],
  ])("%s pins that day and leaves the due date alone", async (choice, expected) => {
    const it = await task(WED, "Plan", { due: "2026-11-20" });
    const spy = vi.spyOn(repo, "updateItem");
    const { doItOn } = await open(WED, "Plan");
    await userEvent.click(doItOn.getByRole("button", { name: choice }));
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.pinnedDate).toBe(expected));
    expect((await db.items.get(it.id))!.due).toBe("2026-11-20");
    expect(spy).not.toHaveBeenCalled();
  });

  it("its Clear removes the pin and keeps the deadline", async () => {
    const it = await task(WED, "Plan", { due: "2026-11-20" });
    const { doItOn } = await open(WED, "Plan");
    await userEvent.click(doItOn.getByRole("button", { name: "Clear" }));
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.pinnedDate).toBeUndefined());
    expect((await db.items.get(it.id))!.due).toBe("2026-11-20");
  });

  it("its day field pins the typed day and leaves the deadline alone", async () => {
    const it = await task(WED, "Plan", { due: "2026-11-20" });
    const { doItOn } = await open(WED, "Plan");
    const day = doItOn.getByLabelText("Day for Plan");
    fireEvent.change(day, { target: { value: "2026-11-04" } });
    await userEvent.click(doItOn.getByRole("button", { name: "Set" }));
    await vi.waitFor(async () => expect((await db.items.get(it.id))!.pinnedDate).toBe("2026-11-04"));
    expect((await db.items.get(it.id))!.due).toBe("2026-11-20");
  });
});
