import { describe, expect, it } from "vitest";
import { DEFAULT_DUE_PREFS, type DuePrefs } from "../../../src/due/prefs";
import {
  COUNT_MAX_CANCELS, countTitle, GENERIC_LINE, MAX_OWN, MAX_TIMED, parseRemindAt, wantedReminders, type DueItem,
} from "../../../src/due/rules";
import { CITIES, sunsetUtc } from "../../../src/due/sun";

// Monday 16 November 2026, New York (UTC-5).
const at = (local: string) => Date.parse(`${local}-05:00`);
const MORNING = at("2026-11-16T08:00:00");
const prefs = (p: Partial<DuePrefs> = {}): DuePrefs => ({ ...DEFAULT_DUE_PREFS, on: true, ...p });
const todo = (id: string, p: Partial<DueItem> = {}): DueItem => ({
  id, title: `Pretend ${id}`, kind: "task", status: "open", areaId: "admin", priority: 2, ...p,
});
const keys = (list: { key: string }[]) => list.map((r) => r.key);
const run = (items: DueItem[], now = MORNING, p: Partial<DuePrefs> = {}) => wantedReminders({ items, prefs: prefs(p), now });
/** Half an hour before the 14:00 count nudge: from then on it is wanted. */
const COUNT_WINDOW = at("2026-11-16T13:30:00");
const countOf = <T extends { kind: string }>(list: T[]) => list.find((r) => r.kind === "count");

describe("Due reminder rules", () => {
  it("nothing at all while Due is off", () => {
    expect(wantedReminders({ items: [todo("a", { due: "2026-11-16" })], prefs: DEFAULT_DUE_PREFS, now: MORNING })).toEqual([]);
  });

  it("Plan your day and Review your day at her times", () => {
    const list = run([], MORNING, { plan: "08:30", review: "22:15" });
    expect(list.find((r) => r.key === "esmeworld-20261116-plan")).toMatchObject({ title: "Plan your day", at: at("2026-11-16T08:30:00") });
    expect(list.find((r) => r.key === "esmeworld-20261116-review")).toMatchObject({ title: "Review your day", at: at("2026-11-16T22:15:00") });
  });

  it("before 3am it is still yesterday's reminders (the 3am rule)", () => {
    const list = run([], at("2026-11-17T02:30:00"));
    expect(keys(list)).toContain("esmeworld-20261116-review");
    expect(keys(list).every((k) => k.startsWith("esmeworld-20261116-"))).toBe(true);
    expect(keys(run([], at("2026-11-17T03:00:00")))).toContain("esmeworld-20261117-plan");
  });

  it("follows her time zone setting", () => {
    // 08:00 New York is 10:00 in São Paulo: the plan time is 09:00 there.
    const list = run([], MORNING, { timeZone: "America/Sao_Paulo" });
    expect(list.find((r) => r.key.endsWith("-plan"))!.at).toBe(Date.parse("2026-11-16T09:00:00-03:00"));
  });

  it("untimed to-dos and habits get no reminders of their own any more (20 Nov: too many at once)", () => {
    const items = [
      todo("today", { due: "2026-11-16", priority: 1 }),
      todo("late", { due: "2026-11-10" }),
      todo("pinned", { pinnedDate: "2026-11-16" }),
      todo("habit", { recur: ["mon"] }),
    ];
    for (const now of [MORNING, COUNT_WINDOW, at("2026-11-16T16:50:00")]) {
      const list = run(items, now);
      expect(list.every((r) => ["plan", "review", "count", "nudge"].includes(r.kind))).toBe(true);
      expect(keys(list).some((k) => /-d[12]-/.test(k))).toBe(false);
    }
  });

  describe("the 14:00 count nudge", () => {
    it("one reminder at 14:00 counting what is left on Today", () => {
      const list = run([
        todo("today", { due: "2026-11-16" }),
        todo("late", { due: "2026-11-10" }),
        todo("pinned", { pinnedDate: "2026-11-16" }),
        todo("habit", { recur: ["mon", "wed"] }),
        todo("session", { sessionPlannedToday: true }),
        todo("datedInbox", { areaId: "inbox", due: "2026-11-16" }),
        // Not on Today, or not left:
        todo("later", { due: "2026-11-18" }),
        todo("moved", { due: "2026-11-10", pinnedDate: "2026-11-20" }),
        todo("hidden", { due: "2026-11-16", hiddenOn: "2026-11-16" }),
        todo("done", { due: "2026-11-16", status: "done", completedAt: "2026-11-15" }),
        todo("idea", { due: "2026-11-16", kind: "idea" }),
        todo("habitDone", { recur: ["mon"], doneToday: true }),
        todo("habitTue", { recur: ["tue"] }),
        todo("inboxHabit", { recur: ["mon"], areaId: "inbox" }),
        todo("someday"),
        // A project whose session for today is ticked: crossed out on Today.
        todo("sessionTicked", { due: "2026-11-16", sessionDoneToday: true }),
      ], COUNT_WINDOW);
      expect(countOf(list)).toMatchObject({ key: "esmeworld-20261116-count", title: "6 to-dos left today, pick one", at: at("2026-11-16T14:00:00") });
      expect(list.filter((r) => r.kind === "count")).toHaveLength(1);
    });

    it("its own words for one, and nothing at all for none", () => {
      expect(countTitle(1)).toBe("1 to-do left today, do it");
      expect(countTitle(3)).toBe("3 to-dos left today, pick one");
      expect(countOf(run([todo("one", { due: "2026-11-16" })], COUNT_WINDOW))!.title).toBe(countTitle(1));
      expect(countOf(run([todo("d", { due: "2026-11-16", status: "done", completedAt: "2026-11-16" })], COUNT_WINDOW))).toBeUndefined();
      expect(countOf(run([], COUNT_WINDOW))).toBeUndefined();
    });

    it("is only wanted from half an hour before (so ticks before then cost Due nothing), and at her time", () => {
      const items = [todo("a", { due: "2026-11-16" })];
      expect(countOf(run(items, at("2026-11-16T13:29:00")))).toBeUndefined();
      expect(countOf(run(items, COUNT_WINDOW))).toBeDefined();
      // Still wanted after it went off (so it isn't cancelled while she snoozes it).
      expect(countOf(run(items, at("2026-11-16T16:00:00")))).toBeDefined();
      expect(countOf(run(items, at("2026-11-16T15:40:00"), { countNudge: "16:00" }))!.at).toBe(at("2026-11-16T16:00:00"));
    });

    it("the count follows her ticks (a new title is a new version), with room for more replacements than other reminders", () => {
      const two = [todo("a", { due: "2026-11-16" }), todo("b", { due: "2026-11-16" })];
      const one = [todo("a", { due: "2026-11-16" }), todo("b", { due: "2026-11-16", status: "done", completedAt: "2026-11-16" })];
      expect(countOf(run(two, COUNT_WINDOW))!.title).toBe(countTitle(2));
      expect(countOf(run(one, COUNT_WINDOW))!.title).toBe(countTitle(1));
      expect(countOf(run(two, COUNT_WINDOW))).toMatchObject({ maxCancels: COUNT_MAX_CANCELS });
      expect(COUNT_MAX_CANCELS).toBeGreaterThan(3);
    });

    it("counts Today's kept picks (the day's today-fill row) while they are still open and on for today", () => {
      const fill = { ids: ["pick", "pushed", "laterPin", "gone", "inboxPick"], dues: { pushed: "2026-11-17" } };
      const items = [
        todo("pick", { priority: 1 }),
        todo("pushed", { due: "2026-11-20" }), // its deadline was pushed out since it was picked
        todo("laterPin", { pinnedDate: "2026-11-18" }),
        todo("inboxPick", { areaId: "inbox" }), // an undated Inbox item is never on Today
        todo("notPicked", { priority: 1 }),
      ];
      const list = wantedReminders({ items, prefs: prefs(), now: COUNT_WINDOW, fill });
      expect(countOf(list)!.title).toBe(countTitle(1));
      // Without the row (no device has shown Today yet), only what always shows is counted.
      expect(countOf(run(items, COUNT_WINDOW))).toBeUndefined();
    });

    it("leaves out what has its own reminder: timed to-dos and Remind me items", () => {
      const list = run([
        todo("a", { due: "2026-11-16" }),
        todo("meeting", { due: "2026-11-16", time: "17:00" }),
        todo("habit", { recur: ["mon"], remindAt: "22:00" }),
        todo("todo", { due: "2026-11-16", remindAt: "sunset-30" }),
      ], COUNT_WINDOW);
      expect(countOf(list)!.title).toBe(countTitle(1));
    });
  });

  describe("Remind me (remindAt) on a to-do or habit", () => {
    it("reads HH:MM and sunset-N, nothing else", () => {
      expect(parseRemindAt("22:00")).toEqual({ time: "22:00" });
      expect(parseRemindAt("sunset-90")).toEqual({ beforeSunset: 90 });
      expect(parseRemindAt("sunset-0")).toEqual({ beforeSunset: 0 });
      for (const bad of ["24:00", "9:00", "sunset", "sunset+30", "sunset-", "sunset-1000", "sunset--5", 5, null, undefined, ""]) {
        expect(parseRemindAt(bad)).toBeNull();
      }
    });

    it("a habit due today gets one reminder at its time", () => {
      const list = run([todo("wind", { title: "Wind down", recur: ["mon"], remindAt: "22:00" })]);
      expect(list.filter((r) => r.kind === "own")).toEqual([{ key: "esmeworld-20261116-r-wind", kind: "own", title: "Wind down", at: at("2026-11-16T22:00:00") }]);
    });

    it("before sunset: her time zone's city by default (New York), minutes before", () => {
      const list = run([todo("cal", { title: "Calisthenics", recur: ["mon"], remindAt: "sunset-90" })]);
      const own = list.find((r) => r.kind === "own")!;
      const sunset = sunsetUtc("2026-11-16", CITIES.nyc.lat, CITIES.nyc.lon)!;
      expect(own.at).toBe(sunset - 90 * 60_000);
      // About 15:05 in New York in mid November.
      expect(Math.abs(own.at - at("2026-11-16T15:06:00"))).toBeLessThan(4 * 60_000);
    });

    it("before sunset where she says she is", () => {
      const london = run([todo("cal", { recur: ["mon"], remindAt: "sunset-90" })], MORNING, { lat: CITIES.london.lat, lon: CITIES.london.lon });
      expect(london.find((r) => r.kind === "own")!.at).toBe(sunsetUtc("2026-11-16", CITIES.london.lat, CITIES.london.lon)! - 90 * 60_000);
    });

    it("with no place known (a zone without a city, none chosen), no sunset reminder: it is counted instead", () => {
      const list = run([todo("cal", { recur: ["mon"], remindAt: "sunset-90" })], at("2026-11-16T13:30:00"), { timeZone: "Asia/Tokyo" });
      expect(list.some((r) => r.kind === "own")).toBe(false);
    });

    it("only on a day it is on Today and not done", () => {
      const list = run([
        todo("habitTue", { recur: ["tue"], remindAt: "22:00" }),
        todo("habitDone", { recur: ["mon"], doneToday: true, remindAt: "22:00" }),
        todo("later", { due: "2026-11-18", remindAt: "22:00" }),
        todo("done", { due: "2026-11-16", status: "done", completedAt: "2026-11-16", remindAt: "22:00" }),
        todo("undated", { remindAt: "22:00" }),
        todo("late", { due: "2026-11-12", remindAt: "10:00" }),
        todo("pinned", { pinnedDate: "2026-11-16", remindAt: "10:00" }),
      ]);
      expect(keys(list.filter((r) => r.kind === "own")).sort()).toEqual(["esmeworld-20261116-r-late", "esmeworld-20261116-r-pinned"]);
    });

    it("a to-do with its own time keeps its timed alert; Remind me is not used for it", () => {
      const list = run([todo("m", { due: "2026-11-16", time: "15:00", remindAt: "10:00" })]);
      expect(list.filter((r) => r.kind === "own")).toEqual([]);
      expect(list.filter((r) => r.kind === "timed")).toHaveLength(1);
    });

    it("a broken remindAt is ignored (the item is counted)", () => {
      const list = run([todo("x", { due: "2026-11-16", remindAt: "soon" })], COUNT_WINDOW);
      expect(list.some((r) => r.kind === "own")).toBe(false);
      expect(countOf(list)!.title).toBe(countTitle(1));
    });

    it("capped, soonest first; one over the cap is counted", () => {
      const many = Array.from({ length: MAX_OWN + 2 }, (_, i) => todo(`o${String(i).padStart(2, "0")}`, { due: "2026-11-16", remindAt: `${10 + i}:00` }));
      const list = run(many, COUNT_WINDOW);
      expect(list.filter((r) => r.kind === "own")).toHaveLength(MAX_OWN);
      expect(countOf(list)!.title).toBe(countTitle(2));
    });
  });

  it("a timed to-do: an alert its lead before, and not in the count", () => {
    const list = run([todo("dentist", { pinnedDate: "2026-11-16", time: "15:00" }), todo("call", { due: "2026-11-16", time: "09:30" })], MORNING, { leadMinutes: 20 });
    const timed = list.filter((r) => r.kind === "timed");
    expect(timed.map((r) => [r.key, r.at])).toEqual([
      ["esmeworld-20261116-t-call", at("2026-11-16T09:10:00")],
      ["esmeworld-20261116-t-dentist", at("2026-11-16T14:40:00")],
    ]);
    expect(timed[1]!.title).toBe("Pretend dentist");
    expect(run([todo("dentist", { pinnedDate: "2026-11-16", time: "15:00" })], COUNT_WINDOW).some((r) => r.kind === "count")).toBe(false);
  });

  it("a timed to-do on another day, done, or without a day makes no timed alert", () => {
    const list = run([
      todo("tomorrow", { due: "2026-11-17", time: "15:00" }),
      todo("done", { due: "2026-11-16", time: "15:00", status: "done", completedAt: "2026-11-16" }),
      todo("noDay", { time: "15:00" }),
      todo("bad", { due: "2026-11-16", time: "25:00" }),
    ]);
    expect(list.filter((r) => r.kind === "timed")).toEqual([]);
    // A broken time is just a to-do due today: counted.
    expect(run([todo("bad", { due: "2026-11-16", time: "25:00" })], COUNT_WINDOW).find((r) => r.kind === "count")!.title).toBe(countTitle(1));
  });

  it("a 1am meeting tomorrow (calendar) belongs to tonight", () => {
    const list = run([todo("late", { due: "2026-11-17", time: "01:00" })]);
    expect(list.filter((r) => r.kind === "timed").map((r) => [r.key, r.at])).toEqual([["esmeworld-20261117-t-late", at("2026-11-17T00:45:00")]]);
  });

  it("timed alerts are capped too", () => {
    const many = Array.from({ length: MAX_TIMED + 3 }, (_, i) => todo(`m${i}`, { due: "2026-11-16", time: `1${i % 10}:0${i % 6}` }));
    expect(run(many).filter((r) => r.kind === "timed")).toHaveLength(MAX_TIMED);
  });

  it("a 03:05 meeting's 02:50 alert is wanted before 3am, under the meeting's own day (review M3)", () => {
    const item = todo("early", { due: "2026-11-17", time: "03:05" });
    const before = run([item], at("2026-11-17T02:30:00"));
    const after = run([item], at("2026-11-17T03:00:00"));
    const pick = (l: ReturnType<typeof run>) => l.filter((r) => r.kind === "timed").map((r) => [r.key, r.at]);
    expect(pick(before)).toEqual([["esmeworld-20261117-t-early", at("2026-11-17T02:50:00")]]);
    // After 3am the same key (so the same reminder, never a second one).
    expect(pick(after)).toEqual(pick(before));
  });

  it("a timed to-do added after its lead but before the meeting: sent a minute from now (review M3)", () => {
    const list = run([todo("soon", { due: "2026-11-16", time: "08:10" })], MORNING);
    const t = list.find((r) => r.kind === "timed")!;
    expect(t.at).toBe(at("2026-11-16T07:55:00"));
    expect(t.sendAt).toBe(MORNING + 60_000);
    // Once the meeting itself is within the minute, nothing.
    expect(run([todo("now", { due: "2026-11-16", time: "08:00" })], MORNING).some((r) => r.kind === "timed")).toBe(false);
  });

  it("an old pin is ignored for the time's day, as Today ignores it (review M4)", () => {
    const list = run([todo("oldpin", { pinnedDate: "2026-11-10", due: "2026-11-16", time: "15:00" })]);
    expect(keys(list.filter((r) => r.kind === "timed"))).toEqual(["esmeworld-20261116-t-oldpin"]);
  });

  describe("the 1pm motivation nudge", () => {
    const NOON = at("2026-11-16T12:40:00");
    it("is not wanted until half an hour before", () => {
      expect(run([], at("2026-11-16T12:20:00")).some((r) => r.kind === "nudge")).toBe(false);
      expect(run([], NOON).find((r) => r.kind === "nudge")).toMatchObject({ key: "esmeworld-20261116-nudge", at: at("2026-11-16T13:00:00") });
    });

    it("uses her own lines in turn, one a day, and a gentle line when she has none", () => {
      const lines = ["First line", "Second line", "Third line"];
      const today = run([], NOON, { lines }).find((r) => r.kind === "nudge")!.title;
      const tomorrow = run([], at("2026-11-17T12:40:00"), { lines }).find((r) => r.kind === "nudge")!.title;
      expect(lines).toContain(today);
      expect(lines.indexOf(tomorrow)).toBe((lines.indexOf(today) + 1) % 3);
      expect(run([], NOON).find((r) => r.kind === "nudge")!.title).toBe(GENERIC_LINE);
    });

    it("not when something was ticked off today: a to-do, a habit or a session", () => {
      expect(run([todo("d", { status: "done", completedAt: "2026-11-16" })], NOON).some((r) => r.kind === "nudge")).toBe(false);
      expect(run([todo("h", { recur: ["tue"], doneToday: true })], NOON).some((r) => r.kind === "nudge")).toBe(false);
      expect(run([todo("p", { sessionDoneToday: true })], NOON).some((r) => r.kind === "nudge")).toBe(false);
      // Done yesterday doesn't count.
      expect(run([todo("y", { status: "done", completedAt: "2026-11-15" })], NOON).some((r) => r.kind === "nudge")).toBe(true);
    });
  });

  it("titles are short and plain; odd ids are made safe", () => {
    const list = run([todo("weird id/with spaces", { due: "2026-11-16", remindAt: "18:00", title: `  ${"Long ".repeat(40)}\nline ` })]);
    const r = list.find((x) => x.kind === "own")!;
    expect(r.key).toMatch(/^esmeworld-20261116-r-h[0-9a-f]{8}$/);
    expect(r.title.length).toBeLessThanOrEqual(100);
    expect(r.title).not.toMatch(/\n|^\s/);
  });

  it("is the same every time for the same moment (pure)", () => {
    const items = [todo("a", { due: "2026-11-16" }), todo("b", { recur: ["mon"], remindAt: "sunset-90" })];
    expect(run(items, COUNT_WINDOW)).toEqual(run(items, COUNT_WINDOW));
  });
});
