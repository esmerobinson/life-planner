import { vi } from "vitest";
import { db } from "../data/db";
import { createItem } from "../data/repo";
import { REMINDERS_HANDLER, sendSchedule } from "./bridge";
import { DEFAULT_REMINDER_SETTINGS } from "./schedule";
import { currentSchedule, rescheduleReminders } from "./scheduler";
import { REMINDER_SETTINGS_KEY } from "./settings";

// Fictional data. 2026-11-04 is a Wednesday.
const WED = "2026-11-04";
const clock = new Date(2026, 10, 4, 7, 0);

type W = { webkit?: unknown };

beforeEach(async () => {
  await db.items.clear();
  await db.syncMeta.clear();
});

afterEach(() => {
  delete (window as W).webkit;
  vi.useRealTimers();
});

describe("currentSchedule (from the database)", () => {
  it("names today's open to-dos and drops ticked ones", async () => {
    const a = await createItem({ kind: "task", title: "Pretend errand", areaId: "admin", priority: 2 }, WED);
    await db.items.update(a.id, { pinnedDate: WED });
    const b = await createItem({ kind: "task", title: "Pretend done thing", areaId: "admin", priority: 2 }, WED);
    await db.items.update(b.id, { pinnedDate: WED, status: "done", completedAt: WED });
    const out = await currentSchedule(clock);
    const todos = out.find((r) => r.id === `todos:${WED}`);
    expect(todos).toMatchObject({ title: "1 to-do today", body: "Pretend errand", at: "2026-11-04T09:00" });
  });

  it("keeps the journal reminders when the journal isn't unlocked here", async () => {
    const out = await currentSchedule(clock);
    expect(out[0]).toMatchObject({ id: `morning:${WED}`, at: "2026-11-04T08:30" });
    expect(out.some((r) => r.id === `checkin:${WED}`)).toBe(true);
  });

  it("follows this device's settings", async () => {
    const off = structuredClone(DEFAULT_REMINDER_SETTINGS);
    for (const r of Object.values(off)) r.on = false;
    await db.syncMeta.put({ key: REMINDER_SETTINGS_KEY, value: off });
    expect(await currentSchedule(clock)).toEqual([]);
  });
});

describe("sending to the Mac", () => {
  it("does nothing without the Mac app's bridge", async () => {
    expect(await sendSchedule([])).toBeNull();
    await expect(rescheduleReminders()).resolves.toBeUndefined();
  });

  it("sends the whole schedule (titles, times and paths only)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock);
    const postMessage = vi.fn(async () => ({ status: "authorized", scheduled: 14 }));
    (window as W).webkit = { messageHandlers: { [REMINDERS_HANDLER]: { postMessage } } };
    await rescheduleReminders();
    expect(postMessage).toHaveBeenCalledTimes(1);
    const msg = (postMessage.mock.calls[0] as unknown[])[0] as { action: string; reminders: Record<string, unknown>[] };
    expect(msg.action).toBe("schedule");
    expect(msg.reminders.length).toBeGreaterThan(0);
    for (const r of msg.reminders) expect(Object.keys(r).sort()).toEqual(["at", "body", "id", "path", "title"]);
  });
});
