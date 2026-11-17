import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createItem } from "../data/repo";
import { validItem } from "../data/validate";
import { dueLine, timeLabel } from "../domain/display";
import type { Item } from "../domain/types";
import { renderApp } from "../test/renderApp";
import { QuickAdd } from "./QuickAdd";

// Times on to-dos (Due reminders brief, 16 Nov 2026): an optional "HH:MM" on a to-do with a day.

const TODAY = "2026-11-16";
const row = (o: Record<string, unknown> = {}) => ({
  id: "i1", kind: "task", title: "Pretend", links: [], areaId: "art", priority: 2,
  status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01", ...o,
});
const findPanel = (name: string | RegExp) => screen.findByRole("complementary", { name });
const task = (title: string, extra: Partial<Item> = {}) => createItem({ kind: "task", title, areaId: "art", priority: 2, ...extra }, TODAY);

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
  localStorage.clear();
});

describe("the time field", () => {
  it("is an optional 24-hour HH:MM", () => {
    expect(validItem(row())).toBe(true);
    expect(validItem(row({ due: TODAY, time: "15:00" }))).toBe(true);
    expect(validItem(row({ due: TODAY, time: "00:05" }))).toBe(true);
    for (const bad of ["3pm", "24:00", "9:00", "15:60", 1500, ""]) expect(validItem(row({ due: TODAY, time: bad }))).toBe(false);
  });

  it("a row with a field this version doesn't know still passes (so older versions keep `time`)", () => {
    // validItem has never listed allowed keys: an older app reads a row with `time` and, as it
    // updates rows field by field (Dexie update), writes it back with `time` untouched.
    expect(validItem(row({ time: "15:00", fieldFromTheFuture: 1 }))).toBe(true);
  });

  it("reads as 3:00pm, 9:30am, 12:00pm and 12:15am", () => {
    expect(timeLabel("15:00")).toBe("3:00pm");
    expect(timeLabel("09:30")).toBe("9:30am");
    expect(timeLabel("12:00")).toBe("12:00pm");
    expect(timeLabel("00:15")).toBe("12:15am");
  });

  it("shows on the strip's line only when the to-do has a day", () => {
    const base = row() as unknown as Item;
    expect(dueLine({ ...base, due: TODAY, time: "15:00" }, TODAY).time).toBe("3:00pm");
    expect(dueLine({ ...base, pinnedDate: TODAY, time: "15:00" }, TODAY).time).toBe("3:00pm");
    expect(dueLine({ ...base, time: "15:00" }, TODAY).time).toBeUndefined();
  });
});

describe("Add form", () => {
  it("a to-do with a due day and a time is saved with both", async () => {
    const onAdded = vi.fn();
    render(<QuickAdd today={TODAY} onAdded={onAdded} />);
    await userEvent.type(screen.getByLabelText("Title"), "Dentist");
    await userEvent.type(screen.getByLabelText("Due"), "2026-11-18");
    await userEvent.type(screen.getByLabelText("Time"), "15:00");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    await vi.waitFor(async () => expect(await db.items.count()).toBe(1));
    expect((await db.items.toArray())[0]).toMatchObject({ title: "Dentist", due: "2026-11-18", time: "15:00" });
  });

  it("a time without a day isn't saved, and says why", async () => {
    render(<QuickAdd today={TODAY} onAdded={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Title"), "Call");
    await userEvent.type(screen.getByLabelText("Time"), "15:00");
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(await screen.findByText("A time needs a due day.")).toBeInTheDocument();
    expect(await db.items.count()).toBe(0);
  });

  it("an idea has no time field", async () => {
    render(<QuickAdd today={TODAY} onAdded={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText("Type"), "idea");
    expect(screen.queryByLabelText("Time")).toBeNull();
  });
});

describe("side panel", () => {
  it("shows the time, and Edit sets and changes it", async () => {
    const a = await task("Meeting", { due: "2026-11-18" });
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Meeting"));
    expect(p.getByText("Time")).toBeInTheDocument();
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    await userEvent.type(p.getByLabelText("Time"), "09:30");
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    await vi.waitFor(async () => expect((await db.items.get(a.id))!.time).toBe("09:30"));
    expect(await p.findByText("9:30am")).toBeInTheDocument();
  });

  it("clearing the only day clears the time too", async () => {
    const a = await task("Lunch", { due: "2026-11-18", time: "12:30" });
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Lunch"));
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    await userEvent.clear(p.getByLabelText("Due"));
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    await vi.waitFor(async () => expect((await db.items.get(a.id))!.due).toBeUndefined());
    expect((await db.items.get(a.id))!.time).toBeUndefined();
  });

  it("a to-do pinned to a day (no due date) can have a time", async () => {
    const a = await task("Call the bank", { pinnedDate: TODAY });
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Call the bank"));
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    await userEvent.type(p.getByLabelText("Time"), "16:00");
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    await vi.waitFor(async () => expect((await db.items.get(a.id))!.time).toBe("16:00"));
  });

  it("a time on a to-do with no day isn't saved, and says why", async () => {
    const a = await task("Someday");
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Someday"));
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    await userEvent.type(p.getByLabelText("Time"), "16:00");
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    expect(await p.findByText("A time needs a day: set Due, or Do it on from the calendar.")).toBeInTheDocument();
    expect((await db.items.get(a.id))!.time).toBeUndefined();
  });

  it("changing a to-do into an idea drops its time", async () => {
    const a = await task("Turn me", { due: "2026-11-18", time: "10:00" });
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Turn me"));
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(p.getByLabelText("Type"), "idea");
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    await vi.waitFor(async () => expect((await db.items.get(a.id))!.kind).toBe("idea"));
    expect((await db.items.get(a.id))!.time).toBeUndefined();
  });
});

describe("strip", () => {
  it("shows the time on the to-do's line", async () => {
    await task("Dentist", { due: TODAY, time: "15:00" });
    renderApp("/area/art", TODAY);
    expect(await screen.findByText("3:00pm")).toBeInTheDocument();
  });
});
