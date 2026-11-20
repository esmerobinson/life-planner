import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { db } from "../data/db";
import { createItem } from "../data/repo";
import { validItem } from "../data/validate";
import { MAX_BEFORE_SUNSET, parseRemindAt, REMIND_WORDS, remindAtLabel } from "../domain/remindAt";
import type { Item } from "../domain/types";
import { renderApp } from "../test/renderApp";

// "Remind me" on a to-do or habit (Esme, 20 Nov 2026): its own Due reminder at a time, or some
// minutes before sunset, on each day it is on Today and not done. Everything else waits for
// the one 14:00 count.

const TODAY = "2026-11-16";
const row = (o: Record<string, unknown> = {}) => ({
  id: "i1", kind: "task", title: "Pretend", links: [], areaId: "art", priority: 2,
  status: "open", createdAt: "2026-10-01", touchedAt: "2026-10-01", ...o,
});
const findPanel = (name: string | RegExp) => screen.findByRole("complementary", { name });
const task = (title: string, extra: Partial<Item> = {}) => createItem({ kind: "task", title, areaId: "art", priority: 2, ...extra }, TODAY);
const stored = async (id: string) => (await db.items.get(id))!;

beforeEach(async () => {
  await db.items.clear();
  await db.goals.clear();
  localStorage.clear();
});

describe("the remindAt field", () => {
  it("is optional: HH:MM, or sunset-N minutes (0 to the most)", () => {
    expect(validItem(row())).toBe(true);
    for (const ok of ["22:00", "00:05", "sunset-90", "sunset-0", `sunset-${MAX_BEFORE_SUNSET}`]) expect(validItem(row({ remindAt: ok }))).toBe(true);
    for (const bad of ["10pm", "24:00", "9:00", "sunset", "sunset+30", "sunset-", `sunset-${MAX_BEFORE_SUNSET + 1}`, "sunset-1000", 90, "", null]) {
      expect(validItem(row({ remindAt: bad }))).toBe(false);
    }
  });

  it("reads as a time or minutes before sunset (the same rules as the Worker's)", () => {
    expect(parseRemindAt("22:00")).toEqual({ time: "22:00" });
    expect(parseRemindAt("sunset-90")).toEqual({ beforeSunset: 90 });
    expect(parseRemindAt("soon")).toBeNull();
    expect(remindAtLabel(undefined)).toBe(REMIND_WORDS.off);
    expect(remindAtLabel("22:00")).toBe("10:00pm");
    expect(remindAtLabel("sunset-90")).toBe(REMIND_WORDS.beforeSunsetLine(90));
  });
});

describe("Remind me in the side panel", () => {
  it("Off by default; Edit sets a time", async () => {
    const a = await task("Wind down pretend", { recur: ["mon", "tue"] });
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Wind down pretend"));
    expect(p.getByText(REMIND_WORDS.key)).toBeInTheDocument();
    expect(p.getByText(REMIND_WORDS.off)).toBeInTheDocument();
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(p.getByLabelText(REMIND_WORDS.key), "time");
    fireEvent.change(p.getByLabelText(REMIND_WORDS.atLabel), { target: { value: "22:00" } });
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    await vi.waitFor(async () => expect((await stored(a.id)).remindAt).toBe("22:00"));
    expect(await p.findByText("10:00pm")).toBeInTheDocument();
  });

  it("Before sunset with minutes; then Off removes it", async () => {
    const a = await task("Calisthenics pretend", { recur: ["mon"] });
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Calisthenics pretend"));
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(p.getByLabelText(REMIND_WORDS.key), "sunset");
    const minutes = p.getByLabelText(REMIND_WORDS.minutesLabel);
    await userEvent.clear(minutes);
    await userEvent.type(minutes, "90");
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    await vi.waitFor(async () => expect((await stored(a.id)).remindAt).toBe("sunset-90"));
    expect(await p.findByText(REMIND_WORDS.beforeSunsetLine(90))).toBeInTheDocument();

    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    expect(p.getByLabelText(REMIND_WORDS.key)).toHaveValue("sunset");
    expect(p.getByLabelText(REMIND_WORDS.minutesLabel)).toHaveValue(90);
    await userEvent.selectOptions(p.getByLabelText(REMIND_WORDS.key), "off");
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    await vi.waitFor(async () => expect((await stored(a.id)).remindAt).toBeUndefined());
  });

  it("minutes out of range, or no time picked: not saved, and says why", async () => {
    const a = await task("Pretend check", { due: "2026-11-18" });
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Pretend check"));
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(p.getByLabelText(REMIND_WORDS.key), "sunset");
    const minutes = p.getByLabelText(REMIND_WORDS.minutesLabel);
    await userEvent.clear(minutes);
    await userEvent.type(minutes, "999");
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    expect(await p.findByText(REMIND_WORDS.badMinutes)).toBeInTheDocument();
    await userEvent.selectOptions(p.getByLabelText(REMIND_WORDS.key), "time");
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    expect(await p.findByText(REMIND_WORDS.needTime)).toBeInTheDocument();
    expect((await stored(a.id)).remindAt).toBeUndefined();
  });

  it("a to-do with its own time uses that: no Remind me shown", async () => {
    const a = await task("Dentist pretend", { due: "2026-11-18", time: "15:00" });
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Dentist pretend"));
    expect(p.queryByText(REMIND_WORDS.key)).toBeNull();
  });

  it("an edit of another field keeps a remindAt set elsewhere (only what changed is written)", async () => {
    const a = await task("Keep me", { recur: ["mon"], remindAt: "sunset-90" });
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Keep me"));
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(p.getByLabelText("Priority"), "1");
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    await vi.waitFor(async () => expect((await stored(a.id)).priority).toBe(1));
    expect((await stored(a.id)).remindAt).toBe("sunset-90");
  });

  it("changing a to-do into an idea drops Remind me", async () => {
    const a = await task("Turn me", { due: "2026-11-18", remindAt: "10:00" });
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Turn me"));
    await userEvent.click(p.getByRole("button", { name: "Edit" }));
    await userEvent.selectOptions(p.getByLabelText("Type"), "idea");
    await userEvent.click(p.getByRole("button", { name: "Done" }));
    await vi.waitFor(async () => expect((await stored(a.id)).kind).toBe("idea"));
    expect((await stored(a.id)).remindAt).toBeUndefined();
  });

  it("an idea has no Remind me", async () => {
    const a = await createItem({ kind: "idea", title: "Idea pretend", areaId: "art", priority: 2 }, TODAY);
    renderApp(`/area/art?open=${a.id}`, TODAY);
    const p = within(await findPanel("Idea pretend"));
    expect(p.queryByText(REMIND_WORDS.key)).toBeNull();
  });
});
