import { describe, expect, it } from "vitest";
import type { Item } from "../domain/types";
import {
  DEFAULT_REMINDER_SETTINGS,
  MAX_SCHEDULED,
  computeSchedule,
  normalizeReminderSettings,
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

function input(o: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    settings: DEFAULT_REMINDER_SETTINGS,
    now: { date: WED, time: "07:00" },
    items: [],
    morningDone: new Set(),
    checkinDone: new Set(),
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
      path: "/today",
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
        path: "/today",
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
    const items = [item({ title: "Pretend title", notes: "SECRET pretend notes", pinnedDate: WED })];
    const text = JSON.stringify(computeSchedule(input({ items })));
    expect(text).not.toContain("SECRET");
  });
});
