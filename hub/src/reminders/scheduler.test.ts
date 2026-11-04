import { vi } from "vitest";
import { db } from "../data/db";
import { createItem, ensureCheckinSet, finishMorningPage, saveAnswer } from "../data/repo";
import { confirmedDevice, keyFor } from "../test/journalKey";
import { REMINDERS_HANDLER, sendSchedule } from "./bridge";
import { DEFAULT_REMINDER_SETTINGS } from "./schedule";
import { currentSchedule, rescheduleReminders, resetSchedulerForTests } from "./scheduler";
import { REMINDER_SETTINGS_KEY } from "./settings";

// Fictional data. 2026-11-04 is a Wednesday.
const WED = "2026-11-04";
const THU = "2026-11-05";
const clock = new Date(2026, 10, 4, 7, 0);

type W = { webkit?: unknown };

beforeEach(async () => {
  await db.items.clear();
  await db.syncMeta.clear();
  await db.journal.clear();
  resetSchedulerForTests();
});

afterEach(() => {
  delete (window as W).webkit;
  vi.useRealTimers();
});

function fakeMac() {
  const postMessage = vi.fn(async (m: { reminders?: unknown[] }) => ({ status: "authorized", scheduled: m.reminders?.length ?? 0 }));
  (window as W).webkit = { messageHandlers: { [REMINDERS_HANDLER]: { postMessage } } };
  return postMessage;
}

type Msg = { action: string; reminders: Record<string, unknown>[]; today?: string; keepToday?: string[] };
const msgs = (fn: ReturnType<typeof fakeMac>) => fn.mock.calls.map((c) => c[0] as unknown as Msg);

/** Checks in for `date`: the day's two pretend questions both moved past. */
async function checkIn(date: string) {
  const jk = await keyFor("pretend passphrase");
  const prompts = ["Pretend question one?", "Pretend question two?"];
  await ensureCheckinSet(jk, date, prompts);
  for (const p of prompts) await saveAnswer(jk, date, p, "device-mac-0001", "pretend", true);
}

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

  it("with the journal unlocked: done morning pages and a finished check-in skip today's reminders", async () => {
    const jk = await keyFor("pretend passphrase");
    await confirmedDevice(db, jk);
    await finishMorningPage(jk, WED, "device-mac-0001", "Pretend page");
    await checkIn(WED);
    const ids = (await currentSchedule(clock)).map((r) => r.id);
    expect(ids).not.toContain(`morning:${WED}`);
    expect(ids).not.toContain(`checkin:${WED}`);
    expect(ids).toContain(`morning:${THU}`);
    expect(ids).toContain(`checkin:${THU}`);
  });

  it("a check-in done at 00:40 (yesterday's app-day) means no 01:00 reminder that night", async () => {
    const jk = await keyFor("pretend passphrase");
    await confirmedDevice(db, jk);
    await db.syncMeta.put({ key: REMINDER_SETTINGS_KEY, value: { ...DEFAULT_REMINDER_SETTINGS, checkin: { on: true, time: "01:00" } } });
    await checkIn(WED); // done at 00:40 on Thursday's calendar date: Wednesday's app-day
    const ids = (await currentSchedule(new Date(2026, 10, 5, 0, 45))).map((r) => r.id);
    expect(ids).not.toContain(`checkin:${WED}`);
    expect(ids[0]).toBe(`morning:${THU}`);
  });

  it("knows morning pages are done without the journal key (from the rows' clear kind and date)", async () => {
    const jk = await keyFor("pretend passphrase");
    await confirmedDevice(db, jk);
    await finishMorningPage(jk, WED, "device-mac-0001", "Pretend page");
    await db.syncMeta.clear(); // the key is gone from this device: locked
    const ids = (await currentSchedule(clock)).map((r) => r.id);
    expect(ids).not.toContain(`morning:${WED}`);
    expect(ids).toContain(`checkin:${WED}`); // the check-in can't be read: it still reminds
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

  it("sends the whole schedule (titles, times and paths only), with today's still-standing ids", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock);
    const mac = fakeMac();
    await rescheduleReminders();
    expect(mac).toHaveBeenCalledTimes(1);
    const msg = msgs(mac)[0];
    expect(msg.action).toBe("schedule");
    expect(msg.reminders.length).toBeGreaterThan(0);
    for (const r of msg.reminders) expect(Object.keys(r).sort()).toEqual(["at", "body", "id", "path", "title"]);
    expect(msg.today).toBe(WED);
    expect(msg.keepToday).toEqual([`morning:${WED}`, `checkin:${WED}`]);
  });

  it("an unchanged schedule isn't sent again; a forced one is", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock);
    const mac = fakeMac();
    await rescheduleReminders();
    await rescheduleReminders();
    expect(mac).toHaveBeenCalledTimes(1);
    await rescheduleReminders(true);
    expect(mac).toHaveBeenCalledTimes(2);
    await createItem({ kind: "task", title: "Pretend new thing", areaId: "admin", priority: 2 }, WED).then((it) =>
      db.items.update(it.id, { pinnedDate: WED }),
    );
    await rescheduleReminders();
    expect(mac).toHaveBeenCalledTimes(3);
  });

  it("many requests while one runs make one more send, not many", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock);
    const mac = fakeMac();
    await Promise.all([rescheduleReminders(true), rescheduleReminders(true), rescheduleReminders(true), rescheduleReminders(true)]);
    expect(mac).toHaveBeenCalledTimes(2);
  });

  it("while notifications aren't allowed, it tries again next time", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(clock);
    const postMessage = vi.fn(async () => ({ status: "not-determined", scheduled: 0 }));
    (window as W).webkit = { messageHandlers: { [REMINDERS_HANDLER]: { postMessage } } };
    await rescheduleReminders();
    await rescheduleReminders();
    expect(postMessage).toHaveBeenCalledTimes(2);
  });
});
