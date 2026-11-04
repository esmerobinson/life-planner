import { describe, expect, it } from "vitest";
import type { Item } from "../domain/types";
import {
  DEFAULT_REMINDER_SETTINGS,
  MAX_DAYS,
  MAX_SCHEDULED,
  appDayOf,
  computeSchedule,
  localNow,
  msToDayChange,
  normalizeReminderSettings,
  plannedUntil,
  remindersOn,
  type ReminderSettings,
  type ScheduleInput,
} from "./schedule";

// Fictional data only. 2026-11-04 is a Wednesday; 2026-11-08 is a Sunday.
const WED = "2026-11-04";
const THU = "2026-11-05";
const FRI = "2026-11-06";
const SUN = "2026-11-08";

let n = 0;
function item(o: Partial<Item> = {}): Item {
  n += 1;
  return {
    id: `i${n}`,
    kind: "task",
    title: `Pretend task ${n}`,
    links: [],
    areaId: "writing",
    priority: 3,
    status: "open",
    createdAt: "2026-10-01",
    touchedAt: "2026-10-01",
    ...o,
  };
}

/** Every reminder off, then the given ones switched on. */
function only(patch: Partial<ReminderSettings>): ReminderSettings {
  const off = structuredClone(DEFAULT_REMINDER_SETTINGS);
  for (const k of Object.keys(off) as (keyof ReminderSettings)[]) off[k].on = false;
  return { ...off, ...patch };
}

/** A week's look ahead unless a test says otherwise (the fill-to-the-cap tests do). */
function input(o: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    settings: DEFAULT_REMINDER_SETTINGS,
    now: { date: WED, time: "07:00" },
    items: [],
    morningDone: new Set(),
    checkinDone: new Set(),
    days: 7,
    ...o,
  };
}

const ats = (xs: { at: string }[]) => xs.map((x) => x.at);

describe("defaults (as in the approved mockup, 4A)", () => {
  it("has the mockup's times and on/off", () => {
    const d = DEFAULT_REMINDER_SETTINGS;
    expect(d.morning).toEqual({ on: true, time: "08:30" });
    expect(d.checkin).toEqual({ on: true, time: "20:00" });
    expect(d.todos).toEqual({ on: true, time: "09:00", dayBefore: true });
    expect(d.session).toEqual({ on: true, time: "10:00" });
    expect(d.weekly).toEqual({ on: true, day: "sun", time: "16:00" });
    expect(d.monthly).toEqual({ on: false, when: "first", time: "10:00" });
  });
});

describe("normalizeReminderSettings", () => {
  it("fills anything missing or broken from the defaults", () => {
    expect(normalizeReminderSettings(undefined)).toEqual(DEFAULT_REMINDER_SETTINGS);
    expect(normalizeReminderSettings("nonsense")).toEqual(DEFAULT_REMINDER_SETTINGS);
    const s = normalizeReminderSettings({
      morning: { on: false, time: "07:15" },
      checkin: { on: "yes", time: "25:00" },
      weekly: { on: true, day: "fri", time: "18:00" },
    });
    expect(s.morning).toEqual({ on: false, time: "07:15" });
    expect(s.checkin).toEqual(DEFAULT_REMINDER_SETTINGS.checkin);
    expect(s.weekly).toEqual({ on: true, day: "sun", time: "18:00" });
    expect(s.todos).toEqual(DEFAULT_REMINDER_SETTINGS.todos);
  });
});

describe("morning pages and check-in", () => {
  it("one a day for the next 7 days, at the chosen local time", () => {
    const out = computeSchedule(input({ settings: only({ morning: { on: true, time: "08:30" } }) }));
    expect(ats(out)).toEqual([
      "2026-11-04T08:30", "2026-11-05T08:30", "2026-11-06T08:30", "2026-11-07T08:30",
      "2026-11-08T08:30", "2026-11-09T08:30", "2026-11-10T08:30",
    ]);
    expect(out[0]).toEqual({
      id: "morning:2026-11-04",
      at: "2026-11-04T08:30",
      title: "Morning pages",
      body: "Three pages, before anything else.",
      path: "/journal/morning",
    });
  });

  it("drops today's once the time has passed", () => {
    const out = computeSchedule(input({ settings: only({ morning: { on: true, time: "08:30" } }), now: { date: WED, time: "08:30" } }));
    expect(out[0].at).toBe("2026-11-05T08:30");
    expect(out).toHaveLength(6);
  });

  it("skips itself on a day the pages are already done", () => {
    const out = computeSchedule(
      input({ settings: only({ morning: { on: true, time: "08:30" } }), morningDone: new Set([WED]) }),
    );
    expect(out[0].at).toBe("2026-11-05T08:30");
  });

  it("still reminds when it can't tell (journal locked on this device)", () => {
    const out = computeSchedule(input({ settings: only({ morning: { on: true, time: "08:30" } }), morningDone: null }));
    expect(out[0].at).toBe("2026-11-04T08:30");
  });

  it("check-in: 8pm, skipped once checked in", () => {
    const out = computeSchedule(
      input({ settings: only({ checkin: { on: true, time: "20:00" } }), checkinDone: new Set([WED]) }),
    );
    expect(out[0]).toEqual({
      id: "checkin:2026-11-05",
      at: "2026-11-05T20:00",
      title: "Daily check-in",
      body: "A few questions to close the day.",
      path: "/journal/check-in",
    });
  });

  it("nothing when off", () => {
    expect(computeSchedule(input({ settings: only({}) }))).toEqual([]);
  });
});

describe("to-dos and deadlines", () => {
  const todos = { on: true, time: "09:00", dayBefore: true };

  it("names the day's to-dos (Do it on, or a deadline that day)", () => {
    const items = [
      item({ title: "Finish the pretend draft", pinnedDate: WED }),
      item({ title: "Book the pretend dentist", due: WED }),
      item({ title: "Water the pretend plants", pinnedDate: WED }),
      item({ title: "Later thing", pinnedDate: FRI }),
    ];
    const out = computeSchedule(input({ settings: only({ todos }), items }));
    expect(out[0]).toEqual({
      id: "todos:2026-11-04",
      at: "2026-11-04T09:00",
      title: "3 to-dos today",
      body: "Finish the pretend draft, Book the pretend dentist and 1 more",
      path: "/",
    });
    expect(out.map((r) => r.id)).toEqual(["todos:2026-11-04", "todos:2026-11-06"]);
    expect(out[1]).toMatchObject({ title: "1 to-do today", body: "Later thing" });
  });

  it("two names are joined with 'and'", () => {
    const items = [item({ title: "Pretend A", pinnedDate: WED }), item({ title: "Pretend B", pinnedDate: WED })];
    expect(computeSchedule(input({ settings: only({ todos }), items }))[0].body).toBe("Pretend A and Pretend B");
  });

  it("also the day before a deadline", () => {
    const items = [item({ title: "Pretend form", due: THU })];
    const out = computeSchedule(input({ settings: only({ todos }), items }));
    expect(out.map((r) => r.id)).toEqual(["todos:2026-11-04", "todos:2026-11-05"]);
    expect(out[0]).toMatchObject({ title: "1 deadline tomorrow", body: "Pretend form" });
    expect(out[1]).toMatchObject({ title: "1 to-do today", body: "Pretend form" });
  });

  it("today's to-dos and tomorrow's deadlines share one notification", () => {
    const items = [item({ title: "Pretend today", pinnedDate: WED }), item({ title: "Pretend form", due: THU })];
    const out = computeSchedule(input({ settings: only({ todos }), items }));
    expect(out[0]).toMatchObject({ title: "1 to-do today", body: "Pretend today · Due tomorrow: Pretend form" });
  });

  it("no day-before reminder when that's switched off", () => {
    const items = [item({ title: "Pretend form", due: THU })];
    const out = computeSchedule(input({ settings: only({ todos: { ...todos, dayBefore: false } }), items }));
    expect(out.map((r) => r.id)).toEqual(["todos:2026-11-05"]);
  });

  it("leaves out done, binned, archived, hidden-today, habits and ideas", () => {
    const items = [
      item({ status: "done", pinnedDate: WED, completedAt: WED }),
      item({ status: "deleted", pinnedDate: WED }),
      item({ status: "archived", due: WED }),
      item({ hiddenOn: WED, pinnedDate: WED }),
      item({ recur: ["wed"], pinnedDate: WED }),
      item({ kind: "idea", pinnedDate: WED }),
    ];
    expect(computeSchedule(input({ settings: only({ todos }), items }))).toEqual([]);
  });

  it("skips itself once everything for that day is ticked (recomputed)", () => {
    const a = item({ title: "Pretend A", pinnedDate: WED });
    const before = computeSchedule(input({ settings: only({ todos }), items: [a] }));
    expect(before).toHaveLength(1);
    const after = computeSchedule(input({ settings: only({ todos }), items: [{ ...a, status: "done", completedAt: WED }] }));
    expect(after).toEqual([]);
  });

  it("a to-do dated today and due tomorrow is named once", () => {
    const items = [item({ title: "Pretend both", pinnedDate: WED, due: THU })];
    const out = computeSchedule(input({ settings: only({ todos }), items }));
    expect(out[0]).toMatchObject({ title: "1 to-do today", body: "Pretend both" });
  });
});

describe("project sessions", () => {
  const session = { on: true, time: "10:00" };
  const project = (o: Partial<Item> = {}) =>
    item({
      title: "Pretend film project",
      sessions: [{ id: "s1", doneOn: "2026-11-01" }, { id: "s2", doneOn: "2026-11-02" }, { id: "s3", plannedFor: WED }, { id: "s4" }],
      ...o,
    });

  it("one per project with a session planned that day", () => {
    const p = project();
    const out = computeSchedule(input({ settings: only({ session }), items: [p] }));
    expect(out).toEqual([
      {
        id: `session:2026-11-04:${p.id}`,
        at: "2026-11-04T10:00",
        title: "Pretend film project",
        body: "Session 3 of 4 is planned for today.",
        path: "/",
      },
    ]);
  });

  it("skips itself once that session is ticked", () => {
    const p = project();
    const ticked = { ...p, sessions: p.sessions!.map((s) => (s.id === "s3" ? { ...s, doneOn: WED } : s)) };
    expect(computeSchedule(input({ settings: only({ session }), items: [ticked] }))).toEqual([]);
  });

  it("never for a binned project", () => {
    expect(computeSchedule(input({ settings: only({ session }), items: [project({ status: "deleted" })] }))).toEqual([]);
  });
});

describe("reviews", () => {
  it("weekly: Sunday afternoon, opening Home for now", () => {
    const out = computeSchedule(input({ settings: only({ weekly: { on: true, day: "sun", time: "16:00" } }) }));
    expect(out).toEqual([
      { id: "weekly:2026-11-08", at: "2026-11-08T16:00", title: "Weekly review", body: "Your week is ready to look back on.", path: "/" },
    ]);
  });

  it("weekly: skipped once that week is reviewed", () => {
    const out = computeSchedule(
      input({
        settings: only({ weekly: { on: true, day: "sun", time: "16:00" } }),
        reviewsDone: { weeks: new Set(["2026-11-02"]), months: new Set() },
      }),
    );
    expect(out).toEqual([]);
  });

  it("weekly on a Monday looks back on the week before", () => {
    const out = computeSchedule(
      input({
        settings: only({ weekly: { on: true, day: "mon", time: "16:00" } }),
        // Monday the 9th's review is of the week of the 2nd, not the week of the 9th.
        reviewsDone: { weeks: new Set(["2026-11-09"]), months: new Set() },
      }),
    );
    expect(out.map((r) => r.id)).toEqual(["weekly:2026-11-09"]);
    const reviewed = computeSchedule(
      input({
        settings: only({ weekly: { on: true, day: "mon", time: "16:00" } }),
        reviewsDone: { weeks: new Set(["2026-11-02"]), months: new Set() },
      }),
    );
    expect(reviewed).toEqual([]);
  });

  it("monthly on the 1st looks back on the month before", () => {
    const out = computeSchedule(
      input({ now: { date: "2026-10-28", time: "12:00" }, settings: only({ monthly: { on: true, when: "first", time: "10:00" } }) }),
    );
    expect(out).toEqual([
      { id: "monthly:2026-11-01", at: "2026-11-01T10:00", title: "October review", body: "Your month is ready to look back on.", path: "/" },
    ]);
  });

  it("monthly on the last Sunday looks back on that month", () => {
    const out = computeSchedule(
      input({ now: { date: "2026-11-25", time: "12:00" }, settings: only({ monthly: { on: true, when: "last-sunday", time: "10:00" } }) }),
    );
    expect(out).toEqual([
      { id: "monthly:2026-11-29", at: "2026-11-29T10:00", title: "November review", body: "Your month is ready to look back on.", path: "/" },
    ]);
  });

  it("monthly: skipped once that month is reviewed", () => {
    const out = computeSchedule(
      input({
        now: { date: "2026-10-28", time: "12:00" },
        settings: only({ monthly: { on: true, when: "first", time: "10:00" } }),
        reviewsDone: { weeks: new Set(), months: new Set(["2026-10"]) },
      }),
    );
    expect(out).toEqual([]);
  });
});

describe("the whole schedule", () => {
  it("is sorted by time and never longer than the system's limit allows", () => {
    const items = Array.from({ length: 30 }, (_, i) =>
      item({ title: `Pretend project ${i}`, sessions: [{ id: "a", plannedFor: SUN }, { id: "b", plannedFor: THU }] }),
    );
    const out = computeSchedule(input({ items }));
    expect(out.length).toBe(MAX_SCHEDULED);
    expect(ats(out)).toEqual([...ats(out)].sort());
    expect(out[0].at).toBe("2026-11-04T08:30");
  });

  it("holds only titles and counts (no notes or page text)", () => {
    const items = [
      item({ title: "Pretend title", notes: "SECRET pretend notes", pinnedDate: WED }),
      item({
        title: "Pretend project",
        notes: "SECRET project notes",
        sessions: [{ id: "s1", title: "SECRET session title", details: "SECRET session details", plannedFor: WED }],
      }),
    ];
    const text = JSON.stringify(computeSchedule(input({ items })));
    expect(text).not.toContain("SECRET");
  });
});

describe("app-days (a day runs 3am to 3am)", () => {
  const checkinAt1 = only({ checkin: { on: true, time: "01:00" } });

  it("a check-in done at 00:40 means no 01:00 reminder for that app-day", () => {
    // 00:45 on Friday the 6th is still Thursday the 5th; the check-in done at 00:40 was the 5th's.
    const now = { date: FRI, time: "00:45" };
    const done = computeSchedule(input({ settings: checkinAt1, now, checkinDone: new Set([THU]) }));
    expect(done[0]).toMatchObject({ id: `checkin:${FRI}`, at: "2026-11-07T01:00" });
    const notDone = computeSchedule(input({ settings: checkinAt1, now }));
    expect(notDone[0]).toMatchObject({ id: `checkin:${THU}`, at: "2026-11-06T01:00" });
  });

  it("a reminder at 02:30 belongs to the app-day before (it goes off after midnight)", () => {
    const out = computeSchedule(input({ settings: only({ morning: { on: true, time: "02:30" } }), now: { date: WED, time: "12:00" } }));
    expect(out[0]).toEqual(expect.objectContaining({ id: `morning:${WED}`, at: "2026-11-05T02:30" }));
    expect(appDayOf("2026-11-05", "02:30")).toBe(WED);
    expect(appDayOf("2026-11-05", "03:00")).toBe(THU);
  });

  it("between midnight and 3am, the to-dos are still the app-day's (as Today shows them)", () => {
    const items = [item({ title: "Pretend Wednesday thing", pinnedDate: WED }), item({ title: "Pretend Thursday thing", pinnedDate: THU })];
    const out = remindersOn(input({ settings: only({ todos: { on: true, time: "01:30", dayBefore: false } }), items }), WED);
    expect(out).toEqual([expect.objectContaining({ id: `todos:${WED}`, at: "2026-11-05T01:30", body: "Pretend Wednesday thing" })]);
  });

  it("rolls over a month and a year", () => {
    const out = computeSchedule(
      input({ now: { date: "2026-12-28", time: "12:00" }, settings: only({ monthly: { on: true, when: "first", time: "10:00" } }) }),
    );
    expect(out).toEqual([
      { id: "monthly:2027-01-01", at: "2027-01-01T10:00", title: "December review", body: "Your month is ready to look back on.", path: "/" },
    ]);
    // 01:00 on the 1st is still the 31st's app-day: the 1st's monthly reminder is still ahead.
    const night = computeSchedule(
      input({ now: { date: "2027-01-01", time: "01:00" }, settings: only({ monthly: { on: true, when: "first", time: "10:00" } }) }),
    );
    expect(night[0]).toMatchObject({ id: "monthly:2027-01-01", at: "2027-01-01T10:00" });
  });

  it("keeps wall-clock times through a clock change (UK clocks go back on 25 Oct 2026)", () => {
    const out = computeSchedule(
      input({ now: { date: "2026-10-24", time: "12:00" }, settings: only({ morning: { on: true, time: "08:30" }, checkin: { on: true, time: "01:30" } }) }),
    );
    expect(ats(out).slice(0, 4)).toEqual(["2026-10-25T01:30", "2026-10-25T08:30", "2026-10-26T01:30", "2026-10-26T08:30"]);
  });
});

describe("filled up to the cap", () => {
  it("keeps going day by day, soonest first, up to MAX_SCHEDULED", () => {
    const out = computeSchedule(input({ days: undefined }));
    expect(out).toHaveLength(MAX_SCHEDULED);
    expect(ats(out)).toEqual([...ats(out)].sort());
    expect(MAX_SCHEDULED).toBeLessThan(64);
    // Defaults: about two a day, so it reaches weeks ahead, not just 7 days.
    expect(out[out.length - 1].at > "2026-11-25").toBe(true);
  });

  it("stops at MAX_DAYS when only a few are on", () => {
    const out = computeSchedule(input({ days: undefined, settings: only({ weekly: { on: true, day: "sun", time: "16:00" } }) }));
    // 92 app-days from Wednesday 4 Nov hold 13 Sundays.
    expect(MAX_DAYS).toBe(92);
    expect(out.length).toBe(13);
    expect(out.every((r) => r.id.startsWith("weekly:"))).toBe(true);
  });

  it("says how far ahead it is planned", () => {
    const out = computeSchedule(input({ settings: only({ morning: { on: true, time: "08:30" } }) }));
    expect(plannedUntil(out)).toBe("2026-11-10");
    expect(plannedUntil([])).toBeNull();
  });
});

describe("the to-dos line counts what Today shows", () => {
  const todos = { on: true, time: "09:00", dayBefore: true };

  it("leaves out the Inbox and to-dos moved to a later day", () => {
    const items = [
      item({ title: "Pretend unsorted", areaId: "inbox", pinnedDate: WED }),
      item({ title: "Pretend moved", due: WED, pinnedDate: FRI }),
      item({ title: "Pretend kept", due: WED }),
    ];
    const out = computeSchedule(input({ settings: only({ todos }), items }));
    expect(out.find((r) => r.id === `todos:${WED}`)).toMatchObject({ title: "1 to-do today", body: "Pretend kept" });
  });

  it("a project with a session that day has its own reminder, not a place in the to-dos line", () => {
    const sessionToday = item({ title: "Pretend film", due: WED, sessions: [{ id: "a", plannedFor: WED }, { id: "b" }] });
    const dueOnly = item({ title: "Pretend album", due: WED, sessions: [{ id: "a" }] });
    const out = computeSchedule(
      input({ settings: only({ todos, session: { on: true, time: "10:00" } }), items: [sessionToday, dueOnly] }),
    );
    expect(out.map((r) => [r.id, r.body])).toEqual([
      [`todos:${WED}`, "Pretend album"],
      [`session:${WED}:${sessionToday.id}`, "Session 1 of 2 is planned for today."],
    ]);
  });
});

describe("clock helpers", () => {
  it("localNow is the calendar date and minute", () => {
    expect(localNow(new Date(2026, 10, 6, 0, 45, 30))).toEqual({ date: FRI, time: "00:45" });
  });

  it("msToDayChange: to just after the next 3am", () => {
    expect(msToDayChange(new Date(2026, 10, 6, 2, 0, 0))).toBe(60 * 60 * 1000 + 1000);
    expect(msToDayChange(new Date(2026, 10, 6, 3, 0, 30))).toBe(24 * 60 * 60 * 1000 - 29 * 1000);
    expect(msToDayChange(new Date(2026, 10, 6, 23, 0, 0))).toBe(4 * 60 * 60 * 1000 + 1000);
  });

  it("msToDayChange across the UK clock change: 22:00 BST to 03:00 GMT is six hours", () => {
    const was = process.env.TZ;
    process.env.TZ = "Europe/London";
    try {
      expect(msToDayChange(new Date(2026, 9, 24, 22, 0, 0))).toBe(6 * 60 * 60 * 1000 + 1000);
    } finally {
      if (was === undefined) delete process.env.TZ;
      else process.env.TZ = was;
    }
  });
});
